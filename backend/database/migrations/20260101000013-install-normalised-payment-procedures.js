'use strict'

/**
 * Install the payment procedures rewritten for the normalised schema.
 *
 * Migration 011 dropped `create_payment_record`, `confirm_payment` and
 * `process_refund` and seven columns they wrote to. They were dropped rather
 * than left in place because a routine that inserts into a column which no
 * longer exists fails the moment anyone calls it.
 *
 * But they are not dead code: `tests/db.test.js` covers eight cases across the
 * three of them — duplicate gateway order, duplicate booking attempt, zero
 * amount, signature mismatch, replay, refund ceilings — and those guards only
 * exist in the routines. So the rules were rewritten against the 3NF schema in
 * `database/sql/procedures.sql` and are installed here.
 *
 * Split from 011 because 011 is already applied to live databases: editing it
 * now would leave those and any fresh install with different routines.
 */

const path = require('path')
const { runSqlScript } = require('../../src/config/database')

const SCRIPT = path.join(__dirname, '..', 'sql', 'procedures.sql')

module.exports = {
  async up() {
    console.log('Installing normalised payment procedures:')
    await runSqlScript(SCRIPT)
    console.log('  + create_payment_record, confirm_payment, process_refund')
  },

  async down(queryInterface) {
    // Leaves no procedures behind rather than restoring the versions that
    // reference dropped columns: those cannot be reinstalled against this schema.
    for (const name of ['create_payment_record', 'confirm_payment', 'process_refund']) {
      await queryInterface.sequelize.query(`DROP PROCEDURE IF EXISTS \`${name}\``)
    }
    console.log('  - payment procedures removed')
  },
}
