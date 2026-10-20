'use strict'

/**
 * Sequelize connection — the project's shared MySQL.
 *
 * Configured from discrete variables, so each one is greppable, overridable per
 * environment and reviewable on its own:
 *
 *   DB_HOST=mysql-yatrio-kharadeprathamesh7.b.aivencloud.com
 *   DB_PORT=11499
 *   DB_NAME=defaultdb
 *   DB_USER=avnadmin
 *   DB_PASSWORD=...
 *   DB_SSL_CA=database/certs/aiven-ca.pem
 *
 * Requiring this module never opens a socket — Sequelize connects lazily on the
 * first query. That is what keeps tests/payment.test.js running with no DB.
 */

const fs = require('fs')
const path = require('path')
const { Sequelize } = require('sequelize')
const env = require('./env')

/**
 * The CA file actually in use, once readCa() has resolved it.
 * Kept so scripts/db-shell.js can hand the same certificate to the MySQL
 * command line client instead of resolving the path a second way.
 */
let caFile = null

/** Optional PEM for strict TLS verification against a private CA. */
function readCa() {
  if (!env.db.sslCa) return undefined

  // Relative paths resolve against the backend root — two levels up from
  // src/config/ — not the working directory, so `npm run db:migrate` and
  // `node src/server.js` agree, and neither depends on where you cd'd from.
  caFile = path.isAbsolute(env.db.sslCa)
    ? env.db.sslCa
    : path.resolve(__dirname, '..', '..', env.db.sslCa)

  try {
    return fs.readFileSync(caFile, 'utf8')
  } catch (err) {
    console.warn(`[Yatrio] DB_SSL_CA could not be read (${caFile}): ${err.message}`)
    caFile = null
    return undefined
  }
}

/**
 * A .env that still carries the old single DATABASE_URL would silently fall
 * back to localhost/yatrio/root and fail with a connection error that gives no
 * hint about the cause. Say so instead.
 */
if (process.env.DATABASE_URL && !process.env.DB_HOST) {
  console.warn(
    '\n  [Yatrio] DATABASE_URL is set but no longer read.\n' +
      '    This project now uses discrete variables. In backend/.env replace\n' +
      '      DATABASE_URL=mysql://user:pass@host:port/dbname?ssl-mode=REQUIRED\n' +
      '    with\n' +
      '      DB_HOST=<host>   DB_PORT=<port>   DB_NAME=<dbname>\n' +
      '      DB_USER=<user>   DB_PASSWORD=<pass>\n' +
      '    (URL-escape any reserved characters in the password.)\n',
  )
}

const ssl =
  env.db.ssl === false
    ? false
    : { rejectUnauthorized: env.db.sslRejectUnauthorized, ca: readCa() }

const options = {
  host: env.db.host,
  port: env.db.port,
  database: env.db.name,
  username: env.db.user,
  password: env.db.password,
  dialect: env.db.dialect,
  // `{ ssl: false }` disables TLS; omitted entirely means "no opinion".
  ...(ssl === false ? {} : { dialectOptions: { ssl } }),
}

/**
 * Resolved credentials without the Sequelize-only knobs — sequelize-cli reads
 * this so migrations and the running server share one source of truth.
 */
const connection = {
  host: options.host,
  port: options.port,
  database: options.database,
  username: options.username,
  password: options.password,
  dialect: options.dialect,
  dialectOptions: options.dialectOptions,
}

/**
 * Shared instance. `define.freeze` and `underscored` keep column names
 * snake_case in MySQL while attributes stay camelCase in JavaScript.
 */
