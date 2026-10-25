'use strict'

/**
 * The read model consumed by GET /trains/status/:trainNo.
 *
 * Keeping it as a view means timetable data is maintained once, in the
 * existing railway tables, while the API gets a stable joined shape.
 */

const path = require('path')
const { runSqlScript } = require('../../src/config/database')

const SCRIPT = path.join(__dirname, '..', 'sql', 'train_status_view.sql')

module.exports = {
  async up() {
    await runSqlScript(SCRIPT)
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP VIEW IF EXISTS `v_train_status_timetable`')
  },
}

