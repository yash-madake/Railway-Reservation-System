const express = require('express');
const {
  searchTrainsBetween,
  searchTrains,
  getTrainDetails,
  getTrainStatus,
  getNetworkStats,
  getTrainSchedule,
  getTrainAvailability,
  getTrainFare,
  getTrainClasses,
  getQuotas,
} = require('../controllers/trainController');

const router = express.Router();

router.get('/between', searchTrainsBetween);
router.get('/search', searchTrains);
router.get('/quotas', getQuotas);
router.get('/status/:trainNo', getTrainStatus);
// Declared before `/:trainNo`, which would otherwise swallow it
router.get('/stats', getNetworkStats);
router.get('/:trainNo/schedule', getTrainSchedule);
router.get('/:trainNo/availability', getTrainAvailability);
router.get('/:trainNo/fare', getTrainFare);
router.get('/:trainNo/classes', getTrainClasses);
router.get('/:trainNo', getTrainDetails);

module.exports = router;
