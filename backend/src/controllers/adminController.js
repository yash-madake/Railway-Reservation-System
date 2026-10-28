const pool = require('../config/db');
const { getPagination, formatPaginatedResponse } = require('../utils/pagination');
const { getSafeSortBy, getSafeSortOrder } = require('../utils/validation');
// Not `redis` directly: with Redis down the raw client rejects every command
// (offline queue disabled), and the dashboard then 500s instead of answering
// from MySQL. cacheService is the layer that treats Redis as optional.
const cache = require('../services/railway/cacheService');

// A. DASHBOARD API
const getDashboard = async (req, res, next) => {
    try {
        // We will call the 4 stored procedures from Phase 2
        // Check cache first
        const cacheKey = 'admin:dashboard:stats';
        const cached = await cache.get(cacheKey);
        if (cached) {
            return res.status(200).json(cached);
        }

        // 1. Core KPIs
        const [kpiRows] = await pool.query('CALL get_dashboard_statistics();');
        const kpis = kpiRows[0][0] || {};

        // 2. Daily Revenue (Fallback)
        const [revenueRows] = await pool.query('CALL get_daily_revenue(?, ?);', [null, null]);
        
        // 3. Popular Routes
        const [routesRows] = await pool.query('CALL get_popular_routes(5);');
        
        // 4. Train Occupancy
        const [occupancyRows] = await pool.query('CALL get_train_occupancy(5);');

        const responseData = {
            data: {
                kpis: {
                    totalUsers: kpis.total_users || 0,
                    activeUsers: kpis.active_users || 0,
                    totalTrains: kpis.total_trains || 0,
                    totalBookedSeats: kpis.total_booked_seats || 0,
                    estimatedRevenue: kpis.total_revenue || 0, // Not actual payment revenue
                },
                revenue: revenueRows[0] || [], // Estimated/demo reporting
                popularRoutes: routesRows[0] || [],
                trainOccupancy: occupancyRows[0] || [],
                systemHealth: {
                    status: 'OK', // Basic placeholder, monitoring endpoint provides detail
                    timestamp: new Date()
                }
            }
        };

        // Cache the dashboard data for 1 minute
        await cache.set(cacheKey, responseData, 60);

        res.status(200).json(responseData);
    } catch (err) {
        next(err);
    }
};

// B. USERS API
const getUsers = async (req, res, next) => {
    try {
        const { page, pageSize, search, role, status, sortBy, sortOrder } = req.query;
        const { limit, offset, page: p, pageSize: s } = getPagination(page, pageSize);
        const safeSortBy = getSafeSortBy(sortBy, ['id', 'full_name', 'email', 'created_at', 'role', 'status'], 'created_at');
        const safeSortOrder = getSafeSortOrder(sortOrder, 'DESC');

        let query = 'SELECT id, full_name, email, phone, role, status, created_at, updated_at FROM users WHERE 1=1';
        const params = [];

        if (search) {
            query += ' AND (full_name LIKE ? OR email LIKE ? OR phone LIKE ?)';
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }
        if (role) {
            query += ' AND role = ?';
            params.push(role);
        }
        if (status) {
            query += ' AND status = ?';
            params.push(status);
        }

        // Get total count
        const countQuery = `SELECT COUNT(*) as total FROM (${query}) AS subquery`;
        const [countRows] = await pool.query(countQuery, params);
        const total = countRows[0].total;

        // Get paginated data
        query += ` ORDER BY ${safeSortBy} ${safeSortOrder} LIMIT ? OFFSET ?`;
        params.push(limit, offset);

        const [rows] = await pool.query(query, params);

        res.status(200).json(formatPaginatedResponse(rows, total, p, s));
    } catch (err) {
        next(err);
    }
};

// C. TRAINS API
const getTrains = async (req, res, next) => {
    try {
        const { page, pageSize, search, status, sortBy, sortOrder } = req.query;
        const { limit, offset, page: p, pageSize: s } = getPagination(page, pageSize);
        const safeSortBy = getSafeSortBy(sortBy, ['id', 'train_number', 'train_name', 'status', 'created_at'], 'train_number');
        const safeSortOrder = getSafeSortOrder(sortOrder, 'ASC');

        let query = 'SELECT id, train_number, train_name, train_type, status, pantry_available, created_at FROM trains WHERE 1=1';
        const params = [];

        if (search) {
            query += ' AND (train_number LIKE ? OR train_name LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
        }
        if (status) {
            query += ' AND status = ?';
            params.push(status);
        }

        const countQuery = `SELECT COUNT(*) as total FROM (${query}) AS subquery`;
        const [countRows] = await pool.query(countQuery, params);
        const total = countRows[0].total;

        query += ` ORDER BY ${safeSortBy} ${safeSortOrder} LIMIT ? OFFSET ?`;
        params.push(limit, offset);

        const [rows] = await pool.query(query, params);

        res.status(200).json(formatPaginatedResponse(rows, total, p, s));
    } catch (err) {
        next(err);
    }
};

