const railwayService = require('../services/railway/railwayService');
const {
  validateJourneyDate,
  validateStationPair,
} = require('../validators/railwayValidators');

/**
 * GET /trains/between
 * Search trains between source station, destination station, and journey date
 * e.g. GET /trains/between?from=PUNE&to=MMCT&date=2026-10-15
 */
async function searchTrainsBetween(req, res) {
  try {
    const { from, to, date } = req.query;

    // 1. Validate date
    const dateValidation = validateJourneyDate(date);
    if (!dateValidation.isValid) {
      return res.status(400).json({
        success: false,
        error: {
          code: dateValidation.code,
          message: dateValidation.message,
        },
      });
    }

    // 2. Validate station pair
    const stationValidation = await validateStationPair(from, to);
    if (!stationValidation.isValid) {
      return res.status(400).json({
        success: false,
        error: {
          code: stationValidation.code,
          message: stationValidation.message,
        },
      });
    }

    // 3. Search trains
    const result = await railwayService.searchTrainsBetween({
      fromCode: from,
      toCode: to,
      journeyDate: date,
    });

    return res.status(200).json({
      success: true,
      message: `${result.total} trains found between ${from.toUpperCase()} and ${to.toUpperCase()}`,
      data: result,
    });
  } catch (error) {
    console.error('Error searching trains between stations:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred while searching trains',
      },
    });
  }
}

/**
 * GET /trains/search
 * Search trains by number or name
 */
async function searchTrains(req, res) {
  try {
    const { q, type, page, limit } = req.query;
    const trains = await railwayService.searchTrains({ query: q, type, page, limit });

    return res.status(200).json({
      success: true,
      message: 'Trains search completed successfully',
      data: trains,
    });
  } catch (error) {
    console.error('Error searching trains:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An error occurred while searching trains',
      },
    });
  }
}

/**
 * GET /trains/:trainNo
 * Return details for a specific train
 */
async function getTrainDetails(req, res) {
  try {
    const { trainNo } = req.params;

    if (!trainNo || !trainNo.trim()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'TRAIN_NUMBER_REQUIRED',
          message: 'Train number is required',
        },
      });
    }

    const train = await railwayService.getTrainDetails(trainNo);

    if (!train) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'TRAIN_NOT_FOUND',
          message: `Train with number "${trainNo}" was not found`,
        },
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Train details retrieved successfully',
      data: train,
    });
  } catch (error) {
    console.error(`Error fetching train details for ${req.params.trainNo}:`, error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An error occurred while fetching train details',
      },
    });
  }
}

/**
 * GET /trains/status/:trainNo
 * Return the timetable projection used by the Train Status page.
 */
async function getTrainStatus(req, res) {
  try {
    const { trainNo } = req.params;

    if (!trainNo || !trainNo.trim()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'TRAIN_NUMBER_REQUIRED',
          message: 'Train number is required',
        },
      });
    }

    const train = await railwayService.getTrainStatus(trainNo);

    if (!train) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'TRAIN_NOT_FOUND',
          message: `Train with number "${trainNo}" was not found`,
        },
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Train status timetable retrieved successfully',
      data: train,
    });
  } catch (error) {
    console.error(`Error fetching train status for ${req.params.trainNo}:`, error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An error occurred while fetching train status',
      },
    });
  }
}

/**
 * Public network figures, counted from the database.
 *
 * The marketing page used to open with "12,480 trains running", "98.4% on-time",
 * "2.4M daily passengers" and "1,840 connected routes" as literals. None of that
 * was measured, and two of the four are not derivable from anything the system
 * records — there is no on-time metric and no daily-passenger count, because
 * there is no live running feed.
 *
 * So this returns only what can honestly be counted: entities in the tables. The
 * two claims that had no basis are gone rather than replaced with a smaller
 * fiction.
 */
async function getNetworkStats(req, res) {
  try {
    const pool = require('../config/db');

    const [[counts]] = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM trains  WHERE status = 'active')                     AS trains,
        (SELECT COUNT(*) FROM stations WHERE status = 'active')                     AS stations,
        (SELECT COUNT(*) FROM train_classes)                                       AS travelClasses,
        (SELECT COUNT(*) FROM coaches)                                             AS coaches,
        (SELECT COUNT(*) FROM coach_seats)                                         AS berths
    `);

    // Busyest corridors, from the same stored procedure the admin dashboard reads.
    // Seeded rather than derived from live bookings, so it is a database figure
    // and not a claim about this deployment's traffic.
    let popularRoutes = [];
    try {
      const [rows] = await pool.query('CALL get_popular_routes(4);');
      popularRoutes = rows[0] ?? [];
    } catch (err) {
      // The procedure is optional seed data. Its absence must not take the whole
      // endpoint down — the counts above are the part that matters.
      console.error('get_popular_routes unavailable:', err.message);
    }

    return res.status(200).json({
      success: true,
      data: {
        counts: {
          trains: Number(counts.trains ?? 0),
          stations: Number(counts.stations ?? 0),
          travelClasses: Number(counts.travelClasses ?? 0),
          coaches: Number(counts.coaches ?? 0),
          berths: Number(counts.berths ?? 0),
        },
        popularRoutes,
      },
    });
  } catch (error) {
    console.error('Error fetching network stats:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Could not read network statistics',
      },
    });
  }
}

module.exports = {
  searchTrainsBetween,
  searchTrains,
  getTrainDetails,
  getTrainStatus,
  getNetworkStats,
};
