'use strict'

/**
 * Application-level audit trail.
 *
 * `railway_audit_logs` already records every INSERT/UPDATE/DELETE on `trains`,
 * `stations` and `train_routes`, written by database triggers. That answers
 * "what changed in the master data". It cannot answer "who cancelled this
 * booking", because bookings are not trigger-tracked and a row silently changing
 * status looks the same as one that was always that way.
 *
 * `audit_logs` is for that: business events, with an actor.
 *
 * ## Why it is never allowed to break a request
 *
 * This is bookkeeping. A failure to write an audit row is not a reason to fail a
 * payment, so every write is fire-and-forget and swallows its own errors. That is
 * the right trade here and the wrong one for anything the user is shown.
 *
 * The one exception is logging the failure at all: a silently non-functioning
 * audit trail is worse than no audit trail, because it looks like it is working.
 */

// `config/db` exports the query object itself, not a wrapper — see
// adminController, which calls `db.query(...)` directly.
const db = require('../config/db');

/** Actions worth recording. Kept short so the table stays queryable. */
const ACTIONS = {
  LOGIN: 'USER_LOGIN',
  REGISTER: 'USER_REGISTERED',
  BOOKING_CREATED: 'BOOKING_CREATED',
  BOOKING_CONFIRMED: 'BOOKING_CONFIRMED',
  BOOKING_CANCELLED: 'BOOKING_CANCELLED',
  BOOKING_EXPIRED: 'BOOKING_EXPIRED',
  ORDER_CREATED: 'PAYMENT_ORDER_CREATED',
  PAYMENT_CAPTURED: 'PAYMENT_CAPTURED',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  PAYMENT_REFUNDED: 'PAYMENT_REFUNDED',
};

const ENTITIES = {
  USER: 'user',
  BOOKING: 'booking',
  PAYMENT: 'payment',
  REFUND: 'refund',
};

/**
 * Record one event.
 *
 * @param {object} event
 * @param {string} event.action    one of ACTIONS
 * @param {string} event.entity    one of ENTITIES
 * @param {string|number} [event.entityId]
 * @param {number} [event.actorId]  null for system/anonymous
 * @param {object}  [event.details] JSON payload; must be serialisable
 * @returns {Promise<void>} never rejects
 */
async function record({ action, entity, entityId = null, actorId = null, details = null } = {}) {
  if (!action || !entity) return;

  try {
    // JSON.stringify throws on a circular reference or a BigInt, and this must
    // not take down the caller. Anything unserialisable becomes a note rather
    // than a lost row.
    let payload = null;
    if (details !== null && details !== undefined) {
      try {
        payload = JSON.stringify(details, (_key, value) =>
          typeof value === 'bigint' ? value.toString() : value,
        );
      } catch {
        payload = JSON.stringify({ note: 'details were not serialisable' });
      }
    }

    await db.query(
      `INSERT INTO audit_logs (actor_id, action, entity, entity_id, details)
       VALUES (?, ?, ?, ?, ?)`,
      [actorId, String(action).slice(0, 100), String(entity).slice(0, 100), entityId == null ? null : String(entityId), payload],
    );
  } catch (err) {
    console.error(`[Yatrio] audit write failed (${action}/${entity}):`, err.message);
  }
}

/**
 * The authenticated user's id, if there is one.
 *
 * The auth middleware in this codebase is per-route rather than global, so
 * `req.user` is present on some requests and absent on most. Returns null rather
 * than guessing, because a wrong actor_id is worse than an unassigned one —
 * `actor_id` is a foreign key to `users(id)` and would be rejected anyway.
 */
function actorOf(req) {
  const id = req?.user?.id ?? req?.user?.userId ?? null;
  return id == null ? null : id;
}

module.exports = { record, ACTIONS, ENTITIES, actorOf };
