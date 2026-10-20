'use strict'

/**
 * bookings, booking_passengers, booking_status — the booking record, durable.
 *
 * ## Why this table exists
 *
 * Until now a booking lived in a `Map` inside the payment service's memory. That
 * is not a small gap. It means a reference the browser is holding in
 * `sessionStorage` names nothing after a restart, so `/payments/create-order`
 * answers `404 No booking found for reference "YTR-12002-F25C"` — and because the
 * reference is persisted client-side while the record is not, the traveller has
 * no way out: every retry replays the same dead reference. It also meant
 * `seat_holds.booking_ref` pointed at nothing, no booking could be listed or
 * cancelled, and Team 6's PNR module had no thing to look up.
 *
 * ## Status, and what actually moves it
 *
 *   HELD       seats are held, the payment window is running
 *   CONFIRMED  paid for; the seat holds have been promoted and are permanent
 *   CANCELLED  withdrawn by the traveller
 *   EXPIRED    the payment window closed unpaid
 *
 * `EXPIRED` is set by the sweeper, not by a request, so a booking nobody comes
 * back to is still accounted for rather than sitting at `HELD` forever.
 *
 * ## Foreign keys landing here
 *
 * `payments.booking_id` and `seat_holds.booking_ref` were both declared without
 * a constraint because this table did not exist — `payments.booking_id` is
 * commented as such in migration 002. Both are attached at the bottom of this
 * migration rather than left as bare columns, which is the loop PAYMENTS.md §12.8
 * said was waiting to be closed.
 */

const { DataTypes, literal } = require('sequelize')

const { TABLE: BOOKINGS, STATUSES } = require('../../src/models/Booking')
const { TABLE: PASSENGERS } = require('../../src/models/BookingPassenger')
const { TABLE: STATUS_HISTORY } = require('../../src/models/BookingStatus')
const { TABLE: HOLDS } = require('../../src/models/SeatHold')
const { TABLE: PAYMENTS } = require('../../src/models/Payment')

const COLLATION = 'utf8mb4_unicode_ci';
const STAMP = literal('CURRENT_TIMESTAMP(3)');

