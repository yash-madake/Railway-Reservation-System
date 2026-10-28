'use strict'

/**
 * Reinstall the refund guard trigger against the normalised schema.
 *
 * `trg_refunds_payment_guard` read `payments.refunded_amount`, which migration 011
 * dropped. The trigger survived its column — MySQL does not invalidate a trigger
 * when a column it references goes — and so kept raising
 * `Unknown column 'refunded_amount'` on every refund insert, including the ones
 * `process_refund` performs.
 *
 * That is the same trap as an index quietly trimming itself: the structure
 * outlives what it was built against, and nothing complains until the statement
 * runs. The trigger now sums `refunds`, which is the table that actually records
 * reversals.
 *
 * Separate from 011 because 011 is already applied.
 */

const path = require('path')
const { runSqlScript } = require('../../src/config/database')

const SCRIPT = path.join(__dirname, '..', 'sql', 'triggers.sql')

module.exports = {
  async up() {
    console.log('Reinstalling triggers against the normalised schema:')
    await runSqlScript(SCRIPT)
    console.log('  + trg_refunds_payment_guard reads refunds, not a stale column')
  },

  async down() {
    console.log('  - triggers left in place; the pre-011 versions cannot be restored')
  },
}
