'use strict'

/**
 * Request recorder — feeds `api_request_logs`.
 *
 * morgan (requestLoggerMiddleware) already writes every request to stdout. That
 * is the right place for a developer watching a terminal and the wrong place for
 * anything an operator needs afterwards: stdout is not queryable, it has no
 * latency column, and it disappears when the container restarts. Admin ›
 * Monitoring reads this table, and it was permanently empty because nothing
 * wrote to it.
 *
 * ## Two decisions worth stating
 *
 * **It writes on `finish`, not on the way in.** The status code and content
 * length do not exist until the response has been produced, and recording them
 * before the fact means recording 200 for requests that then fail.
 *
 * **It never throws.** A monitoring failure must not become a user-visible 500.
 * A dropped log row is a gap in the telemetry, not an error in the request.
 */

const { randomUUID } = require('node:crypto');
// `config/db` exports the query object itself, not a wrapper.
const db = require('../config/db');
const audit = require('../services/auditService');

/**
 * Paths excluded from recording.
 *
 * `/health` is polled every few seconds by load balancers, and on its own would
 * bury a real request in noise. `__noLog` is honoured so a single handler can
 * opt out without needing a path list here.
 */
const EXCLUDE = [/^\/health$/];

const shouldSkip = (req) =>
  req.__noLog === true || EXCLUDE.some((re) => re.test(req.path ?? ''));

function requestRecorder({ logger = console } = {}) {
  return function record(req, res, next) {
    if (shouldSkip(req)) return next();

    const startedAt = process.hrtime.bigint();
    const requestId = req.headers['x-request-id'] || randomUUID();

    // Echoed back so a support ticket quoting a response id can be traced back
    // to the row.
    res.setHeader('X-Request-Id', requestId);

    res.on('finish', () => {
      const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

      // Deliberately not awaited: the response has already been sent, and
      // awaiting here would hold the socket open for the duration of a
      // bookkeeping INSERT — adding that INSERT's latency to every request.
      db
        .query(
          `INSERT INTO api_request_logs (request_id, endpoint, method, status_code, latency_ms, actor_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            String(requestId).slice(0, 50),
            String(req.originalUrl ?? req.url ?? '').slice(0, 255),
            String(req.method ?? '').slice(0, 10),
            Number(res.statusCode) || 0,
            Math.round(latencyMs),
            audit.actorOf(req),
          ],
        )
        .catch((err) => logger.error(`[Yatrio] request log write failed: ${err.message}`));
    });

    return next();
  };
}

module.exports = { requestRecorder };