const sequelize = new Sequelize({
  ...options,
  logging: env.db.logging ? (sql) => console.log(`[sql] ${sql}`) : false,
  pool: {
    max: env.db.poolMax,
    idle: 10_000,
    acquire: 30_000,

    /**
     * How long a statement may wait for a row lock before giving up.
     *
     * InnoDB's default is 50 seconds, and that default is wrong here. Every
     * berth claim and every release is a conditional `UPDATE seat_inventory`,
     * so during a tatkal opening a few hundred sessions queue on the same rows
     * for the same handful of berths. At 50 seconds each, a pool of ten
     * connections is fully consumed inside two seconds of the window opening:
     * every new request waits on the pool's 30-second acquire timeout instead of
     * on a berth, the failure surfaces as a generic request timeout rather than
     * as "sold out", and the server stops answering at all.
     *
     * Failing fast is the point. A traveller who loses the race wants a 409
     * saying the berth went, and to try another -- quickly, while there are
     * still berths. A traveller stuck behind a 50-second lock wait wants nothing
     * of the kind.
     *
     * `NOWAIT` is not used deliberately: it turns a contended row into an
     * immediate error, which under a thundering herd would reject requests that
     * would have succeeded a moment later. A short bounded wait rides out the
     * queue; it just refuses to sit in it for a minute.
     */
    afterCreate: async (connection) => {
      await connection.query(`SET SESSION innodb_lock_wait_timeout = ${env.db.lockWaitSeconds}`)
    },
  },
  define: { underscored: true, freezeTableName: true },
  /**
   * IST. A JS Date is formatted into a literal 'YYYY-MM-DD HH:mm:ss.SSS'
   * before it reaches MySQL, so the stored wall clock is IST no matter what
   * timezone the database host runs in — and it reads back as the same
   * instant. Yatrio only ever books in Indian rail time.
   */
  timezone: '+05:30',
  dialectOptions: {
    ...(options.dialectOptions ?? {}),
    charset: 'utf8mb4',
    supportBigNumbers: true,
    bigNumberStrings: false,
  },
})

/** Open the pool and prove the credentials work. Never throws. */
async function connect() {
  try {
    await sequelize.authenticate()
    const [[row]] = await sequelize.query('SELECT VERSION() AS version, DATABASE() AS db')
    console.log(`[Yatrio] MySQL ${row.version} connected — schema "${row.db}"`)
    return true
  } catch (err) {
    console.error('[Yatrio] Database connection failed:', err.message)
    return false
  }
}

const close = () => sequelize.close()

/**
 * Execute a .sql file verbatim — used by the migrations that install the
 * procedures, triggers and views.
 *
 * Routed through a dedicated mysql2 connection with `multipleStatements`
 * rather than Sequelize's, because CREATE PROCEDURE ... BEGIN ... END needs the
 * server to parse a compound statement as one unit. Enabling that flag on the
 * application's own pool would widen its SQL-injection surface for no reason.
 *
 * @param {string} file absolute path to a .sql file
 */
async function runSqlScript(file) {
  const mysql = require('mysql2/promise')
  const sql = fs.readFileSync(file, 'utf8')

  // mysql2's own key names, rather than Sequelize's camelCase options.
  const connection = await mysql.createConnection({
    host: options.host,
    port: options.port,
    user: options.username,
    password: options.password,
    database: options.database,
    ssl: options.dialectOptions?.ssl,
    multipleStatements: true,
  })

  try {
    await connection.query(sql)
  } finally {
    await connection.end()
  }
}

/**
 * Flags a MySQL command line client needs to reach this exact database.
 *
 * Built from the same resolved options the app uses, so
 * `npm run db:shell` cannot drift onto a different host, port, schema or CA
 * than the running server. No password here — the client is left to prompt, or
 * reads MYSQL_PWD, so it never lands in a process list.
 */
function clientFlags() {
  const flags = [
    `--host=${options.host}`,
    `--port=${options.port}`,
    `--user=${options.username}`,
    `--database=${options.database}`,
  ]

  const ssl = options.dialectOptions?.ssl
  if (ssl) {
    // REQUIRED encrypts without checking who is on the other end; VERIFY_CA
    // does check. Same distinction as DB_SSL_REJECT_UNAUTHORIZED.
    flags.push(`--ssl-mode=${env.db.sslRejectUnauthorized ? 'VERIFY_CA' : 'REQUIRED'}`)
    if (caFile) flags.push(`--ssl-ca=${caFile}`)
  }

  return flags
}

/** Connection summary for /api/health — no password, no host credentials. */
function describe() {
  return {
    dialect: options.dialect,
    database: options.database,
    ssl: options.dialectOptions?.ssl ? true : false,
    poolMax: env.db.poolMax,
    logging: env.db.logging,
  }
}

/**
 * TLS options for any mysql2 client, including the raw migration runner.
 *
 * One place knows how to reach a database that needs TLS — exporting it keeps
 * `src/scripts/runMigrations.js` from having to resolve the CA a second way,
 * and stops the two from disagreeing about whether verification is on.
 */
const sslOptions = ssl === false ? undefined : ssl

module.exports = { sequelize, connection, connect, close, describe, runSqlScript, clientFlags, sslOptions }