'use strict'

require('dotenv').config()

/**
 * Env loading with validation.
 *
 * RAZORPAY_KEY_SECRET must never leave the server. It is deliberately absent
 * from every VITE_* variable — Vite inlines those into the browser bundle, so
 * a secret there would be public. See ../../SECURITY.md.
 *
 * A missing key is a WARNING, not a process exit. One server now serves all
 * seven teams, and the payment routes are mounted alongside auth, stations and
 * admin — killing the process here would take every other team's API down
 * because Team 5's keys were not filled in. Payment requests fail loudly
 * instead; the rest of the backend carries on working.
 */

const required = ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET']

const missing = required.filter((key) => !process.env[key])

if (missing.length) {
  console.warn(
    '\n  [Yatrio] Razorpay keys are not configured:\n' +
      missing.map((k) => `    - ${k}`).join('\n') +
      '\n  Payment endpoints will refuse to work until you fill them in.\n' +
      '  Copy backend/.env.example to backend/.env and get test keys from\n' +
      '  Razorpay Dashboard > Account & Settings > API Keys.\n' +
      '  Every other endpoint is unaffected.\n',
  )
}

const isPlaceholder = (v) => !v || /XXXX|your_|placeholder/i.test(v)

const placeholderKeys = required.filter((k) => isPlaceholder(process.env[k]))

if (placeholderKeys.length) {
  console.warn(
    `\n  [Yatrio] Razorpay keys still look like placeholders (${placeholderKeys.join(', ')}).` +
      ' Payments will fail until you paste real test keys into backend/.env\n',
  )
}

