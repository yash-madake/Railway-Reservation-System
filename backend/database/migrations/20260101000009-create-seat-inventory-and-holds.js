'use strict'

/**
 * Seat inventory and segment booking — the schema behind "the same berth can be
 * sold twice on one train".
 *
 * ## Why a bitmask
 *
 * A seat is not booked for a whole journey, it is booked for a *run of adjacent
 * segments*. The 12002 has four: NDLS→AGC, AGC→GWL, GWL→JHS, JHS→BPL. A berth
 * sold NDLS→JHS occupies three of them and must stay empty for exactly those
 * three; a traveller boarding at JHS may take the same berth, because the
 * segment they need is still clear.
 *
 * So occupancy is a bitmask, one bit per segment:
 *
 *   bit 0        bit 1        bit 2        bit 3
 *   NDLS-AGC     AGC-GWL      GWL-JHS      JHS-BPL
 *
 * Two bookings may share a seat iff their masks do not intersect:
 *
 *   Rahul  NDLS→JHS  stops 1→4  mask 0111 = 7
 *   Priya  AGC→BPL   stops 2→5  mask 1110 = 14    7 & 14 = 0110  conflict
 *   Same berth, JHS→BPL  stops 4→5  mask 1000 = 8    7 & 8 = 0000  free
 *
 * `BIGINT UNSIGNED` is 64 bits. The longest route in the schema is nine stops,
 * eight segments, so there are fifty-six spare bits — the column will not be the
 * limit, and the CHECK constraint below enforces that rather than trusting the
 * client to stay inside it.
 *
 * ## Why inventory is its own table
 *
 * `seat_inventory` holds exactly one row per (seat, departure date) with the
 * mask currently claimed on it. That row is the lock. A claim is a single
 * conditional UPDATE:
 *
 *   UPDATE seat_inventory
 *      SET segment_mask = segment_mask | :mask
 *    WHERE seat_id = ? AND departure_date = ?
 *      AND (segment_mask & :mask) = 0;
 *
 * MySQL evaluates that predicate under the row lock, so it is a compare-and-swap
 * with no read-then-write window. `affectedRows` is 1 or the traveller lost the
 * race. This replaces the UNIQUE index that the earlier journey-wide version of
 * this table used — which cannot work here, because a seat legitimately has
 * several concurrent bookings now.
 *
 * ## Why release deletes rather than flags
 *
 * A hold that lapses clears its own bits with `segment_mask & ~mask`. That is
 * safe against neighbours: if A holds 0111 and B holds 1000, A expiring leaves
 * B untouched. Nor can a lapsed hold clear a bit that has since been re-claimed,
 * because its bits were held continuously for its whole life — there is no
 * window in which they were free for someone else to take.
 *
 * The audit trail for what happened to a booking lives in `payments`, not in a
 * pile of dead hold rows.
 *
 * ## Boundaries
 *
 * `booking_ref` is a plain string, not a foreign key: `bookings` is Team 4's
 * stand-in and is still in memory (PAYMENTS.md §10). Everything else here is
 * properly keyed. Coalesced to utf8mb4_unicode_ci to match the rest of the
 * schema, per the note in migration 008.
 */

const { DataTypes, literal } = require('sequelize')

const { TABLE: COACHES, COACH_TYPES } = require('../../src/models/Coach')
const { TABLE: COACH_SEATS, BERTH_TYPES } = require('../../src/models/CoachSeat')
const { TABLE: INVENTORY } = require('../../src/models/SeatInventory')
const { TABLE: HOLDS, STATUSES: HOLD_STATUSES } = require('../../src/models/SeatHold')

/**
 * Raw SQL - the sweeper and the expiry release compare against the database's own
 * clock, so the decision to free a seat is never made by an application server's
 * idea of the time.
 */
const STAMP = literal('CURRENT_TIMESTAMP(3)')

/** 64 bits is what BIGINT UNSIGNED gives us; the CHECK below refuses more. */
const MAX_SEGMENTS = 64

/**
 * One collation across the schema, applied rather than requested.
 *
 * `createTable`'s `collation` option does not reliably reach the emitted DDL
 * here — these tables came out on `utf8mb4_0900_ai_ci` while `train_classes`
 * sits on `utf8mb4_unicode_ci`, and the composite FK is then refused with
 * "referencing and referenced columns are incompatible". Migration 008 hit the
 * same wall for the payment tables and solved it by converting after creation;
 * this does the same, in `alignCollation`, and the `collation` option is left
 * off rather than left in as decoration that does nothing.
 */
const COLLATION = 'utf8mb4_unicode_ci'