// D. BOOKINGS API
/**
 * Every booking on the platform, newest first.
 *
 * This returned `data: []` with "Team 4 schemas are pending merge". The tables
 * exist and are populated — `bookings` and `booking_passengers` are written by
 * `POST /bookings/confirm` on every real booking — so the admin console was
 * showing an empty table for live data.
 *
 * Filtered by `status` and `q` (a reference or train number), and paginated.
 * Reads through `pool` rather than the shared Sequelize instance because every
 * other handler in this file does, and mixing two pools in one controller is
 * how you end up with transactions that do not see each other's writes.
 */
const getBookings = async (req, res, next) => {
    try {
        const { page, pageSize, status, q } = req.query;
        const { limit, offset, page: p, pageSize: s } = getPagination(page, pageSize);

        const where = ['1=1'];
        const params = [];

        // Validated against the enum rather than interpolated, because this one
        // goes into a comparison against an ENUM column and an unknown value
        // would otherwise silently return nothing instead of being refused.
        if (status) {
            const allowed = ['HELD', 'CONFIRMED', 'CANCELLED', 'EXPIRED'];
            const wanted = String(status).toUpperCase();
            if (!allowed.includes(wanted)) {
                return res.status(400).json({
                    success: false,
                    error: { code: 'INVALID_STATUS', message: `status must be one of: ${allowed.join(', ')}` },
                });
            }
            where.push('b.status = ?');
            params.push(wanted);
        }

        if (q) {
            // `b.train_no` no longer exists; the train number lives on `trains`.
            where.push('(b.booking_ref LIKE ? OR t.train_number LIKE ? OR b.contact_email LIKE ?)');
            const like = `%${q}%`;
            params.push(like, like, like);
        }

        const clause = where.join(' AND ');

        const [rows] = await pool.query(
            // Train and station fields are joined rather than read off the
            // booking: migration 011 dropped the copied columns.
            `SELECT b.booking_id, b.booking_ref, b.status,
                    t.train_number, t.train_name, b.travel_class,
                    os.station_code AS origin_code, os.station_name AS origin_name,
                    ds.station_code AS destination_code, ds.station_name AS destination_name,
                    b.total_amount, b.currency, b.contact_email, b.created_at, b.confirmed_at, b.cancelled_at,
                    (SELECT COUNT(*) FROM booking_passengers bp WHERE bp.booking_id = b.booking_id) AS passenger_count
               FROM bookings b
               LEFT JOIN trains t    ON t.id  = b.train_id
               LEFT JOIN stations os ON os.id = b.origin_station_id
               LEFT JOIN stations ds ON ds.id = b.destination_station_id
              WHERE ${clause}
              ORDER BY b.created_at DESC
              LIMIT ? OFFSET ?`,
            [...params, limit, offset],
        );

        // Counted on the bare table: the joins above would fan out and inflate it.
        const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM bookings b WHERE ${clause}`, params);

        res.status(200).json(formatPaginatedResponse(rows, countRows[0].total, p, s));
    } catch (err) {
        next(err);
    }
};

// E. PAYMENTS API
/**
 * Captured, failed and refunded payments.
 *
 * Also a stub, for the same reason as the bookings list. `payments` is written
 * by the Razorpay flow, so this is live data too.
 */
const getPayments = async (req, res, next) => {
    try {
        const { page, pageSize, status, bookingRef } = req.query;
        const { limit, offset, page: p, pageSize: s } = getPagination(page, pageSize);

        const where = ['1=1'];
        const params = [];

        if (status) {
            const allowed = ['created', 'captured', 'failed', 'refunded'];
            const wanted = String(status).toLowerCase();
            if (!allowed.includes(wanted)) {
                return res.status(400).json({
                    success: false,
                    error: { code: 'INVALID_STATUS', message: `status must be one of: ${allowed.join(', ')}` },
                });
            }
            where.push('p.status = ?');
            params.push(wanted);
        }

        if (bookingRef) {
            where.push('p.booking_ref = ?');
            params.push(String(bookingRef).slice(0, 32));
        }

        const clause = where.join(' AND ');

        const [rows] = await pool.query(
            // `refunded_amount` was dropped in migration 011 — it duplicated
            // SUM(refunds.amount) with nothing keeping the two in step. Derived
            // here, coalesced because a payment with no refunds has nothing to sum.
            `SELECT p.payment_id, p.booking_ref, p.gateway_order_id, p.gateway_payment_id,
                    p.method_code, p.status, p.amount, p.currency,
                    p.failure_code, p.failure_reason,
                    p.created_at, p.captured_at,
                    (SELECT COUNT(*) FROM refunds r WHERE r.payment_id = p.payment_id) AS refund_count,
                    COALESCE((SELECT SUM(r2.amount) FROM refunds r2 WHERE r2.payment_id = p.payment_id), 0) AS refunded_amount
               FROM payments p
              WHERE ${clause}
              ORDER BY p.created_at DESC
              LIMIT ? OFFSET ?`,
            [...params, limit, offset],
        );

        const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM payments p WHERE ${clause}`, params);

        res.status(200).json(formatPaginatedResponse(rows, countRows[0].total, p, s));
    } catch (err) {
        next(err);
    }
};

