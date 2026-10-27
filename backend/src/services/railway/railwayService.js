const pool = require('../../config/db');
const cache = require('./cacheService');
const railwayApiAdapter = require('./railwayApiAdapter');

class RailwayService {
  /**
   * Get paginated stations list
   */
  async getAllStations({ page = 1, limit = 20, search = '' }) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    const cacheKey = `stations:all:${pageNum}:${limitNum}:${search}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    let countQuery = 'SELECT COUNT(*) as total FROM stations WHERE status = "active"';
    let dataQuery = `
      SELECT id, station_code as code, station_name as name, city, state, timezone, status
      FROM stations
      WHERE status = "active"
    `;
    const params = [];

    if (search && search.trim()) {
      const searchTerm = `%${search.trim()}%`;
      countQuery += ' AND (station_code LIKE ? OR station_name LIKE ? OR city LIKE ?)';
      dataQuery += ' AND (station_code LIKE ? OR station_name LIKE ? OR city LIKE ?)';
      params.push(searchTerm, searchTerm, searchTerm);
    }

    dataQuery += ' ORDER BY station_name ASC LIMIT ? OFFSET ?;';

    const [[countResult]] = await pool.query(countQuery, params);
    const total = countResult ? countResult.total : 0;

    const [rows] = await pool.query(dataQuery, [...params, limitNum, offset]);

    const result = {
      stations: rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum) || 1,
      },
    };

    cache.set(cacheKey, result, 120); // 2 minutes cache
    return result;
  }

  /**
   * Search stations by name or code using stored procedure
   */
  async searchStations(query, limit = 10) {
    const cleanQuery = (query || '').trim();
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 10));

    const cacheKey = `stations:search:${cleanQuery}:${limitNum}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    // Call stored procedure
    const [procResults] = await pool.query('CALL search_stations(?, ?, ?);', [
      cleanQuery,
      limitNum,
      0,
    ]);

    const stations = (procResults[0] || []).map((s) => ({
      id: s.id,
      code: s.station_code,
      name: s.station_name,
      city: s.city,
      state: s.state,
      status: s.status,
    }));

