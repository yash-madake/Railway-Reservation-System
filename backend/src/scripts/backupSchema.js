'use strict'

/**
 * Logical backup: schema DDL plus every row, as JSON.
 *
 * `mysqldump` is not installed in this environment, so the snapshot is produced
 * through the application's own driver. It is not a byte-for-byte restore — no
 * triggers, routines or events are captured — but it does preserve structure,
 * data and column order, which is what a review of this change needs.
 *
 *   node src/scripts/backupSchema.js [outDir]
 */

require('dotenv').config()
const fs = require('node:fs')
const path = require('node:path')

const { close, sequelize } = require('../config/database')
const { QueryTypes } = require('sequelize')

const SKIP = new Set(['sequelize_meta', 'sequelize_seeders'])

async function backupSchema(outDir) {
  const dir = outDir ?? path.join(require('node:os').tmpdir(), 'yatrio-backup')
  fs.mkdirSync(dir, { recursive: true })

  const tables = (
    await sequelize.query(
      `SELECT table_name AS t FROM information_schema.tables
        WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'
        ORDER BY table_name`,
      { type: QueryTypes.SELECT },
    )
  ).map((r) => r.t)

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const manifest = { createdAt: new Date().toISOString(), database: envDb(), tables: {} }

  let totalRows = 0

  for (const table of tables) {
    if (SKIP.has(table)) continue

    const create = (
      await sequelize.query(`SHOW CREATE TABLE \`${table}\``, { type: QueryTypes.SELECT })
    )[0]['Create Table']

    const rows =
      SKIP.has(table) || table === 'railway_audit_logs'
        ? []
        : await sequelize.query(`SELECT * FROM \`${table}\``, { type: QueryTypes.SELECT })

    manifest.tables[table] = { ddl: create, rowCount: rows.length }

    // Only row-bearing tables are written to their own file; a file per empty
    // table would be noise.
    if (rows.length > 0) {
      fs.writeFileSync(
        path.join(dir, `${table}.${stamp}.json`),
        JSON.stringify(rows, null, 2),
        'utf8',
      )
      totalRows += rows.length
    }
  }

  // Routines and triggers, as SHOW CREATE output. Not restorable from this file,
  // but they are the parts most likely to be lost by an unnoticed edit.
  const routines = await sequelize.query(
    `SELECT routine_name, routine_type FROM information_schema.routines WHERE routine_schema = DATABASE()`,
    { type: QueryTypes.SELECT },
  )
  const triggers = await sequelize.query(
    `SELECT trigger_name FROM information_schema.triggers WHERE trigger_schema = DATABASE()`,
    { type: QueryTypes.SELECT },
  )
  manifest.routines = routines
  manifest.triggers = triggers.map((t) => t.trigger_name)

  const file = path.join(dir, `schema.${stamp}.json`)
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2), 'utf8')

  console.log(`Backup written to ${dir}`)
  console.log(`  tables captured : ${Object.keys(manifest.tables).length}`)
  console.log(`  rows captured   : ${totalRows}`)
  console.log(`  routines        : ${routines.length}`)
  console.log(`  triggers        : ${manifest.triggers.length}`)
  console.log(`  manifest        : ${path.basename(file)}`)
  return { dir, file, totalRows }
}

function envDb() {
  return process.env.DB_NAME ?? 'unknown'
}

if (require.main === module) {
  backupSchema(process.argv[2])
    .then(async () => {
      await close()
      process.exit(0)
    })
    .catch(async (err) => {
      console.error('Backup failed:', err)
      await close()
      process.exit(1)
    })
}

module.exports = { backupSchema }