// F. CANCELLATIONS API
/**
 * Withdrawn bookings.
 *
 * There is no `cancellations` table and there does not need to be one: a
 * cancellation is a `bookings` row in CANCELLED state, with a reason and a
 * timestamp. Reading that directly means the admin list and the passenger's
 * booking can never disagree about whether something was cancelled.
 */
const getCancellations = async (req, res, next) => {
    try {
        const { page, pageSize } = req.query;
        const { limit, offset, page: p, pageSize: s } = getPagination(page, pageSize);

        const [rows] = await pool.query(
            `SELECT b.booking_id, b.booking_ref,
                    t.train_number, t.train_name, b.travel_class,
                    os.station_code AS origin_code, os.station_name AS origin_name,
                    ds.station_code AS destination_code, ds.station_name AS destination_name,
                    b.total_amount, b.currency, b.contact_email,
                    b.cancellation_reason, b.cancelled_at, b.created_at,
                    (SELECT COUNT(*) FROM booking_passengers bp WHERE bp.booking_id = b.booking_id) AS passenger_count
               FROM bookings b
               LEFT JOIN trains t    ON t.id  = b.train_id
               LEFT JOIN stations os ON os.id = b.origin_station_id
               LEFT JOIN stations ds ON ds.id = b.destination_station_id
              WHERE b.status IN ('CANCELLED', 'EXPIRED')
              ORDER BY COALESCE(b.cancelled_at, b.updated_at) DESC
              LIMIT ? OFFSET ?`,
            [limit, offset],
        );

        const [countRows] = await pool.query(
            `SELECT COUNT(*) AS total FROM bookings WHERE status IN ('CANCELLED', 'EXPIRED')`,
        );

        res.status(200).json(formatPaginatedResponse(rows, countRows[0].total, p, s));
    } catch (err) {
        next(err);
    }
};

// G. AUDIT LOGS API
const getAuditLogs = async (req, res, next) => {
    try {
        const { page, pageSize, actor, action, entity, sortBy, sortOrder } = req.query;
        const { limit, offset, page: p, pageSize: s } = getPagination(page, pageSize);
        const safeSortBy = getSafeSortBy(sortBy, ['id', 'timestamp', 'action', 'entity'], 'timestamp');
        const safeSortOrder = getSafeSortOrder(sortOrder, 'DESC');

        let query = 'SELECT id, actor_id, action, entity, entity_id, details, timestamp FROM audit_logs WHERE 1=1';
        const params = [];

        if (actor) {
            query += ' AND actor_id = ?';
            params.push(actor);
        }
        if (action) {
            query += ' AND action = ?';
            params.push(action);
        }
        if (entity) {
            query += ' AND entity = ?';
            params.push(entity);
        }

        const countQuery = `SELECT COUNT(*) as total FROM (${query}) AS subquery`;
        const [countRows] = await pool.query(countQuery, params);
        const total = countRows[0].total;

        query += ` ORDER BY ${safeSortBy} ${safeSortOrder} LIMIT ? OFFSET ?`;
        params.push(limit, offset);

        const [rows] = await pool.query(query, params);

        res.status(200).json(formatPaginatedResponse(rows, total, p, s));
    } catch (err) {
        next(err);
    }
};

module.exports = {
    getDashboard,
    getUsers,
    getTrains,
    getBookings,
    getPayments,
    getCancellations,
    getAuditLogs
};