module.exports = {
  port: Number(process.env.PORT ?? 5000),

  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID,
    keySecret: process.env.RAZORPAY_KEY_SECRET,
  },

  cors: {
    origins: (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },

  /** Razorpay recommends capping retries; the frontend mirrors this. */
  maxAttempts: Number(process.env.MAX_PAYMENT_ATTEMPTS ?? 4),

  /** Yatrio's order lifetime, aligned with Team 4's reservation window. */
  orderTtlMinutes: Number(process.env.ORDER_TTL_MINUTES ?? 5),

  /**
   * How long a seat stays held while its booking pays.
   *
   * Defaults to the order TTL because the two deadlines should land together: a
   * seat freed while its own payment window is still open would let a second
   * traveller buy the berth the first is still staring at Checkout for. Setting
   * this higher than `orderTtlMinutes` is legitimate — it widens the seat hold
   * past the payment window, which is the more forgiving direction. Setting it
   * lower is not, and holdService rejects a booking whose seat hold would die
   * before its payment order.
   */
  seatHoldTtlMinutes: Number(
    process.env.SEAT_HOLD_TTL_MINUTES ?? process.env.ORDER_TTL_MINUTES ?? 5,
  ),

  /**
   * How often the sweeper sweeps expired holds. Deliberately coarse: the sweeper
   * is a safety net, not the mechanism — every read and write path in holdService
   * already treats an elapsed hold as gone, so a missed or late tick can never
   * show a stale seat as occupied. Only the *cleanup* is deferred by this.
   */
  seatSweepIntervalMs: Number(process.env.SEAT_SWEEP_INTERVAL_MS ?? 15_000),

  /**
   * Rate limiting.
   *
   * `RATE_LIMIT_ENABLED=false` turns both limiters into pass-throughs. The
   * middleware is kept and the setting is read at boot, so this is a one-flag
   * pause rather than a deletion — put the flag back and the limits resume.
   *
   * Counters live in Redis, which survives a restart. So does a limiter you
   * have just disabled: a client that already burned its window stays blocked
   * until the window rolls over unless `RATE_LIMIT_FLUSH=true` is set, which
   * clears the keys on boot. See `flushRateLimitKeys` in rateLimitMiddleware.
   */
  rateLimit: {
    enabled: process.env.RATE_LIMIT_ENABLED
      ? /^(1|true|yes)$/i.test(process.env.RATE_LIMIT_ENABLED)
      : true,
    flushOnBoot: process.env.RATE_LIMIT_FLUSH
      ? /^(1|true|yes)$/i.test(process.env.RATE_LIMIT_FLUSH)
      : false,

    /**
     * Whole-API ceiling per IP per window.
     *
     * Was 100 per 15 minutes, applied to *every* route. That is far too low for
     * a single-page app: one session makes a dozen calls (search, train detail,
     * availability, confirm, order, status poll), so a handful of page loads
     * exhausted the window and the payment step — which polls — is what pushed
     * the counter over. 1000 keeps the ceiling meaningful while leaving room
     * for real traffic.
     */
    apiWindowMs: Number(process.env.RATE_LIMIT_API_WINDOW_MS ?? 15 * 60 * 1000),
    apiMax: Number(process.env.RATE_LIMIT_API_MAX ?? 1000),

    /**
     * Auth attempts per IP per hour.
     *
     * Deliberately still the strictest limit when re-enabled — this is the one
     * worth keeping, since it is what blunts credential stuffing.
     */
    authWindowMs: Number(process.env.RATE_LIMIT_AUTH_WINDOW_MS ?? 60 * 60 * 1000),
    authMax: Number(process.env.RATE_LIMIT_AUTH_MAX ?? 50),
  },

  /** 'pretty' (boxed) or 'json' (one line per event). */
  paymentLogFormat: process.env.PAYMENT_LOG_FORMAT === 'json' ? 'json' : 'pretty',

  /**
   * The project's shared MySQL.
   *
   * Discrete variables rather than one DATABASE_URL, so each is greppable and
   * overridable on its own. The host hands out a Service URI — split it across
   * these five and drop the `?ssl-mode=REQUIRED`, which the driver does not
   * understand. DB_SSL and DB_SSL_CA below do that job instead.
   *
   * The password is only ever read from .env, which is gitignored; nothing here
   * reaches a VITE_* variable.
   */
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT ?? 3306),
    name: process.env.DB_NAME || 'yatrio',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD ?? '',
    dialect: process.env.DB_DIALECT || 'mysql',

    /** TLS on by default: managed MySQL hosts (Aiven included) require it. */
    ssl: process.env.DB_SSL ? /^(1|true|yes)$/i.test(process.env.DB_SSL) : null,
    /**
     * Managed providers hand out a private CA that is not in Node's trust
     * store, so verification fails until you point DB_SSL_CA at the PEM. With a
     * CA configured we can and do verify; without one we cannot, and saying so
     * is better than a connection error nobody can explain.
     */
    sslRejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED
      ? /^(1|true|yes)$/i.test(process.env.DB_SSL_REJECT_UNAUTHORIZED)
      : Boolean(process.env.DB_SSL_CA),
    sslCa: process.env.DB_SSL_CA || null,

    poolMax: Number(process.env.DB_POOL_MAX ?? 5),

    /**
     * Seconds a statement waits for a row lock before failing, per session.
     *
     * InnoDB waits 50 by default, which is a denial of service wearing a
     * sensible-looking number: seat claims and releases are all conditional
     * `UPDATE seat_inventory`, so a tatkal opening funnels hundreds of
     * sessions onto a handful of rows and every one of them holds a pooled
     * connection for the whole wait. The pool is then exhausted and requests
     * fail on pool acquire -- a timeout that looks nothing like the thing that
     * actually happened.
     *
     * Overridable per environment, because the right value depends on how long
     * a claim legitimately takes to win its berth, not on taste.
     */
    lockWaitSeconds: Number(process.env.DB_LOCK_WAIT_SECONDS ?? 5),
    /** Off by default — services/paymentStore.js already emits payment events. */
    logging: process.env.DB_LOGGING ? /^(1|true|yes)$/i.test(process.env.DB_LOGGING) : false,
  },

  /**
   * Redis — the optional cache and rate-limit store.
   *
   * Optional in the strict sense: the cache falls through to MySQL on a miss
   * and the rate limiter counts in memory, so a missing Redis costs speed, not
   * availability. REDIS_ENABLED=false skips the client entirely, which is what
   * you want on a machine that will never run one — without it every request
   * pays the reconnect backoff first.
   */
  redis: {
    enabled: process.env.REDIS_ENABLED
      ? /^(1|true|yes)$/i.test(process.env.REDIS_ENABLED)
      : true,
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD || null,
    db: Number(process.env.REDIS_DB ?? 0),
  },

  isMockRazorpay: placeholderKeys.length > 0,
}