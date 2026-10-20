'use strict'

/**
 * CoachSeat — one berth inside one coach.
 *
 * The thing a seat hold ultimately points at. `seat_code` is what the traveller
 * sees on the diagram ("24"); `seat_id` is what the database uses to say two
 * bookings are competing for the same physical berth.
 *
 * Team 3's table per the assignment's master list.
 */

const { DataTypes, Model } = require('sequelize')

const TABLE = 'coach_seats'

const BERTH_TYPES = [
  'LOWER',
  'MIDDLE',
  'UPPER',
  'SIDE_LOWER',
  'SIDE_MIDDLE',
  'SIDE_UPPER',
  'CHAIR',
  'SEAT',
]

class CoachSeat extends Model {
  static init(sequelize) {
    return super.init(
      {
        seatId: {
          type: DataTypes.BIGINT.UNSIGNED,
          primaryKey: true,
          autoIncrement: true,
          allowNull: false,
        },
        coachId: {
          type: DataTypes.BIGINT.UNSIGNED,
          allowNull: false,
          references: { model: 'coaches', key: 'coach_id' },
          onDelete: 'CASCADE',
          onUpdate: 'CASCADE',
        },
        /** '24' — stable within the coach, and what the UI displays. */
        seatCode: { type: DataTypes.STRING(8), allowNull: false },
        berthType: { type: DataTypes.ENUM(...BERTH_TYPES), allowNull: false },
        position: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: false, defaultValue: 1 },
      },
      {
        sequelize,
        modelName: 'CoachSeat',
        tableName: TABLE,
        underscored: true,
        freezeTableName: true,
        timestamps: true,
        indexes: [{ name: 'uq_coach_seats_coach_code', unique: true, fields: ['coach_id', 'seat_code'] }],
      },
    )
  }
}

CoachSeat.TABLE = TABLE
CoachSeat.BERTH_TYPES = BERTH_TYPES

module.exports = (sequelize) => CoachSeat.init(sequelize)
module.exports.CoachSeat = CoachSeat
module.exports.TABLE = TABLE
module.exports.DataTypes = DataTypes
module.exports.BERTH_TYPES = BERTH_TYPES