    cache.set(cacheKey, stations, 180); // 3 minutes cache
    return stations;
  }

  /**
   * Search trains between two stations on a specific date
   */
  async searchTrainsBetween({ fromCode, toCode, journeyDate }) {
    const normalizedFrom = fromCode.trim().toUpperCase();
    const normalizedTo = toCode.trim().toUpperCase();

    const cacheKey = `trains:between:${normalizedFrom}:${normalizedTo}:${journeyDate}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    // Call stored procedure search_trains_between_stations
    const [results] = await pool.query(
      'CALL search_trains_between_stations(?, ?, ?);',
      [normalizedFrom, normalizedTo, journeyDate]
    );

    const rows = results[0] || [];

    const trains = rows.map((row) => {
      // Parse JSON classes if string or use object
      let parsedClasses = [];
      if (typeof row.classes_json === 'string') {
        try {
          parsedClasses = JSON.parse(row.classes_json);
        } catch {
          parsedClasses = [];
        }
      } else if (Array.isArray(row.classes_json)) {
        parsedClasses = row.classes_json;
      }

      // Parse running days string into array
      const runningDays = (row.running_days || '')
        .split(',')
        .map((d) => d.trim())
        .filter(Boolean);

      return {
        trainId: String(row.train_id),
        trainNumber: row.train_number,
        trainName: row.train_name,
        trainType: row.train_type,
        status: row.train_status,
        departure: row.departure_time,
        departurePlatform: row.departure_platform,
        arrival: row.arrival_time,
        arrivalPlatform: row.arrival_platform,
        duration: row.duration,
        distanceKm: parseFloat(row.travel_distance_km) || 0,
        intermediateStops: row.intermediate_stops_count,
        runningDays,
        classes: parsedClasses.map((cls) => ({
          type: cls.classCode,
          name: cls.className,
          fare: parseFloat(cls.fare) || 0,
          availableSeats: cls.availableSeats || 0,
          totalSeats: cls.totalSeats || 0,
          status: cls.status || (cls.availableSeats > 0 ? 'AVAILABLE' : 'WAITING'),
        })),
        pantryAvailable: Boolean(row.pantry_available),
      };
    });

    const responseData = {
      from: {
        code: rows[0]?.from_station_code || normalizedFrom,
        name: rows[0]?.from_station_name || normalizedFrom,
      },
      to: {
        code: rows[0]?.to_station_code || normalizedTo,
        name: rows[0]?.to_station_name || normalizedTo,
      },
      date: journeyDate,
      total: trains.length,
      trains,
    };

    cache.set(cacheKey, responseData, 60); // 1 minute cache
    return responseData;
  }

  /**
   * Search general trains by number or name
   */
  async searchTrains({ query = '', type = '', page = 1, limit = 20 }) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    let sql = `
      SELECT t.id, t.train_number, t.train_name, t.train_type, t.status, t.pantry_available,
             (
               SELECT GROUP_CONCAT(trd.day_of_week ORDER BY FIELD(trd.day_of_week, 'MON','TUE','WED','THU','FRI','SAT','SUN') SEPARATOR ',')
               FROM train_running_days trd
               WHERE trd.train_id = t.id
             ) AS running_days
      FROM trains t
      WHERE t.status = 'active'
    `;
    const params = [];

    if (query && query.trim()) {
      sql += ' AND (t.train_number LIKE ? OR t.train_name LIKE ?)';
      params.push(`%${query.trim()}%`, `%${query.trim()}%`);
    }

    if (type && type.trim()) {
      sql += ' AND t.train_type = ?';
      params.push(type.trim());
    }

    sql += ' ORDER BY t.train_number ASC LIMIT ? OFFSET ?;';
    params.push(limitNum, offset);

    const [rows] = await pool.query(sql, params);

    return rows.map((r) => ({
      id: String(r.id),
      number: r.train_number,
      name: r.train_name,
      type: r.train_type,
      status: r.status,
      pantryAvailable: Boolean(r.pantry_available),
      runningDays: (r.running_days || '').split(',').filter(Boolean),
    }));
  }

  /**
   * Get detailed train info including complete route and classes
   */
  async getTrainDetails(trainNo) {
    const cleanTrainNo = String(trainNo).trim();
    const cacheKey = `train:details:${cleanTrainNo}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    // 1. Fetch train basic info
    const [[train]] = await pool.query(
      'SELECT id, train_number, train_name, train_type, status, pantry_available FROM trains WHERE train_number = ? OR id = ? LIMIT 1;',
      [cleanTrainNo, cleanTrainNo]
    );

    if (!train) {
      return null;
    }

    // 2. Fetch full route
    const [routes] = await pool.query(
      `SELECT r.stop_sequence, r.arrival_time, r.departure_time, r.distance_km, r.day_offset, r.halt_minutes, r.platform,
              s.id as station_id, s.station_code, s.station_name, s.city, s.state
       FROM train_routes r
       INNER JOIN stations s ON s.id = r.station_id
       WHERE r.train_id = ?
       ORDER BY r.stop_sequence ASC;`,
      [train.id]
    );

    // 3. Fetch running days
    const [days] = await pool.query(
      `SELECT day_of_week FROM train_running_days 
       WHERE train_id = ? 
       ORDER BY FIELD(day_of_week, 'MON','TUE','WED','THU','FRI','SAT','SUN');`,
      [train.id]
    );

    // 4. Fetch classes
    const [classes] = await pool.query(
      `SELECT class_code, class_name, base_fare, total_seats, available_seats 
       FROM train_classes 
       WHERE train_id = ?;`,
      [train.id]
    );

    // Origin and destination stations
    const sourceRoute = routes[0];
    const destRoute = routes[routes.length - 1];

    const result = {
      id: String(train.id),
      trainNumber: train.train_number,
      trainName: train.train_name,
      trainType: train.train_type,
      status: train.status,
      pantryAvailable: Boolean(train.pantry_available),
      source: sourceRoute
        ? {
            code: sourceRoute.station_code,
            name: sourceRoute.station_name,
            departureTime: sourceRoute.departure_time,
          }
        : null,
      destination: destRoute
        ? {
            code: destRoute.station_code,
            name: destRoute.station_name,
            arrivalTime: destRoute.arrival_time,
          }
        : null,
      totalDistanceKm: destRoute ? parseFloat(destRoute.distance_km) : 0,
      runningDays: days.map((d) => d.day_of_week),
      classes: classes.map((c) => ({
        type: c.class_code,
        name: c.class_name,
        fare: parseFloat(c.base_fare),
        availableSeats: c.available_seats,
        totalSeats: c.total_seats,
        status: c.available_seats > 0 ? 'AVAILABLE' : 'WAITING',
      })),
      stops: routes.map((r) => ({
        sequence: r.stop_sequence,
        station: {
          id: String(r.station_id),
          code: r.station_code,
          name: r.station_name,
          city: r.city,
          state: r.state,
        },
        arrivalTime: r.arrival_time ? r.arrival_time.slice(0, 5) : null,
        departureTime: r.departure_time ? r.departure_time.slice(0, 5) : null,
        distanceKm: parseFloat(r.distance_km),
        day: r.day_offset,
        haltMinutes: r.halt_minutes,
        platform: r.platform,
      })),
    };

    cache.set(cacheKey, result, 300); // 5 minutes cache
    return result;
  }
}

module.exports = new RailwayService();
