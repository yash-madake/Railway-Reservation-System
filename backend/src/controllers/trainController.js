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

/**
 * GET /trains/:trainNo/schedule
 * Return the complete station-by-station schedule in sequence
 */
async function getTrainSchedule(req, res) {
  try {
    const { trainNo } = req.params;
    if (!trainNo || !trainNo.trim()) {
      return res.status(400).json({
        success: false,
        error: { code: 'TRAIN_NUMBER_REQUIRED', message: 'Train number is required' },
      });
    }

    const pool = require('../config/db');
    const [results] = await pool.query('CALL get_train_schedule(?);', [trainNo.trim()]);
    const stops = results[0] || [];

    if (!stops.length) {
      return res.status(404).json({
        success: false,
        error: { code: 'TRAIN_NOT_FOUND', message: `No schedule found for train "${trainNo}"` },
      });
    }

    const first = stops[0];
    const last = stops[stops.length - 1];

    return res.status(200).json({
      success: true,
      message: 'Train schedule retrieved successfully',
      data: {
        trainNumber: trainNo.trim(),
        source: { code: first.station_code, name: first.station_name, departureTime: first.departure_time },
        destination: { code: last.station_code, name: last.station_name, arrivalTime: last.arrival_time },
        totalDistanceKm: last.distance_km,
        totalStops: stops.length,
        stops: stops.map((s) => ({
          stopSequence: s.stop_sequence,
          stationCode: s.station_code,
          stationName: s.station_name,
          city: s.city,
          state: s.state,
          railwayZone: s.railway_zone,
          arrivalTime: s.arrival_time,
          departureTime: s.departure_time,
          distanceKm: s.distance_km,
          dayOffset: s.day_offset,
          haltMinutes: s.halt_minutes,
          platform: s.platform,
        })),
      },
    });
  } catch (error) {
    console.error(`Error fetching schedule for ${req.params.trainNo}:`, error);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to retrieve train schedule' },
    });
  }
}

/**
 * GET /trains/:trainNo/availability
 * Return date & quota specific seat availability and ConfirmTkt predictions
 */
async function getTrainAvailability(req, res) {
  try {
    const { trainNo } = req.params;
    const { date, class: classCode, travelClass, quota = 'GN' } = req.query;
    const cls = classCode || travelClass;

    if (!trainNo || !trainNo.trim()) {
      return res.status(400).json({
        success: false,
        error: { code: 'TRAIN_NUMBER_REQUIRED', message: 'Train number is required' },
      });
    }

    const journeyDate = date || new Date().toISOString().split('T')[0];
    const pool = require('../config/db');

    // If specific class requested, call get_train_availability
    if (cls) {
      const [results] = await pool.query('CALL get_train_availability(?, ?, ?, ?);', [
        trainNo.trim(),
        journeyDate,
        cls.trim().toUpperCase(),
        quota.trim().toUpperCase(),
      ]);
      const row = results[0]?.[0];

      if (row) {
        return res.status(200).json({
          success: true,
          message: 'Train availability retrieved successfully',
          data: {
            trainNumber: row.train_number,
            trainName: row.train_name,
            journeyDate: row.journey_date,
            travelClass: row.class_code,
            quota: row.quota_code,
            status: row.status,
            availableSeats: row.available_seats,
            racSeats: row.rac_seats,
            waitingSeats: row.waiting_seats,
            confirmationProbability: row.confirmation_probability,
            formattedStatus: row.formatted_status,
            isDemoData: true,
          },
        });
      }
    }

    // Otherwise return availability for all classes of this train
    const [allResults] = await pool.query('CALL get_available_seats(?, ?, ?);', [
      trainNo.trim(),
      journeyDate,
      quota.trim().toUpperCase(),
    ]);

    const classAvailabilities = (allResults[0] || []).map((c) => ({
      classCode: c.class_code,
      className: c.class_name,
      baseFare: parseFloat(c.base_fare) || 0,
      availableSeats: c.available_seats,
      racSeats: c.rac_seats,
      waitingSeats: c.waiting_seats,
      status: c.status,
      confirmationProbability: c.confirmation_probability,
      formattedStatus: c.formatted_status,
      isDemoData: true,
    }));

    return res.status(200).json({
      success: true,
      message: 'Classes availability retrieved successfully',
      data: {
        trainNumber: trainNo.trim(),
        journeyDate,
        quota: quota.trim().toUpperCase(),
        classes: classAvailabilities,
      },
    });
  } catch (error) {
    console.error(`Error fetching availability for ${req.params.trainNo}:`, error);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to retrieve train availability' },
    });
  }
}

