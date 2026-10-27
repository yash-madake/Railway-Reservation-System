const express = require('express');
const cors = require('cors');
require('dotenv').config();

const pool = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const stationRoutes = require('./routes/stationRoutes');
const trainRoutes = require('./routes/trainRoutes');
const adminRoutes = require('./routes/adminRoutes');
const requestLogger = require('./middleware/requestLogger');

const app = express();

app.use(cors());
app.use(express.json());
app.use(requestLogger);

// Auth & User routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/admin', adminRoutes);

// Team 2 - Railway Search & Station Discovery routes
app.use('/api/v1/stations', stationRoutes);
app.use('/stations', stationRoutes);

app.use('/api/v1/trains', trainRoutes);
app.use('/trains', trainRoutes);

app.get('/', (req, res) => {
  res.json({
    message: 'RailSetu / Yatrio Backend is Running!',
    team2Endpoints: [
      'GET /stations',
      'GET /stations/search?q=:query',
      'GET /trains/search?q=:query',
      'GET /trains/between?from=:from&to=:to&date=:date',
      'GET /trains/:trainNo',
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
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected internal error occurred',
    },
  });
});

const PORT = process.env.PORT || 5000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

module.exports = app;