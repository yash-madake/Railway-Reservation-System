'use strict'

/**
 * SeatHold — one booking's claim on one berth, for a run of adjacent segments.
 *
 * A row exists only while the claim is live. Release *deletes* the row and
 * clears its bits from `seat_inventory`, rather than flagging it, so "a row
 * exists, therefore these segments are taken" needs no interpretation and the
 * two tables cannot disagree about which rows are authoritative.
 *
 * ## Statuses
 *
 *   held      provisional, expires_at is live, the sweeper will delete it
 *   confirmed paid for. Never deleted, so the segments stay sold.
 *
 * `released` and `expired` are deliberately absent: they are not states a row
 * rests in, they are the reason a row stops existing.
 *
 * ## Why the index is not unique
 *
 * The earlier journey-wide version of this table had
 * `UNIQUE (train, class, date, coach, seat)` and that was what excluded
 * double-booking. It cannot work here, because the whole point of a bitmask is
 * that one seat legitimately carries several concurrent rows whenever their
 * segment ranges are disjoint. Uniqueness now lives in `seat_inventory`, one
 * row per seat per date, where the mask is.
 *
 * Team 5 · Database column · master table `seat_holds`.
 */

const { DataTypes, Model } = require('sequelize')

const TABLE = 'seat_holds'

/** The only two states a row is ever in. */
const STATUSES = ['held', 'confirmed']

class SeatHold extends Model {
  static init(sequelize) {
    return super.init(
      {
        holdId: {
          type: DataTypes.BIGINT.UNSIGNED,
          primaryKey: true,
          autoIncrement: true,
          allowNull: false,
        },

        /**
         * bookings belongs to Team 4 and is still an in-memory stand-in, so this
         * is the reference string rather than a foreign key. It is the join key
         * that has to survive the hand-off (PAYMENTS.md §10).
         */
        bookingRef: { type: DataTypes.STRING(32), allowNull: false },

        seatId: {
          type: DataTypes.BIGINT.UNSIGNED,
          allowNull: false,
          references: { model: 'coach_seats', key: 'seat_id' },
          onDelete: 'CASCADE',
          onUpdate: 'CASCADE',
        },
        departureDate: { type: DataTypes.DATEONLY, allowNull: false },

        /** Boarding and dropping stop_sequence on this train's route. */
        fromStopSeq: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: false },
        toStopSeq: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: false },
        /**
         * The bits this booking claimed. Stored rather than recomputed so a
         * release can undo exactly what was taken even if the route is edited
         * later.
         */
        segmentMask: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },

        status: { type: DataTypes.ENUM(...STATUSES), allowNull: false, defaultValue: 'held' },

        /**
         * When the hold dies. Always stored, never derived from created_at at
         * read time: the deadline is agreed with the client the moment the
         * booking is confirmed, and a clock that moves would move it out from
         * under a traveller already staring at Checkout.
         */
        expiresAt: { type: DataTypes.DATE(3), allowNull: false },
        confirmedAt: { type: DataTypes.DATE(3), allowNull: true },
      },
      {
        sequelize,
        modelName: 'SeatHold',
        tableName: TABLE,
        underscored: true,
        freezeTableName: true,
        timestamps: true,
        indexes: [
          // Deliberately NOT unique — see the header.
          { name: 'idx_seat_holds_seat_date', fields: ['seat_id', 'departure_date'] },
          { name: 'idx_seat_holds_booking_ref', fields: ['booking_ref'] },
          // The sweeper's only query.
          { name: 'idx_seat_holds_expiry', fields: ['status', 'expires_at'] },
        ],
      },
    )
  }
}

SeatHold.TABLE = TABLE
SeatHold.STATUSES = STATUSES

module.exports = (sequelize) => SeatHold.init(sequelize)
module.exports.SeatHold = SeatHold
module.exports.TABLE = TABLE
module.exports.DataTypes = DataTypes
module.exports.STATUSES = STATUSES