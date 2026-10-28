'use strict'

/**
 * BookingPassenger — one traveller on a booking.
 *
 * Split out rather than a JSON column because the manifest is queried, not just
 * rendered: a future "how many passengers on this train this week" report should
 * not have to parse JSON. The seat a passenger ends up with is resolved from the
 * hold at confirmation time, so this stores the answer rather than the question.
 */

const { DataTypes, Model, literal } = require('sequelize')

const TABLE = 'booking_passengers'

class BookingPassenger extends Model {
  static init(sequelize) {
    return super.init(
      {
        passengerId: {
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
        fullName: { type: DataTypes.STRING(120), allowNull: false },
        age: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: true },
        gender: { type: DataTypes.STRING(16), allowNull: true },
        berthType: { type: DataTypes.STRING(24), allowNull: true },
        /** Resolved from the hold at confirmation, so the record is a fact. */
        coachCode: { type: DataTypes.STRING(8), allowNull: true },
        seatCode: { type: DataTypes.STRING(8), allowNull: true },
        position: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: false, defaultValue: 1 },
      },
      {
        sequelize,
        modelName: 'BookingPassenger',
        tableName: TABLE,
        underscored: true,
        freezeTableName: true,
        timestamps: true,
        indexes: [
          { name: 'idx_booking_passengers_booking', fields: ['booking_id', 'position'] },
          // A berth cannot hold two passengers on one booking.
          { name: 'uq_booking_passengers_seat', unique: true, fields: ['booking_id', 'coach_code', 'seat_code'] },
        ],
      },
    )
  }
}

BookingPassenger.TABLE = TABLE

module.exports = (sequelize) => BookingPassenger.init(sequelize)
module.exports.BookingPassenger = BookingPassenger
module.exports.TABLE = TABLE
module.exports.DataTypes = DataTypes