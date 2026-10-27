const express = require('express');
const { authenticateJWT, requireAdmin } = require('../middleware/adminAuth');
const controller = require('../controllers/adminController');
const rateLimiter = require('../middleware/rateLimiter');
const router = express.Router();
router.use(rateLimiter, authenticateJWT, requireAdmin);
router.get('/dashboard', controller.dashboard);
router.get('/users', controller.users);
router.get('/trains', controller.trains);
router.get('/trains/:id', controller.trainDetail);
router.post('/trains/:id/routes', controller.addTrainRoute);
router.delete('/trains/:id/routes/:routeId', controller.deleteTrainRoute);
router.delete('/trains/:id', controller.deleteTrain);
router.get('/stations', controller.stations);
router.post('/stations', controller.createStation);
router.put('/stations/:id', controller.updateStation);
router.patch('/stations/:id/deactivate', controller.deactivateStation);
router.post('/trains', controller.createTrain);
router.patch('/trains/:id/deactivate', controller.deactivateTrain);
router.get('/bookings', controller.bookings);
router.get('/payments', controller.payments);
router.get('/cancellations', controller.cancellations);
router.get('/audit-logs', controller.auditLogs);
router.get('/monitoring', controller.monitoring);
router.get('/monitoring/api', controller.monitoring);
router.get('/monitoring/pnr', controller.monitoring);
router.get('/reports', controller.analytics);
router.get('/analytics', controller.analytics);
module.exports = router;
router.get(
  '/defence-candidates',
  controller.defenceCandidates
);