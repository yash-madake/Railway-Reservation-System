'use strict'

/**
 * SeatInventory — which segments of one berth are currently spoken for.
 *
 * Exactly one row per (seat, journey date). That row is the seat's lock, and the
 * only place occupancy is recorded. A claim is a single conditional UPDATE:
 *
 *   UPDATE seat_inventory
 *      SET segment_mask = segment_mask | :mask
 *    WHERE seat_id = :seatId AND departure_date = :date
 *      AND (segment_mask & :mask) = 0;
 *
 * `affectedRows` of 1 means the traveller won; 0 means some other booking
 * already holds one of those segments. MySQL evaluates that predicate under the
 * row lock, so there is no read-then-write window and no dependency on the
 * application being the only writer — which matters, because it is not.
 *
 * See database/migrations/20260101000009-create-seat-inventory-and-holds.js for
 * how the bits map onto segments.
 */

const { DataTypes, Model } = require('sequelize')

const TABLE = 'seat_inventory'

class SeatInventory extends Model {
  static init(sequelize) {
    return super.init(
      {
        inventoryId: {
          type: DataTypes.BIGINT.UNSIGNED,
          primaryKey: true,
          autoIncrement: true,
          allowNull: false,
        },
        seatId: {
          type: DataTypes.BIGINT.UNSIGNED,
          allowNull: false,
          references: { model: 'coach_seats', key: 'seat_id' },
          onDelete: 'CASCADE',
          onUpdate: 'CASCADE',
        },
        /** A journey date, not a timestamp: tomorrow's berth is a different one. */
        departureDate: { type: DataTypes.DATEONLY, allowNull: false },
        /** Bit i set = segment i of this train's route is claimed. */
        segmentMask: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 },
      },
      {
        sequelize,
        modelName: 'SeatInventory',
        tableName: TABLE,
        underscored: true,
        freezeTableName: true,
        timestamps: true,
        indexes: [
          { name: 'uq_seat_inventory_seat_date', unique: true, fields: ['seat_id', 'departure_date'] },
          { name: 'idx_seat_inventory_departure_date', fields: ['departure_date'] },
        ],
      },
    )
  }
}

SeatInventory.TABLE = TABLE

module.exports = (sequelize) => SeatInventory.init(sequelize)
module.exports.SeatInventory = SeatInventory
module.exports.TABLE = TABLE
module.exports.DataTypes = DataTypes