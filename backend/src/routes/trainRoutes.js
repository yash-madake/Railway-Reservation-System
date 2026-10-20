const express = require('express');
const {
  searchTrainsBetween,
  searchTrains,
  getTrainDetails,
  getTrainStatus,
  getNetworkStats,
} = require('../controllers/trainController');

const router = express.Router();

router.get('/between', searchTrainsBetween);
router.get('/search', searchTrains);
router.get('/status/:trainNo', getTrainStatus);
// Declared before `/:trainNo`, which would otherwise swallow it — the param
// route matches any single segment, so `/stats` would be read as a train called
// "stats" and answer 404.
router.get('/stats', getNetworkStats);
router.get('/:trainNo', getTrainDetails);

module.exports = router;
