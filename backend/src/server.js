const express = require('express');
const cors = require('cors');
const requestLogger = require('./middleware/requestLoggerMiddleware');
const { requestRecorder } = require('./middleware/requestRecorder');
const { apiLimiter, authLimiter, flushRateLimitKeys, rateLimitEnabled } = require('./middleware/rateLimitMiddleware');
require('dotenv').config();

const pool = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const stationRoutes = require('./routes/stationRoutes');
const trainRoutes = require('./routes/trainRoutes');
const adminRoutes = require('./routes/adminRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const bookingRoutes = require('./routes/bookingRoutes');
const seatRoutes = require('./routes/seatRoutes');
const env = require('./config/env');
const { checkRedisHealth, redis } = require('./config/redis');
const adminMiddleware = require('./middleware/adminMiddleware');
const authMiddleware = require('./middleware/authMiddleware');
const { startSeatHoldSweeper } = require('./services/seat/holdSweeper');

const app = express();

app.use(cors());
app.use(express.json());

app.use(requestLogger);

// Persists each request to `api_request_logs` for Admin › Monitoring.
// Deliberately after morgan so stdout is untouched, and before the rate limiter
// so a request refused with 429 is still recorded — a spike of rejections is
// exactly what someone is looking at that page to find.
app.use(requestRecorder());

// The API is served from the root — no /api or /api/v1 prefix. The frontend
// reads the base URL from VITE_API_URL and appends only the resource path.
//
// RATE_LIMIT_ENABLED=false makes both of these pass-throughs. They stay mounted
// either way, so re-enabling is a flag change and not a code change.
app.use('/', apiLimiter);

// Auth & User routes
app.use('/auth', authLimiter, authRoutes);
app.use('/users', userRoutes);

// Team 7 - Admin Routes
app.use('/admin', authMiddleware, adminMiddleware, adminRoutes);

// Team 2 - Railway Search & Station Discovery routes
app.use('/stations', stationRoutes);
app.use('/trains', trainRoutes);

// Team 5 - Payment & Transactions
app.use('/payments', paymentRoutes);

// Booking stand-in for Team 4 - exists so /payments has a reference to resolve,
// and so the seats this booking takes are held in the database rather than in
// this process's memory.
app.use('/bookings', bookingRoutes);

// Seat availability for the seat map. Reads the same seat_holds rows the booking
// flow writes, so what the map shows and what the hold actually is cannot drift.
app.use('/seats', seatRoutes);

// Service health. Reports whether the database is reachable and whether
// payment is configured, without revealing credentials.
app.get('/health', async (req, res) => {
  const health = {
    status: 'ok',
    razorpay: env.isMockRazorpay ? 'unconfigured' : 'configured',
    database: 'unknown',
    // Redis is a cache, not a dependency, so it never sets status — it is
    // reported so a slow response can be attributed to a missing cache.
    redis: 'unknown',
  };

  try {
    const [rows] = await pool.query('SELECT 1 AS ok');
    health.database = rows[0].ok === 1 ? 'connected' : 'unreachable';
  } catch (err) {
    health.status = 'degraded';
    health.database = 'unreachable';
  }

  try {
    health.redis = (await checkRedisHealth()) ? 'connected' : 'disconnected';
  } catch (err) {
    health.redis = 'disconnected';
  }

  res.json(health);
});

app.get('/', (req, res) => {
  res.json({
    message: 'RailSetu / Yatrio Backend is Running!',
    team2Endpoints: [
      'GET /stations',
      'GET /stations/search?q=:query',
      'GET /trains/search?q=:query',
      'GET /trains/status/:trainNo',
      'GET /trains/between?from=:from&to=:to&date=:date',
      'GET /trains/:trainNo',
    ],
    team5Endpoints: [
      'POST /payments/create-order',
      'POST /payments/verify',
      'POST /payments/refund',
      'GET /payments/status/:orderId',
      'GET /payments/history',
      'POST /bookings/confirm',
      'GET /seats/availability?trainNo=&class=&date=',
    ],
  });
});

// Global 404 handler for unmatched routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: `Cannot ${req.method} ${req.originalUrl}`,
    },
  });
});

// Global error handler
//
// Team 5's payment routes reject with an HttpError carrying a deliberate
// status and code (404 NOT_FOUND, 409 SIGNATURE_MISMATCH, 409 ALREADY_REFUNDED),
// so honour them instead of flattening everything to a 500. Anything without a
// status is a genuine fault and still gets the generic message, because a 500
// must never leak internals to a client.
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;

  if (status >= 500) {
    console.error('Unhandled server error:', err);
  }

  res.status(status).json({
    success: false,
    error: {
      code: status >= 500 ? 'INTERNAL_ERROR' : err.code || 'REQUEST_FAILED',
      message:
        status >= 500 ? 'An unexpected internal error occurred' : err.message,
      field: err.field ?? null,
    },
});
});

const PORT = process.env.PORT || 5000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    if (!rateLimitEnabled) {
      console.warn(
        '[Yatrio] Rate limiting is DISABLED (RATE_LIMIT_ENABLED=false).',
      );
      console.warn('          Set RATE_LIMIT_ENABLED=true in .env to turn it back on.');
    }
  });

  // Cleared after listen so the flush cannot delay the port coming up.
  //
  // Counters live in Redis and survive both a restart and the limiter being
  // switched off, so anyone already inside a window stays blocked until it
  // rolls over unless they are cleared.
  //
  // Waiting on Redis is the point: the connection is established asynchronously
  // and its `ready` event fires after this block runs, so flushing immediately
  // would always report "Redis is not ready" and clear nothing. Polled on a
  // short interval with a bounded number of attempts — if Redis never arrives
  // there are no counters to clear anyway, because a down Redis means the
  // limiter was already falling back to per-process memory.
  if (env.rateLimit.flushOnBoot) {
    let attempts = 0;
    const tryFlush = setInterval(() => {
      attempts += 1;
      if (redis.status === 'ready') {
        clearInterval(tryFlush);
        flushRateLimitKeys().catch(() => {});
      } else if (attempts >= 20) {
        clearInterval(tryFlush);
        console.warn('[Yatrio] Rate-limit flush abandoned: Redis never became ready.');
      }
    }, 500);
  }

  // Reclaims seat holds whose payment window has closed.
  //
  // Started only for a real listening server, not when this module is imported
  // by a test — importing app.js must not open a timer and a database
  // connection behind the caller's back.
  //
  // This is a safety net, not the mechanism. Every read and write in holdService
  // already treats an elapsed hold as free, so a seat becomes available the
  // moment its window closes whether or not this has ticked. What the sweeper
  // avoids is dead rows sitting in `seat_holds` for bookings nobody will ever
  // return to.
  const sweeper = startSeatHoldSweeper();

  const shutdown = () => {
    sweeper.stop();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

module.exports = app;
