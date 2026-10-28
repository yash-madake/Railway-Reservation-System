'use strict'

/**
 * Coach — one physical carriage of a train, in a particular class.
 *
 * Not the same thing as a travel class: a train running 3A has several *coaches*
 * of 3A, and a seat is identified by its coach before it is identified by its
 * berth. `seat_holds` historically carried a bare `coach` string; this table is
 * what turns that string into a key the database can enforce.
 *
 * Team 3's table per the assignment's master list.
 */

const { DataTypes, Model } = require('sequelize')

const TABLE = 'coaches'

/** Carriage layouts, which also decide how many berths a coach carries. */
const COACH_TYPES = ['AC_FIRST', 'AC_2_TIER', 'AC_3_TIER', 'SLEEPER', 'CHAIR_CAR', 'EXECUTIVE', 'GENERAL']

class Coach extends Model {
  static init(sequelize) {
    return super.init(
      {
        coachId: {
          type: DataTypes.BIGINT.UNSIGNED,
          primaryKey: true,
          autoIncrement: true,
          allowNull: false,
        },
        trainId: {
          type: DataTypes.BIGINT.UNSIGNED,
          allowNull: false,
          references: { model: 'trains', key: 'id' },
          onDelete: 'CASCADE',
          onUpdate: 'CASCADE',
        },
        /** A coach only exists in a class the train actually offers. */
        classCode: {
          type: DataTypes.STRING(8),
          allowNull: false,
          references: { model: 'train_classes', key: 'class_code' },
          onUpdate: 'CASCADE',
        },
        /** 'B1', 'A2', 'S1' — how a booking record names it. */
        coachCode: { type: DataTypes.STRING(8), allowNull: false },
        // No `coach_type` here: migration 011 moved it to the `classes` lookup,
        // where a carriage layout belongs -- every 3A coach of a train has the
        // same one. Join `classes` (see holdService.journeyAvailability) rather
        // than carry a column that was a copy of the class row.
        position: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: false, defaultValue: 1 },
      },
      {
        sequelize,
        modelName: 'Coach',
        tableName: TABLE,
        underscored: true,
        freezeTableName: true,
        timestamps: true,
        indexes: [
          { name: 'uq_coaches_train_class_code', unique: true, fields: ['train_id', 'class_code', 'coach_code'] },
          { name: 'idx_coaches_train_class', fields: ['train_id', 'class_code'] },
        ],
      },
    )
  }
}

Coach.TABLE = TABLE
Coach.COACH_TYPES = COACH_TYPES

module.exports = (sequelize) => Coach.init(sequelize)
module.exports.Coach = Coach
module.exports.TABLE = TABLE
module.exports.DataTypes = DataTypes
module.exports.COACH_TYPES = COACH_TYPES