module.exports = {
  async up(queryInterface) {
    // ------------------------------------------------------------- bookings
    await queryInterface.createTable(
      BOOKINGS,
      {
        booking_id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true, allowNull: false },

        /**
         * The public handle. Unique, so it can be looked up on its own and so a
         * collision cannot silently overwrite a booking the way the old Map did.
         */
        booking_ref: { type: DataTypes.STRING(32), allowNull: false },

        /**
         * NULL, not required. Bookings exist for people who have not registered
         * — the search flow does not insist on it — and the column is indexed
         * so ownership checks are a single index seek when there is one.
         */
        user_id: { type: DataTypes.INTEGER, allowNull: true },

        status: { type: DataTypes.ENUM(...STATUSES), allowNull: false, defaultValue: 'HELD' },

        /* ---- the journey ---- */
        // Mirrors Team 2's signed INT / VARCHAR(10), for the same reason as
        // `coaches.train_id`: MySQL refuses an FK whose types differ.
        train_id: { type: DataTypes.INTEGER, allowNull: true },
        train_no: { type: DataTypes.STRING(16), allowNull: false },
        train_name: { type: DataTypes.STRING(96), allowNull: true },
        travel_class: { type: DataTypes.STRING(10), allowNull: false },

        origin_code: { type: DataTypes.STRING(10), allowNull: false },
        destination_code: { type: DataTypes.STRING(10), allowNull: false },
        origin_name: { type: DataTypes.STRING(96), allowNull: true },
        destination_name: { type: DataTypes.STRING(96), allowNull: true },

        /** The segment run claimed, matching seat_holds. */
        from_stop_seq: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: false },
        to_stop_seq: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: false },
        segment_mask: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 },
        distance_km: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },

        departure_at: { type: DataTypes.DATE(3), allowNull: true },
        arrival_at: { type: DataTypes.DATE(3), allowNull: true },

        /**
         * The agreed fare, in paise, snapshotted when the booking was made.
         *
         * Not recomputed at payment: the traveller reviews this figure and then
         * pays whatever `/payments/create-order` returns, so recomputing would
         * let an admin edit change the amount after it had been agreed.
         */
        total_amount: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
        currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'INR' },

        contact_email: { type: DataTypes.STRING(160), allowNull: true },
        contact_phone: { type: DataTypes.STRING(32), allowNull: true },
        extras: { type: DataTypes.JSON, allowNull: true },

        /**
         * The seat-hold deadline, copied from the hold so a booking can be aged
         * out without joining `seat_holds` to find out when it lapses.
         */
        hold_expires_at: { type: DataTypes.DATE(3), allowNull: true },

        confirmed_at: { type: DataTypes.DATE(3), allowNull: true },
        cancelled_at: { type: DataTypes.DATE(3), allowNull: true },
        cancellation_reason: { type: DataTypes.STRING(255), allowNull: true },

        created_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: STAMP },
        updated_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: STAMP },
      },
      { charset: 'utf8mb4' },
    );

    // The public handle. Also the lookup the payment stage does on every order.
    await queryInterface.addIndex(BOOKINGS, ['booking_ref'], { name: 'uq_bookings_ref', unique: true });
    // "My bookings", and the ownership check before a cancellation.
    await queryInterface.addIndex(BOOKINGS, ['user_id'], { name: 'idx_bookings_user_id' });
    // Admin lists filter by status and order by recency.
    await queryInterface.addIndex(BOOKINGS, ['status', 'created_at'], { name: 'idx_bookings_status_created' });
    // The sweeper ages out unpaid bookings on hold_expires_at.
    await queryInterface.addIndex(BOOKINGS, ['status', 'hold_expires_at'], { name: 'idx_bookings_hold_expiry' });
    // "My bookings for this journey", and the PNR lookup Team 6 will want.
    await queryInterface.addIndex(BOOKINGS, ['train_no', 'departure_at'], { name: 'idx_bookings_train_departure' });

    // -------------------------------------------------- booking_passengers
    await queryInterface.createTable(
      PASSENGERS,
      {
        passenger_id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true, allowNull: false },
        booking_id: {
          type: DataTypes.BIGINT.UNSIGNED,
          allowNull: false,
          references: { model: BOOKINGS, key: 'booking_id' },
          onDelete: 'CASCADE',
          onUpdate: 'CASCADE',
        },
        full_name: { type: DataTypes.STRING(120), allowNull: false },
        age: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: true },
        gender: { type: DataTypes.STRING(16), allowNull: true },
        berth_type: { type: DataTypes.STRING(24), allowNull: true },
        /** Resolved from the hold at confirmation, so the record is a fact. */
        coach_code: { type: DataTypes.STRING(8), allowNull: true },
        seat_code: { type: DataTypes.STRING(8), allowNull: true },
        position: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: false, defaultValue: 1 },
        created_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: STAMP },
        updated_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: STAMP },
      },
      { charset: 'utf8mb4' },
    );

    // Rendering a booking always reads its manifest in order.
    await queryInterface.addIndex(PASSENGERS, ['booking_id', 'position'], { name: 'idx_booking_passengers_booking' });
    // A berth cannot hold two passengers on one booking.
    await queryInterface.addIndex(PASSENGERS, ['booking_id', 'coach_code', 'seat_code'], {
      name: 'uq_booking_passengers_seat',
      unique: true,
    });

    // ------------------------------------------------------ booking_status
    /**
     * Status history, appended to on every transition.
     *
     * `bookings.status` is the current value and is enough to answer "is this
     * paid". This exists for "when did it stop being held, and why", which is
     * what a refund query or a support conversation actually needs.
     *
     * Written by the service, not by a trigger: the business rule for a legal
     * transition ("a captured payment cannot go back to HELD") is enforced by
     * `confirmHolds` and `process_refund` already, and duplicating it here
     * would give two places to get it wrong.
     */
    await queryInterface.createTable(
      STATUS_HISTORY,
      {
        status_id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true, allowNull: false },
        booking_id: {
          type: DataTypes.BIGINT.UNSIGNED,
          allowNull: false,
          references: { model: BOOKINGS, key: 'booking_id' },
          onDelete: 'CASCADE',
          onUpdate: 'CASCADE',
        },
        status: { type: DataTypes.ENUM(...STATUSES), allowNull: false },
        /**
         * Why the transition happened — 'payment_captured', 'cancelled_by_user',
         * 'hold_expired'. Free text rather than an enum because the set is
         * still growing and an unknown reason is more useful than a rejected
         * write.
         */
        reason: { type: DataTypes.STRING(64), allowNull: true },
        note: { type: DataTypes.STRING(255), allowNull: true },
        changed_by: { type: DataTypes.STRING(64), allowNull: true },
        changed_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: STAMP },
      },
      { charset: 'utf8mb4' },
    );

    await queryInterface.addIndex(STATUS_HISTORY, ['booking_id', 'changed_at'], {
      name: 'idx_booking_status_booking',
    });
    await queryInterface.addIndex(STATUS_HISTORY, ['status', 'changed_at'], { name: 'idx_booking_status_time' });

    // ---------------------------------------------------------- collation
    for (const table of [BOOKINGS, PASSENGERS, STATUS_HISTORY]) {
      await queryInterface.sequelize.query(
        `ALTER TABLE \`${table}\` CONVERT TO CHARACTER SET utf8mb4 COLLATE ${COLLATION}`,
      );
    }

    // --------------------------------------------------------- foreign keys
    /**
     * The two constraints that were waiting for this table.
     *
     * `payments.booking_id` is `ON DELETE SET NULL`, not CASCADE: deleting a
     * booking must never delete the record that money moved against. It stays
     * nullable, so the existing rows — which have none, because nothing had a
     * booking id until now — are unaffected.
     */
    await queryInterface.sequelize.query(
      `ALTER TABLE \`${PAYMENTS}\`
         ADD CONSTRAINT \`fk_payments_booking\`
         FOREIGN KEY (\`booking_id\`)
         REFERENCES \`${BOOKINGS}\` (\`booking_id\`)
         ON DELETE SET NULL ON UPDATE CASCADE`,
    );

    // seat_holds.booking_ref is a string join, so it needs its own unique key to
    // be referenceable at all.
    await queryInterface.sequelize.query(
      `ALTER TABLE \`${HOLDS}\`
         ADD CONSTRAINT \`fk_seat_holds_booking\`
         FOREIGN KEY (\`booking_ref\`)
         REFERENCES \`${BOOKINGS}\` (\`booking_ref\`)
         ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  },

  async down(queryInterface) {
    // Children first, and the two inbound constraints before their targets.
    await queryInterface.sequelize.query(`ALTER TABLE \`${HOLDS}\` DROP FOREIGN KEY \`fk_seat_holds_booking\``);
    await queryInterface.sequelize.query(`ALTER TABLE \`${PAYMENTS}\` DROP FOREIGN KEY \`fk_payments_booking\``);
    await queryInterface.dropTable(STATUS_HISTORY);
    await queryInterface.dropTable(PASSENGERS);
    await queryInterface.dropTable(BOOKINGS);
  },
};