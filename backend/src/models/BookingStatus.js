'use strict'

/**
 * BookingStatus — the history of a booking's state.
 *
 * `bookings.status` answers "is this paid", which is what almost every query
 * needs. This answers "when did it stop being held, and why", which is what a
 * refund query or a support conversation needs, and which a single mutable
 * column cannot provide.
 *
 * Appended to by bookingService on every transition. Deliberately not maintained
 * by a trigger: the legal-transition rule ("a captured payment must never go
 * back to HELD") needs to compare against the previous value, and a trigger that
 * could not express it would have to be duplicated in application code anyway.
 */

const { DataTypes, Model, literal } = require('sequelize')

const TABLE = 'booking_status'
const { STATUSES } = require('./Booking')

class BookingStatus extends Model {
  static init(sequelize) {
    return super.init(
      {
        statusId: {
          type: DataTypes.BIGINT.UNSIGNED,
          primaryKey: true,
          autoIncrement: true,
          allowNull: false,
        },
        bookingId: {
          type: DataTypes.BIGINT.UNSIGNED,
          allowNull: false,
          references: { model: 'bookings', key: 'booking_id' },
          onDelete: 'CASCADE',
          onUpdate: 'CASCADE',
        },
        status: { type: DataTypes.ENUM(...STATUSES), allowNull: false },
        /**
         * Why the transition happened — 'payment_captured', 'cancelled_by_user',
         * 'hold_expired'. Free text rather than an enum because the set is still
         * growing, and an unknown reason is more useful than a rejected write.
         */
        reason: { type: DataTypes.STRING(64), allowNull: true },
        note: { type: DataTypes.STRING(255), allowNull: true },
        /** 'system', 'user:7' — who caused it. */
        changedBy: { type: DataTypes.STRING(64), allowNull: true },
        changedAt: { type: DataTypes.DATE(3), allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP(3)') },
      },
      {
        sequelize,
        modelName: 'BookingStatus',
        tableName: TABLE,
        underscored: true,
        freezeTableName: true,
        // `changed_at` is the meaningful time here; there is no created/updated
        // pair because a history row is never edited.
        timestamps: false,
        indexes: [
          { name: 'idx_booking_status_booking', fields: ['booking_id', 'changed_at'] },
          { name: 'idx_booking_status_time', fields: ['status', 'changed_at'] },
        ],
      },
    )
  }
}

BookingStatus.TABLE = TABLE

module.exports = (sequelize) => BookingStatus.init(sequelize)
module.exports.BookingStatus = BookingStatus
module.exports.TABLE = TABLE
module.exports.DataTypes = DataTypes