module.exports = {
  async up(queryInterface) {
    // ---------------------------------------------------------------- coaches
    // Coach instances attached to a train, in a particular class.
    await queryInterface.createTable(
      COACHES,
      {
        coach_id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true, allowNull: false },
        /**
         * Team 2 created `trains` and `train_classes` with plain signed `INT`
         * and `VARCHAR(10)`, so these columns mirror that exactly. MySQL refuses
         * an FK whose types differ, and widening our side alone would break it.
         *
         * No `references` here on purpose. A coach's class only has meaning as a
         * pair with its train — `class_code` alone is not unique across the
         * schema — so the constraint is composite, against `uq_train_class`.
         * Sequelize can only express a single-column reference on createTable, so
         * the FKs are added as explicit DDL at the end of `up`.
         */
        train_id: { type: DataTypes.INTEGER, allowNull: false },
        class_code: { type: DataTypes.STRING(10), allowNull: false },
        /** 'B1', 'A2', 'S1' — how the booking record names it. */
        coach_code: { type: DataTypes.STRING(8), allowNull: false },
        coach_type: { type: DataTypes.ENUM(...COACH_TYPES), allowNull: false },
        /** Position along the train, so the coach diagram can be ordered. */
        position: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: false, defaultValue: 1 },
        created_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: STAMP },
        updated_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: STAMP },
      },
      { charset: 'utf8mb4' },
    )

    await queryInterface.addIndex(COACHES, ['train_id', 'class_code', 'coach_code'], {
      name: 'uq_coaches_train_class_code',
      unique: true,
    })
    // GET /seats/availability renders one coach map for a journey.
    await queryInterface.addIndex(COACHES, ['train_id', 'class_code'], { name: 'idx_coaches_train_class' })

    // ------------------------------------------------------------ coach_seats
    // The individual berths inside one coach.
    await queryInterface.createTable(
      COACH_SEATS,
      {
        seat_id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true, allowNull: false },
        coach_id: {
          type: DataTypes.BIGINT.UNSIGNED,
          allowNull: false,
          references: { model: COACHES, key: 'coach_id' },
          onDelete: 'CASCADE',
          onUpdate: 'CASCADE',
        },
        /** '24' — stable identifier within the coach, and what the UI shows. */
        seat_code: { type: DataTypes.STRING(8), allowNull: false },
        berth_type: { type: DataTypes.ENUM(...BERTH_TYPES), allowNull: false },
        /** Position within the coach, for laying out the diagram. */
        position: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: false, defaultValue: 1 },
        created_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: STAMP },
        updated_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: STAMP },
      },
      { charset: 'utf8mb4' },
    )

    await queryInterface.addIndex(COACH_SEATS, ['coach_id', 'seat_code'], {
      name: 'uq_coach_seats_coach_code',
      unique: true,
    })

    // ---------------------------------------------------------- seat_inventory
    // One row per seat per journey date. This is the row the claim updates.
    await queryInterface.createTable(
      INVENTORY,
      {
        inventory_id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true, allowNull: false },
        seat_id: {
          type: DataTypes.BIGINT.UNSIGNED,
          allowNull: false,
          references: { model: COACH_SEATS, key: 'seat_id' },
          onDelete: 'CASCADE',
          onUpdate: 'CASCADE',
        },
        // A journey date, not a departure timestamp: the same physical berth is
        // a different inventory on tomorrow's train.
        departure_date: { type: DataTypes.DATEONLY, allowNull: false },
        // Bit i set = segment i is claimed. See the header for the encoding.
        segment_mask: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 },
        created_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: STAMP },
        updated_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: STAMP },
      },
      { charset: 'utf8mb4' },
    )

    // The row the claim updates has to be addressable in one step.
    await queryInterface.addIndex(INVENTORY, ['seat_id', 'departure_date'], {
      name: 'uq_seat_inventory_seat_date',
      unique: true,
    })
    // "How full is this journey" — counts distinct seats with any bit set.
    await queryInterface.addIndex(INVENTORY, ['departure_date'], { name: 'idx_seat_inventory_departure_date' })

    // --------------------------------------------------------------- seat_holds
    // One row per booking per seat, recording which run of segments it claimed.
    await queryInterface.createTable(
      HOLDS,
      {
        hold_id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true, allowNull: false },

        /**
         * bookings belongs to Team 4 and is still an in-memory stand-in, so this
         * is the reference string rather than a foreign key. It is the join key
         * that has to survive that hand-off.
         */
        booking_ref: { type: DataTypes.STRING(32), allowNull: false },

        seat_id: {
          type: DataTypes.BIGINT.UNSIGNED,
          allowNull: false,
          references: { model: COACH_SEATS, key: 'seat_id' },
          onDelete: 'CASCADE',
          onUpdate: 'CASCADE',
        },
        departure_date: { type: DataTypes.DATEONLY, allowNull: false },

        /** Boarding and dropping stop_sequence on this train's route. */
        from_stop_seq: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: false },
        to_stop_seq: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: false },
        /**
         * The bits this booking claimed: `to_stop_seq - from_stop_seq` low bits
         * set. Stored rather than recomputed so a release can undo exactly what
         * was taken even if the route is later edited.
         */
        segment_mask: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },

        status: { type: DataTypes.ENUM(...HOLD_STATUSES), allowNull: false, defaultValue: 'held' },

        /**
         * When the hold dies. Always stored, never computed from created_at at
         * read time: the deadline is agreed with the client the moment the
         * booking is confirmed, and a clock that moves would silently move it
         * out from under a traveller already staring at Checkout.
         */
        expires_at: { type: DataTypes.DATE(3), allowNull: false },
        confirmed_at: { type: DataTypes.DATE(3), allowNull: true },

        created_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: STAMP },
        updated_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: STAMP },
      },
      { charset: 'utf8mb4' },
    )

    /**
     * NOT unique. This is the change that makes shared-berth selling possible: a
     * seat now has several concurrent rows whenever the bookings cover disjoint
     * segments. Uniqueness moved to `seat_inventory`, one row per seat per date,
     * where the mask lives.
     */
    await queryInterface.addIndex(HOLDS, ['seat_id', 'departure_date'], { name: 'idx_seat_holds_seat_date' })
    // Release-on-expiry and release-on-cancel both address every seat of a
    // booking at once by reference.
    await queryInterface.addIndex(HOLDS, ['booking_ref'], { name: 'idx_seat_holds_booking_ref' })
    // The sweeper's only query: status='held' AND expires_at <= NOW(3).
    await queryInterface.addIndex(HOLDS, ['status', 'expires_at'], { name: 'idx_seat_holds_expiry' })

    /**
     * A mask wider than the column, or a run of segments that cannot exist,
     * would silently corrupt every overlapping check that reads it. MySQL
     * evaluates CHECK constraints, so this is enforced by the database rather
     * than by every call site remembering to be careful.
     */
    await queryInterface.sequelize.query(
      `ALTER TABLE \`${HOLDS}\`
         ADD CONSTRAINT \`chk_seat_holds_segment_span\`
         CHECK (\`to_stop_seq\` > \`from_stop_seq\` AND (\`to_stop_seq\` - \`from_stop_seq\`) <= ${MAX_SEGMENTS})`,
    )

    /**
     * Force one collation across the new tables before the FKs are added.
     *
     * Has to happen first: MySQL refuses a foreign key whose columns differ in
     * collation, and these are created on the server's default
     * (`utf8mb4_0900_ai_ci`) while `train_classes` is on
     * `utf8mb4_unicode_ci`. Migration 008 found the same thing for the payment
     * tables. Running this before the ALTER TABLE below would just move the
     * error.
     */
    for (const table of [COACHES, COACH_SEATS, INVENTORY, HOLDS]) {
      await queryInterface.sequelize.query(
        `ALTER TABLE \`${table}\` CONVERT TO CHARACTER SET utf8mb4 COLLATE ${COLLATION}`,
      )
    }

    /**
     * Foreign keys, added as explicit DDL.
     *
     * `coaches (train_id, class_code)` has to reference
     * `train_classes (train_id, class_code)` as a *pair* — a class code means
     * nothing without the train that offers it, and `class_code` on its own is
     * not unique across the schema. Sequelize's createTable can only express a
     * single-column reference, so these are written out.
     *
     * ON DELETE CASCADE throughout: a coach or berth that no longer exists cannot
     * have live holds against it, and leaving orphan rows behind would make
     * `seat_inventory` disagree with `seat_holds` about who owns a segment.
     */
    await queryInterface.sequelize.query(
      `ALTER TABLE \`${COACHES}\`
         ADD CONSTRAINT \`fk_coaches_train_class\`
         FOREIGN KEY (\`train_id\`, \`class_code\`)
         REFERENCES \`train_classes\` (\`train_id\`, \`class_code\`)
         ON DELETE CASCADE ON UPDATE CASCADE`,
    )
  },

  async down(queryInterface) {
    // Children first: they reference coaches, coach_seats and each other.
    await queryInterface.dropTable(HOLDS)
    await queryInterface.dropTable(INVENTORY)
    await queryInterface.dropTable(COACH_SEATS)
    await queryInterface.dropTable(COACHES)
  },
}