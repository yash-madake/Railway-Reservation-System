'use strict'

/**
 * Booking — the durable record of a reservation.
 *
 * Replaces the in-memory Map that payment/bookingService.js kept. That Map was
 * the reason a booking reference held by the browser could name nothing after a
 * restart, which turned an ordinary 404 into a dead end the traveller could not
 * recover from.
 *
 * ## What is stored, and what is not
 *
 * The journey is stored by reference (`train_id`, `origin_station_id`,
 * `destination_station_id`) plus the segment the ticket is for
 * alongside `train_id` and the stop sequences. That is deliberate: a ticket is a
 * historical document, and a booking made in 2026 must still render as it was
 * even if the train is later renamed or a stop removed from its route. The
 * identifiers are kept for the joins; the values are kept for the record.
 */

const { DataTypes, Model, literal } = require('sequelize')

const TABLE = 'bookings'

/**
 *   HELD      seats are held, the payment window is running
 *   CONFIRMED paid for; the seat segments are permanently sold
 *   CANCELLED withdrawn by the traveller
 *   EXPIRED   the payment window closed unpaid
 *
 * Transitions are enforced in bookingService, not by the schema: MySQL CHECK
 * constraints cannot see the previous value, and the rule that matters — a
 * captured payment must never go back to HELD — needs to compare against it.
 */
const STATUSES = ['HELD', 'CONFIRMED', 'CANCELLED', 'EXPIRED'];

/** Statuses that still own their seat segments. */
const ACTIVE_STATUSES = ['HELD', 'CONFIRMED'];

/** Terminal: no further transitions are legal. */
const TERMINAL_STATUSES = ['CANCELLED', 'EXPIRED'];

class Booking extends Model {
  static init(sequelize) {
    return super.init(
      {
        bookingId: {
          type: DataTypes.BIGINT.UNSIGNED,
          primaryKey: true,
          autoIncrement: true,
          allowNull: false,
        },
        /** The public handle, and what the payment stage looks a booking up by. */
        bookingRef: { type: DataTypes.STRING(32), allowNull: false },
        /** NULL for an unregistered traveller — booking does not require an account. */
        userId: { type: DataTypes.INTEGER, allowNull: true },
        status: { type: DataTypes.ENUM(...STATUSES), allowNull: false, defaultValue: 'HELD' },

        /* ---- the journey, by reference ----
         *
         * Migration 011 removed trainNo/trainName and the four origin/destination
         * columns: they were copies of `trains` and `stations`, and the audit
         * found bookings already disagreeing with `trains.train_name`. The keys
         * below are the whole story now; names and codes are joined for display.
         *
         * `totalAmount` is deliberately NOT normalised — it is the price agreed
         * at the moment of booking and must not move if the fare table is edited.
         */
        trainId: { type: DataTypes.INTEGER, allowNull: true },
        travelClass: { type: DataTypes.STRING(10), allowNull: false },

        originStationId: { type: DataTypes.INTEGER, allowNull: false },
        destinationStationId: { type: DataTypes.INTEGER, allowNull: false },

        fromStopSeq: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: false },
        toStopSeq: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: false },
        segmentMask: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 },
        distanceKm: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },

        departureAt: { type: DataTypes.DATE(3), allowNull: true },
        arrivalAt: { type: DataTypes.DATE(3), allowNull: true },

        /** The agreed fare in paise, snapshotted so a price edit cannot move it. */
        totalAmount: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
        currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'INR' },

        contactEmail: { type: DataTypes.STRING(160), allowNull: true },
        contactPhone: { type: DataTypes.STRING(32), allowNull: true },
        extras: { type: DataTypes.JSON, allowNull: true },

        /** Copied from the seat hold so a booking can be aged without a join. */
        holdExpiresAt: { type: DataTypes.DATE(3), allowNull: true },

        confirmedAt: { type: DataTypes.DATE(3), allowNull: true },
        cancelledAt: { type: DataTypes.DATE(3), allowNull: true },
        cancellationReason: { type: DataTypes.STRING(255), allowNull: true },
      },
      {
        sequelize,
        modelName: 'Booking',
        tableName: TABLE,
        underscored: true,
        freezeTableName: true,
        timestamps: true,
        indexes: [
          { name: 'uq_bookings_ref', unique: true, fields: ['booking_ref'] },
          { name: 'idx_bookings_user_id', fields: ['user_id'] },
          { name: 'idx_bookings_status_created', fields: ['status', 'created_at'] },
          { name: 'idx_bookings_hold_expiry', fields: ['status', 'hold_expires_at'] },
          // train_id, not train_no: the number moved to `trains` in migration 011.
          { name: 'idx_bookings_train_departure', fields: ['train_id', 'departure_at'] },
        ],
      },
    )
  }
}

Booking.TABLE = TABLE;
Booking.STATUSES = STATUSES;
Booking.ACTIVE_STATUSES = ACTIVE_STATUSES;
Booking.TERMINAL_STATUSES = TERMINAL_STATUSES;

module.exports = (sequelize) => Booking.init(sequelize)
module.exports.Booking = Booking
module.exports.TABLE = TABLE
module.exports.DataTypes = DataTypes
module.exports.STATUSES = STATUSES
module.exports.ACTIVE_STATUSES = ACTIVE_STATUSES
module.exports.TERMINAL_STATUSES = TERMINAL_STATUSES