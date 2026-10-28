const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { sslOptions } = require('../config/database');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

/**
 * Remove DELIMITER directives and normalise their tokens to `;`.
 *
 * DELIMITER is a client-side instruction and has no meaning on the wire —
 * mysql2 with `multipleStatements` sends the whole file as one payload and
 * the server parses the compound CREATE TRIGGER / CREATE PROCEDURE bodies
 * itself. The directives must therefore come out first, or the server reads
 * `DELIMITER //` as SQL and rejects the file.
 *
 * Two things make this fiddly, and both are present in these files:
 *   - the token is not fixed: they use `$$`, `;` and `//`;
 *   - it changes part-way through. 007 opens with `//` for its triggers and
 *     switches back to `;` at the end; 011 alternates four times. So the file
 *     is processed segment by segment, each with the token active for it,
 *     rather than assuming one token for the whole file.
 */
function stripDelimiters(sql) {
  // Split on the directives. With a capture group, the result alternates:
  //   [ text before, token, text after, token, text after, ... ]
  const parts = sql.split(/^[ \t]*DELIMITER[ \t]+(\S+)[ \t]*;?[ \t]*\r?$/gim);

  let out = parts[0];

  for (let i = 1; i < parts.length; i += 2) {
    const token = parts[i];
    const body = parts[i + 1] ?? '';

    // `DELIMITER ;` is already the wire default — the statements that follow
    // are separated correctly and need nothing done to them.
    if (token && token !== ';') {
      const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out += body.replace(new RegExp(escaped, 'g'), ';');
    } else {
      out += body;
    }
  }

  return out;
}

async function runMigrations() {
  console.log('==============================================');
  console.log('  Running Teams 1, 2 and 7 Database Migrations ');
  console.log('==============================================');

  // Deliberately a bare mysql2 connection rather than the shared Sequelize
  // instance. Two reasons, and both are practical:
  //   1. this script has to CREATE DATABASE and USE it, so it must connect
  //      before any schema exists;
  //   2. these files are multi-statement scripts, which need
  //      `multipleStatements`, a flag the application's own pool should not
  //      carry because it widens the SQL-injection surface.
  // Everything that reads or writes application data goes through Sequelize.
  //
  // TLS comes from config/database.js, so the CA is resolved in one place and
  // this runner cannot quietly disagree with the application about it.
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    port: process.env.DB_PORT || 3306,
    ...(sslOptions ? { ssl: sslOptions } : {}),
    multipleStatements: true
  });

  const dbName = process.env.DB_NAME || 'yatrio_db';
  console.log(`Ensuring database "${dbName}" exists...`);
  await connection.query(
    `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
  );
  await connection.query(`USE \`${dbName}\`;`);

  // Every table below is declared COLLATE=utf8mb4_unicode_ci, but a stored
  // procedure's own parameters and local variables take the *database* default
  // instead. When those disagree the procedure compiles but fails at CALL:
  //   Illegal mix of collations (utf8mb4_unicode_ci,IMPLICIT) and
  //   (utf8mb4_0900_ai_ci,IMPLICIT) for operation 'like'
  // where the second is MySQL 8's default, applied to a database created
  // before it. Align the database so procedures inherit the same collation as
  // the tables they read — CREATE DATABASE IF NOT EXISTS is a no-op for an
  // existing database, so this is the only thing that changes it.
  const COLLATION = 'utf8mb4_unicode_ci';
  await connection.query(
    `ALTER DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE ${COLLATION};`
  );

  const migrationsDir = path.join(__dirname, '../../migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    console.log(`Executing migration: ${file}...`);
    const filePath = path.join(migrationsDir, file);
    let sql = fs.readFileSync(filePath, 'utf-8');
    sql = stripDelimiters(sql);

    try {
      await connection.query(sql);
      console.log(`  ✓ Successfully executed ${file}`);
    } catch (err) {
      // Check if error is innocuous (e.g. index or column already exists)
      if (err.code === 'ER_DUP_KEYNAME') {
        console.log(`  ℹ Index already exists in ${file}, continuing...`);
      } else if (err.code === 'ER_DUP_FIELDNAME') {
        console.log(`  ℹ Column already exists in ${file}, continuing...`);
      } else {
        console.error(`  ✗ Error in ${file}:`, err.message);
        throw err;
      }
    }
  }

  await connection.end();
  console.log('All migrations completed successfully!\n');
}

if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

module.exports = runMigrations;
module.exports.stripDelimiters = stripDelimiters;