/**
 * GET /trains/:trainNo/fare
 * Dynamically compute slab fare with GST
 */
async function getTrainFare(req, res) {
  try {
    const { trainNo } = req.params;
    const { from, to, class: classCode, travelClass } = req.query;
    const cls = classCode || travelClass || '3A';

    const pool = require('../config/db');

    let distanceKm = 1000; // default benchmark
    if (from && to && trainNo) {
      const [routeRows] = await pool.query(
        `SELECT s.station_code, r.distance_km, r.stop_sequence
           FROM train_routes r
           JOIN stations s ON s.id = r.station_id
           JOIN trains t ON t.id = r.train_id
          WHERE (t.train_number = ? OR t.id = ?) AND s.station_code IN (?, ?)
          ORDER BY r.stop_sequence ASC;`,
        [trainNo.trim(), trainNo.trim(), from.trim().toUpperCase(), to.trim().toUpperCase()]
      );

      if (routeRows.length === 2) {
        distanceKm = Math.abs(parseFloat(routeRows[1].distance_km) - parseFloat(routeRows[0].distance_km));
      }
    }

    await pool.query('CALL calculate_fare(?, ?, @base, @total);', [Math.max(1, Math.round(distanceKm)), cls.trim().toUpperCase()]);
    const [[fareResult]] = await pool.query('SELECT @base AS baseFare, @total AS totalFare;');

    return res.status(200).json({
      success: true,
      data: {
        trainNumber: trainNo.trim(),
        fromStation: from || 'Origin',
        toStation: to || 'Destination',
        distanceKm: Math.round(distanceKm),
        travelClass: cls.trim().toUpperCase(),
        baseFare: parseFloat(fareResult.baseFare) || 0,
        totalFare: parseFloat(fareResult.totalFare) || 0,
      },
    });
  } catch (error) {
    console.error('Error calculating fare:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to calculate journey fare' },
    });
  }
}

/**
 * GET /trains/:trainNo/classes
 * Return travel classes offered on this train
 */
async function getTrainClasses(req, res) {
  try {
    const { trainNo } = req.params;
    const pool = require('../config/db');

    const [rows] = await pool.query(
      `SELECT tc.class_code, tc.class_name, tc.base_fare, tc.total_seats, tc.available_seats
         FROM train_classes tc
         JOIN trains t ON t.id = tc.train_id
        WHERE t.train_number = ? OR t.id = ?;`,
      [trainNo.trim(), trainNo.trim()]
    );

    return res.status(200).json({
      success: true,
      data: rows.map((r) => ({
        classCode: r.class_code,
        className: r.class_name,
        baseFare: parseFloat(r.base_fare),
        totalSeats: r.total_seats,
        availableSeats: r.available_seats,
      })),
    });
  } catch (error) {
    console.error('Error fetching train classes:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to retrieve train classes' },
    });
  }
}

/**
 * GET /quotas
 * Return list of active IRCTC booking quotas
 */
async function getQuotas(req, res) {
  try {
    const pool = require('../config/db');
    let quotas = [];
    try {
      const [rows] = await pool.query('SELECT quota_code, quota_name, description FROM quotas WHERE is_active = TRUE;');
      quotas = rows.map((r) => ({ code: r.quota_code, name: r.quota_name, description: r.description }));
    } catch {
      quotas = [
        { code: 'GN', name: 'General Quota', description: 'Standard open booking quota' },
        { code: 'TQ', name: 'Tatkal Quota', description: 'Last-minute emergency travel quota' },
        { code: 'LD', name: 'Ladies Quota', description: 'Reserved quota for female passengers' },
        { code: 'PT', name: 'Premium Tatkal', description: 'Dynamic pricing tatkal quota' },
        { code: 'SS', name: 'Senior Citizen', description: 'Lower berth quota for seniors' },
      ];
    }

    return res.status(200).json({
      success: true,
      data: quotas,
    });
  } catch (error) {
    console.error('Error fetching quotas:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to retrieve quotas' },
    });
  }
}

module.exports = {
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
};
