'use strict'

/**
 * Install the booking procedures and the booking triggers.
 *
 * Migration 011 normalised the schema; this adds the routines and triggers that
 * the normalised shape makes possible, and that were missing before it.
 *
 * ## Why these live in the database
 *
 * `confirm_booking_segments` claims a run of segments with one UPDATE whose
 * WHERE clause tests the bitmask, so the database evaluates the check and the
 * write under the same row lock. In the application that check and write are
 * two round trips and two concurrent claims can interleave between them; the
 * test "two concurrent claims of one berth, exactly one wins" is a property of
 * the statement, not of the timing.
 *
 * `trg_bookings_status_log` closes the audit gap that the normalised
 * `booking_status` table made obvious: the history was written by hand from two
 * places and the sweeper's expiries were not logged at all.
 *
 * There is deliberately no trigger maintaining `train_classes.available_seats`.
 * An earlier draft had three, counting free rows in `seat_inventory`; that count
 * is wrong, because inventory is per departure date and only exists for
 * materialised journeys. Availability is derived per date where it is asked for.
 */

const path = require('path')
const { runSqlScript } = require('../../src/config/database')

const BOOKING = path.join(__dirname, '..', 'sql', 'booking_procedures.sql')
const TRIGGERS = path.join(__dirname, '..', 'sql', 'triggers.sql')

module.exports = {
  async up() {
    console.log('Installing booking procedures and triggers:')
    await runSqlScript(BOOKING)
    console.log('  + confirm_booking_segments, cancel_booking')
    console.log('  + sweep_expired_holds, sweep_expired_bookings')
    await runSqlScript(TRIGGERS)
    console.log('  + trg_bookings_status_log_ins / _upd (sole writers of booking_status)')
  },

  async down(queryInterface) {
    for (const name of [
      'trg_bookings_status_log',
      'trg_bookings_status_log_ins',
      'trg_bookings_status_log_upd',
    ]) {
      await queryInterface.sequelize.query(`DROP TRIGGER IF EXISTS \`${name}\``)
    }
    for (const name of [
      'confirm_booking_segments',
      'cancel_booking',
      'sweep_expired_holds',
      'sweep_expired_bookings',
    ]) {
      await queryInterface.sequelize.query(`DROP PROCEDURE IF EXISTS \`${name}\``)
    }
    console.log('  - booking procedures and triggers removed')
  },
}
