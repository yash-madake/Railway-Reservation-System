const express = require('express');
const router = express.Router();

const adminController = require('../controllers/adminController');
const reportController = require('../controllers/reportController');
const analyticsController = require('../controllers/analyticsController');
const monitoringController = require('../controllers/monitoringController');

// All routes here will be protected by authMiddleware AND adminMiddleware in server.js

// D. Dashboard
router.get('/dashboard', adminController.getDashboard);

// E. Users
router.get('/users', adminController.getUsers);

// F. Trains
router.get('/trains', adminController.getTrains);

// G. Bookings
router.get('/bookings', adminController.getBookings);

// H. Payments
router.get('/payments', adminController.getPayments);

// I. Cancellations
router.get('/cancellations', adminController.getCancellations);

// J. Audit Logs
router.get('/audit-logs', adminController.getAuditLogs);

// K. Reports
router.get('/reports', reportController.getReports);

// L. Analytics
router.get('/analytics', analyticsController.getAnalytics);

// M. Monitoring (System)
router.get('/monitoring', monitoringController.getSystemMonitoring);

// N. Monitoring (API)
router.get('/monitoring/api', monitoringController.getApiMonitoring);

// O. Monitoring (PNR)
router.get('/monitoring/pnr', monitoringController.getPnrMonitoring);

module.exports = router;
