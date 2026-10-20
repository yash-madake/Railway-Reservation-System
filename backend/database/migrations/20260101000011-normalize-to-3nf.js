'use strict'

/**
 * Normalise the schema to 3NF.
 *
 * ## What was wrong, and the evidence
 *
 * Every change below is justified by a functional dependency measured against
 * the live data, not by a style preference.
 *
 * 1. `class_code -> class_name` and `class_code -> coach_type`
 *    7 distinct class codes, 7 distinct (code, name) pairs, 0 codes carrying
 *    more than one name. So `class_name` (on `train_classes`) and `coach_type`
 *    (on `coaches`) are transitively dependent on `class_code`, which is itself
 *    dependent on `train_id`. That is a 3NF violation: rename "First AC" in one
 *    table and the others keep disagreeing. Fixed with a `classes` lookup.
 *
 * 2. `state -> state_name`, 9 distinct values across 32 stations, 0 cities
 *    spanning more than one state. Free text repeated on every row. Fixed with a
 *    `states` lookup.
 *
 * 3. `train_no -> train_name`, and the harm was already visible: 2 bookings held
 *    a `train_name` disagreeing with `trains.train_name`, and one
 *    `train_number` already had two different names stored against it. The
 *    textbook update anomaly, already realised in live data.
 *
 * 4. `payments` copied seven columns out of the booking it belongs to. Its
 *    `booking_id` foreign key was populated on **zero of four rows** — the
 *    relationship existed in the schema and was unused, while the duplicated
 *    values drifted. Fixed by populating the key and dropping the copies.
 *
 * 5. `payments.refunded_amount` duplicated `SUM(refunds.amount)`. With no
 *    trigger keeping the two in step it was a second place for the same fact to
 *    disagree with itself.
 *
 * ## Ordering
 *
 * Strictly additive before strictly destructive, so the database is never in a
 * state where a column is gone but the data behind it is gone too:
 *
 *   A. create and populate the lookup tables
 *   B. add nullable columns and backfill them
 *   C. add foreign keys over the backfilled columns
 *   D. drop the duplicated columns
 *   E. add the missing uniqueness, drop the redundant indexes
 *
 * ## Re-runnable
 *
 * MySQL commits DDL implicitly, statement by statement, so a migration of this
 * shape is not atomic: a failure halfway leaves the schema partly migrated with
 * nothing written to `sequelize_meta`, and the next run replays from the top and
 * dies on the first thing it already did. Every structural step is therefore
 * guarded by an `information_schema` probe. Running this migration twice is a
 * no-op, and so is resuming it after a failure at any point — which is exactly
 * what happened the first time it ran.
 */

const path = require('path')
const { runSqlScript } = require('../../src/config/database')
const { QueryTypes } = require('sequelize')

/** True when `table` already has `column`. */
const hasColumn = (table, column) =>
  `SELECT COUNT(*) AS v FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = '${table}' AND column_name = '${column}'`

/**
 * True when `table` does *not* have `column`.
 *
 * The inverse of `hasColumn`, and needed for the steps that put back something
 * `down()` removed. Without it the pair is not symmetric: `down()` drops
 * `payments.booking_id`, and `up()` -- which originally assumed migration 002 had
 * created it -- then fails at the backfill that reads it, so the rollback leaves
 * a schema that cannot be migrated forward again.
 */
const lacksColumn = (table, column) =>
  // `IF(...)`, not `HAVING COUNT(*) = 0`. HAVING filters the aggregate row out
  // when the count is zero, so the guard would come back as *no rows* rather
  // than a row reading zero -- and a step guarded on that silently never runs,
  // which is the failure this helper exists to prevent.
  `SELECT IF(COUNT(*) = 0, 1, 0) AS v FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = '${table}' AND column_name = '${column}'`

/** True when `table` exists at all. */
const hasTable = (table) =>
  `SELECT COUNT(*) AS v FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name = '${table}'`

/** True when the named foreign key already exists. */
const hasFk = (name) =>
  `SELECT COUNT(*) AS v FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE() AND constraint_name = '${name}'`

/** True when `table` already has the named index. */
const hasIndex = (table, index) =>
  `SELECT COUNT(*) AS v FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = '${table}' AND index_name = '${index}'`

/**
 * Run one step, skipping it when its guard says it is already in place.
 *
 * `when` is the inverse of `guard` and exists for steps that *change* something
 * rather than create it. `guard` reads "skip if already applied", which is right
 * for every additive step and exactly backwards for a corrective one: a DROP
 * keyed on "does this exist" would skip precisely the case it exists to fix.
 */
async function step(queryInterface, { guard, when, sql, note }) {
  if (when) {
    const rows = await queryInterface.sequelize.query(when, { type: QueryTypes.SELECT })
    const applies = Array.isArray(rows[0]) ? rows[0][0]?.v : rows[0]?.v
    if (Number(applies) === 0) {
      console.log(`  - skip ${note}`)
      return
    }
  }
  if (guard) {
    const rows = await queryInterface.sequelize.query(guard, { type: QueryTypes.SELECT })
    const already = Array.isArray(rows[0]) ? rows[0][0]?.v : rows[0]?.v
    if (Number(already) > 0) {
      console.log(`  - skip ${note} (already applied)`)
      return
    }
  }
  if (sql) await queryInterface.sequelize.query(sql)
  console.log(`  + ${note}`)
}

const UP = [
  // ---------------------------------------------------------------- A. lookups
  // The three payment routines are NOT dropped here. They are rewritten against
  // the normalised schema in database/sql/procedures.sql and installed by
  // migration 013: create_payment_record loses the seven journey parameters it
  // used to copy out of the booking, and process_refund derives the refunded
  // total from `refunds` instead of the dropped `payments.refunded_amount`.
  // Their guards, SQLSTATE codes and refusal order are unchanged, because
  // tests/db.test.js covers all of it.

  { note: 'create `classes` lookup',
    guard: `SELECT COUNT(*) AS v FROM information_schema.tables
             WHERE table_schema = DATABASE() AND table_name = 'classes'`,
    sql: `
      CREATE TABLE IF NOT EXISTS \`classes\` (
        class_code       VARCHAR(10)  NOT NULL,
        class_name       VARCHAR(50)  NOT NULL,
        coach_type       ENUM('AC_FIRST','AC_2_TIER','AC_3_TIER','SLEEPER','CHAIR_CAR','EXECUTIVE','GENERAL') NOT NULL,
        berth_bay_width  TINYINT UNSIGNED NOT NULL DEFAULT 1,
        sort_order       SMALLINT UNSIGNED NOT NULL DEFAULT 0,
        is_active        TINYINT(1)   NOT NULL DEFAULT 1,
        created_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (class_code),
        CONSTRAINT chk_classes_bay_width CHECK (berth_bay_width BETWEEN 1 AND 4)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci` },

  { note: 'create `states` lookup',
    guard: `SELECT COUNT(*) AS v FROM information_schema.tables
             WHERE table_schema = DATABASE() AND table_name = 'states'`,
    sql: `
      CREATE TABLE IF NOT EXISTS \`states\` (
        state_id   INT UNSIGNED NOT NULL AUTO_INCREMENT,
        state_name VARCHAR(80)  NOT NULL,
        zone       VARCHAR(16)  NOT NULL DEFAULT 'North',
        created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (state_id),
        UNIQUE KEY uq_states_name (state_name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci` },

  // Seeded from the existing rows so the lookup starts with the real domain
  // rather than empty and filled from application code. `coach_type` comes from
  // `coaches`, where it has in fact been maintained; the two tables agreed
  // throughout the audit.
  // Reads `train_classes.class_name`, which section D drops — so this can only
  // run while that column still exists. On a resume it is skipped, because the
  // lookup is already populated by then.
  { note: 'populate `classes`',
    when: hasColumn('train_classes', 'class_name'),
    sql: `
      INSERT INTO \`classes\` (class_code, class_name, coach_type, berth_bay_width, sort_order)
      SELECT DISTINCT
        tc.class_code,
        tc.class_name,
        COALESCE((SELECT c.coach_type FROM \`coaches\` c WHERE c.class_code = tc.class_code LIMIT 1), 'GENERAL'),
        CASE tc.class_code WHEN '3A' THEN 3 WHEN '2A' THEN 2 WHEN '1A' THEN 2 ELSE 1 END,
        FIELD(tc.class_code, '1A','2A','3A','EC','CC','2S','SL')
      FROM \`train_classes\` tc
      ON DUPLICATE KEY UPDATE class_name = VALUES(class_name), coach_type = VALUES(coach_type)` },

  // Same reasoning: reads `stations.state`, which section D drops.
  { note: 'populate `states`',
    when: hasColumn('stations', 'state'),
    sql: `
      INSERT INTO \`states\` (state_name, zone)
      SELECT DISTINCT s.state,
        CASE
          WHEN s.state IN ('Maharashtra','Gujarat','Madhya Pradesh','Chhattisgarh') THEN 'West'
          WHEN s.state IN ('Delhi','Uttar Pradesh','Uttarakhand','Haryana','Punjab','Rajasthan','Himachal Pradesh') THEN 'North'
          WHEN s.state IN ('Karnataka','Tamil Nadu','Kerala','Telangana','Andhra Pradesh') THEN 'South'
          ELSE 'Other'
        END
      FROM \`stations\` s WHERE s.state IS NOT NULL AND s.state <> ''
      ON DUPLICATE KEY UPDATE state_name = VALUES(state_name)` },

  // ------------------------------------------------------------- B. backfill
  { note: 'stations.state_id added', guard: hasColumn('stations', 'state_id'),
    sql: 'ALTER TABLE `stations` ADD COLUMN state_id INT UNSIGNED NULL AFTER state' },
  { note: 'stations.state_id backfilled',
    when: hasColumn('stations', 'state'),
    sql: 'UPDATE `stations` s JOIN `states` st ON st.state_name = s.state SET s.state_id = st.state_id' },

  { note: 'bookings station-id columns added', guard: hasColumn('bookings', 'origin_station_id'),
    sql: `ALTER TABLE \`bookings\`
            ADD COLUMN origin_station_id INT NULL AFTER destination_code,
            ADD COLUMN destination_station_id INT NULL AFTER origin_station_id` },
  { note: 'bookings.origin_station_id backfilled',
    when: hasColumn('bookings', 'origin_code'),
    sql: 'UPDATE `bookings` b JOIN `stations` o ON o.station_code = b.origin_code SET b.origin_station_id = o.id' },
  { note: 'bookings.destination_station_id backfilled',
    when: hasColumn('bookings', 'destination_code'),
    sql: 'UPDATE `bookings` b JOIN `stations` d ON d.station_code = b.destination_code SET b.destination_station_id = d.id' },

  // The relationship that existed in the schema and was never used.
  //
  // `down()` drops this column, so `up()` has to be able to put it back --
  // otherwise a rollback is a one-way door and the database cannot be migrated
  // forward again. Migration 002 created it originally, which is no help to an
  // `up()` that has to run on a schema that has been rolled back.
  { note: 'payments.booking_id re-added',
    when: lacksColumn('payments', 'booking_id'),
    sql: 'ALTER TABLE `payments` ADD COLUMN booking_id BIGINT UNSIGNED NULL AFTER booking_ref' },
  { note: 'payments.booking_id backfilled (was null on every row)',
    when: hasColumn('payments', 'booking_id'),
    sql: 'UPDATE `payments` p JOIN `bookings` b ON b.booking_ref = p.booking_ref SET p.booking_id = b.booking_id' },

  // ------------------------------------------------------------------ C. keys
  { note: 'FK stations.state_id -> states', guard: hasFk('fk_stations_state'),
    sql: `ALTER TABLE \`stations\` ADD CONSTRAINT fk_stations_state
            FOREIGN KEY (state_id) REFERENCES \`states\`(state_id)
            ON DELETE RESTRICT ON UPDATE CASCADE` },

  { note: 'FK train_classes.class_code -> classes', guard: hasFk('fk_train_classes_class'),
    sql: `ALTER TABLE \`train_classes\` ADD CONSTRAINT fk_train_classes_class
            FOREIGN KEY (class_code) REFERENCES \`classes\`(class_code)
            ON DELETE RESTRICT ON UPDATE CASCADE` },

  { note: 'FK coaches.class_code -> classes', guard: hasFk('fk_coaches_class'),
    sql: `ALTER TABLE \`coaches\` ADD CONSTRAINT fk_coaches_class
            FOREIGN KEY (class_code) REFERENCES \`classes\`(class_code)
            ON DELETE RESTRICT ON UPDATE CASCADE` },

  // bookings.train_id had no foreign key at all, so a booking could name a train
  // that did not exist. RESTRICT rather than CASCADE: a train with bookings
  // behind it must not vanish, because the tickets issued against it are still
  // valid documents.
  { note: 'FK bookings.train_id -> trains', guard: hasFk('fk_bookings_train'),
    sql: `ALTER TABLE \`bookings\` ADD CONSTRAINT fk_bookings_train
            FOREIGN KEY (train_id) REFERENCES \`trains\`(id)
            ON DELETE RESTRICT ON UPDATE CASCADE` },
  { note: 'FK bookings.user_id -> users', guard: hasFk('fk_bookings_user'),
    sql: `ALTER TABLE \`bookings\` ADD CONSTRAINT fk_bookings_user
            FOREIGN KEY (user_id) REFERENCES \`users\`(id)
            ON DELETE SET NULL ON UPDATE CASCADE` },
  { note: 'FK bookings.origin_station_id -> stations', guard: hasFk('fk_bookings_origin'),
    sql: `ALTER TABLE \`bookings\` ADD CONSTRAINT fk_bookings_origin
            FOREIGN KEY (origin_station_id) REFERENCES \`stations\`(id)
            ON DELETE RESTRICT ON UPDATE CASCADE` },
  { note: 'FK bookings.destination_station_id -> stations', guard: hasFk('fk_bookings_destination'),
    sql: `ALTER TABLE \`bookings\` ADD CONSTRAINT fk_bookings_destination
            FOREIGN KEY (destination_station_id) REFERENCES \`stations\`(id)
            ON DELETE RESTRICT ON UPDATE CASCADE` },

  // SET NULL was wrong here: nulling the link would leave `booking_ref` pointing
  // at a booking that no longer exists, with nothing left to catch it.
  //
  // Dropped and re-added as two statements because MySQL validates a constraint
  // name against the table's current state, so reusing `fk_payments_booking`
  // inside the statement that drops it fails with a duplicate-name error.
  //
  // The guard checks the delete *rule*, not merely that the key exists: this
  // step exists to change SET NULL to RESTRICT, so a guard that merely tested
  // for the key's existence would skip precisely the case it exists to fix.
  { note: 'drop payments -> bookings FK (SET NULL was wrong)',
    when: `SELECT COUNT(*) AS v FROM information_schema.referential_constraints
             WHERE constraint_schema = DATABASE()
               AND constraint_name = 'fk_payments_booking' AND delete_rule = 'SET NULL'`,
    sql: 'ALTER TABLE `payments` DROP FOREIGN KEY fk_payments_booking' },
  { note: 'FK payments.booking_id -> bookings (RESTRICT)',
    guard: `SELECT COUNT(*) AS v FROM information_schema.referential_constraints
             WHERE constraint_schema = DATABASE()
               AND constraint_name = 'fk_payments_booking' AND delete_rule = 'RESTRICT'`,
    sql: `ALTER TABLE \`payments\` ADD CONSTRAINT fk_payments_booking
            FOREIGN KEY (booking_id) REFERENCES \`bookings\`(booking_id)
            ON DELETE RESTRICT ON UPDATE CASCADE` },

  { note: 'FK api_request_logs.actor_id -> users', guard: hasFk('fk_api_request_logs_actor'),
    sql: `ALTER TABLE \`api_request_logs\` ADD CONSTRAINT fk_api_request_logs_actor
            FOREIGN KEY (actor_id) REFERENCES \`users\`(id)
            ON DELETE SET NULL ON UPDATE CASCADE` },

  // ----------------------------------------------------------- E. constraints
  // Two holds on one berth for one booking is never meaningful, and nothing
  // stopped it.
  { note: 'UNIQUE seat_holds (booking_ref, seat_id)', guard: hasIndex('seat_holds', 'uq_seat_holds_booking_seat'),
    sql: 'ALTER TABLE `seat_holds` ADD CONSTRAINT uq_seat_holds_booking_seat UNIQUE (booking_ref, seat_id)' },

  // Two passengers at the same position in one manifest is always a bug.
  { note: 'UNIQUE booking_passengers (booking_id, position)', guard: hasIndex('booking_passengers', 'uq_booking_passengers_position'),
    sql: 'ALTER TABLE `booking_passengers` ADD CONSTRAINT uq_booking_passengers_position UNIQUE (booking_id, position)' },

  // Backfilled columns are the real link now, so they cannot be null.
  { note: 'bookings station ids become NOT NULL', when: hasColumn('bookings', 'origin_station_id'),
    sql: `ALTER TABLE \`bookings\`
            MODIFY COLUMN origin_station_id INT NOT NULL,
            MODIFY COLUMN destination_station_id INT NOT NULL` },

  { note: 'payments.booking_id becomes NOT NULL', when: hasColumn('payments', 'booking_id'),
    sql: 'ALTER TABLE `payments` MODIFY COLUMN booking_id BIGINT UNSIGNED NOT NULL' },

  // ---------------------------------------------------------------- D. drops
  { note: 'DROP stations.state', when: hasColumn('stations', 'state'),
    sql: 'ALTER TABLE `stations` DROP COLUMN state' },

  { note: 'DROP train_classes.class_name', when: hasColumn('train_classes', 'class_name'),
    sql: 'ALTER TABLE `train_classes` DROP COLUMN class_name' },

  { note: 'DROP coaches.coach_type', when: hasColumn('coaches', 'coach_type'),
    sql: 'ALTER TABLE `coaches` DROP COLUMN coach_type' },

  // Dropped only after train_classes has lost class_name and the FKs have been
  // re-pointed at `classes`, which is populated from it.
  { note: 'DROP bookings duplicated train + station columns', when: hasColumn('bookings', 'train_no'),
    sql: `ALTER TABLE \`bookings\`
            DROP COLUMN train_no, DROP COLUMN train_name,
            DROP COLUMN origin_name, DROP COLUMN destination_name,
            DROP COLUMN origin_code, DROP COLUMN destination_code` },

  { note: 'DROP payments journey copies + refunded_amount', when: hasColumn('payments', 'train_no'),
    sql: `ALTER TABLE \`payments\`
            DROP COLUMN train_no, DROP COLUMN train_name,
            DROP COLUMN from_station, DROP COLUMN to_station,
            DROP COLUMN passenger_name, DROP COLUMN passenger_email, DROP COLUMN passenger_contact,
            DROP COLUMN refunded_amount` },

  // These duplicate a UNIQUE index on the same single column: a second b-tree
  // over identical values costs writes and serves no lookup the unique index
  // cannot already answer.
  { note: 'DROP redundant index idx_stations_code', when: hasIndex('stations', 'idx_stations_code'),
    sql: 'ALTER TABLE `stations` DROP INDEX idx_stations_code' },
  { note: 'DROP redundant index idx_trains_number', when: hasIndex('trains', 'idx_trains_number'),
    sql: 'ALTER TABLE `trains` DROP INDEX idx_trains_number' },
]

/**
 * `v_payment_history` is rebuilt against the normalised schema.
 *
 * The dropped payment columns are re-derived here rather than removed from the
 * view, so callers of `GET /payments/history` — and Team 7's reporting, which
 * reads through this view — see the shape they always did. That is the point of
 * a view: it absorbs the normalisation.
 */
const VIEWS_AFTER = path.join(__dirname, '..', 'sql', 'views.sql')

/**
 * `v_payment_history` as it stood before normalisation.
 *
 * `down()` cannot rebuild the current `views.sql`, because the current file is
 * written against the normalised schema -- it selects `payments.booking_id` and
 * joins `stations` on `bookings.origin_station_id`, neither of which exists
 * after the rollback. That is not a cosmetic problem: the rebuild is in a
 * `finally`, so it runs even when a step above has already thrown, and it threw
 * "Unknown column 'p.booking_id'" on a database that was otherwise correctly
 * rolled back. The rollback failed in its recovery.
 *
 * The column list and aliases match the normalised view exactly, so the API
 * response is the same shape on both sides of the migration and a rollback does
 * not quietly become an API break.
 */
const VIEWS_BEFORE = `
CREATE OR REPLACE VIEW \`v_payment_history\` AS
SELECT
    p.\`payment_id\`,
    p.\`booking_ref\`,
    b.\`booking_id\`,
    p.\`gateway\`,
    p.\`gateway_order_id\`,
    p.\`gateway_payment_id\`,
    p.\`amount\`,
    p.\`refunded_amount\`,
    p.\`currency\`,
    p.\`status\`,
    p.\`attempt_number\`,
    p.\`method_code\`,
    pm.\`display_name\`  AS \`method_display_name\`,
    p.\`failure_code\`,
    p.\`failure_reason\`,
    p.\`expires_at\`,
    p.\`train_no\`,
    p.\`train_name\`,
    p.\`from_station\`,
    p.\`to_station\`,
    p.\`passenger_name\`,
    p.\`passenger_email\`,
    p.\`passenger_contact\`,
    p.\`captured_at\`,
    p.\`failed_at\`,
    p.\`refunded_at\`,
    p.\`created_at\`,
    p.\`updated_at\`,
    t.\`transaction_id\`,
    t.\`event\`           AS \`last_event\`,
    t.\`status\`          AS \`transaction_status\`,
    t.\`gateway_refund_id\`,
    t.\`signature_valid\`,
    t.\`signature_fingerprint\`,
    t.\`verified_at\`,
    t.\`latency_ms\`,
    r.\`refund_id\`,
    r.\`gateway_refund_id\` AS \`refund_gateway_id\`,
    r.\`status\`            AS \`refund_status\`,
    r.\`amount\`            AS \`refund_amount\`,
    r.\`reason\`            AS \`refund_reason\`,
    r.\`processed_at\`      AS \`refund_processed_at\`,
    CASE WHEN p.\`status\` = 'captured' THEN p.\`amount\` ELSE 0 END AS \`settled_amount\`
FROM \`payments\` p
LEFT JOIN \`payment_transactions\` t ON t.\`payment_id\` = p.\`payment_id\`
LEFT JOIN \`refunds\` r              ON r.\`payment_id\` = p.\`payment_id\`
LEFT JOIN \`payment_methods\` pm     ON pm.\`code\`     = p.\`method_code\`
LEFT JOIN \`bookings\` b             ON b.\`booking_ref\` = p.\`booking_ref\`;
`


module.exports = {
  async up(queryInterface) {
    console.log('Migrating to 3NF:')
    for (const s of UP) {
      await step(queryInterface, s)
    }
    await runSqlScript(VIEWS_AFTER)
    console.log('  + v_payment_history rebuilt against the normalised schema')
  },

  /**
   * Restores the dropped columns and repopulates them by joining through the
   * foreign keys, so this is a genuine round trip rather than a stub.
   */
  async down(queryInterface) {
    console.log('Rolling back 3NF normalisation:')
    const q = (sql) => queryInterface.sequelize.query(sql)

    // Dropped here, rebuilt in the `finally` below.
    //
    // A view that exists in no state is worse than one that exists in the wrong
    // shape: the queries behind it fail with "table doesn't exist" and nothing
    // says why. So the rebuild is unconditional rather than the last statement
    // that happens to be reached.
    try {

      /**
       * Every re-add below is conditional.
       *
       * `down()` was not re-runnable. A rollback that failed halfway -- which is
       * ordinary, because MySQL commits DDL implicitly and several of these steps
       * cannot succeed on their own -- left the schema part-restored, and the retry
       * died on the first `ADD COLUMN` that had already happened. That is how a
       * rollback ends up stuck: the failure is in the recovery, not the rollback.
       */
      const present = async (table, column) => {
        const [{ v }] = await queryInterface.sequelize.query(hasColumn(table, column), {
          type: require('sequelize').QueryTypes.SELECT,
        })
        return Number(v) > 0
      }
      const absent = async (table, column) => !(await present(table, column))

      /**
       * Whether a lookup table is still standing.
       *
       * The backfills below read through `states` and `classes`, and `down()`
       * drops both -- at the end, but "at the end" is only true of a run that
       * gets that far. Once a rollback has been interrupted, the retry finds the
       * lookups already gone and dies on "Table 'states' doesn't exist", which
       * is the second way this function used to be unrecoverable: the first was
       * re-adding a column it had already added.
       */
      const lookupSurvives = async (table) => {
        const [{ v }] = await queryInterface.sequelize.query(hasTable(table), {
          type: require('sequelize').QueryTypes.SELECT,
        })
        return Number(v) > 0
      }
      const addIfAbsent = async (table, column, definition) => {
        if (await absent(table, column)) {
          await q(`ALTER TABLE \`${table}\` ADD COLUMN ${column} ${definition}`)
        }
      }

      await addIfAbsent('stations', 'state', 'VARCHAR(100) NULL AFTER city')
      if (await lookupSurvives('states')) {
        await q(`UPDATE \`stations\` s LEFT JOIN \`states\` st ON st.state_id = s.state_id
                 SET s.state = COALESCE(st.state_name, 'Unknown')`)
      }

      await addIfAbsent('train_classes', 'class_name', 'VARCHAR(50) NULL AFTER class_code')
      if (await lookupSurvives('classes')) {
        await q(`UPDATE \`train_classes\` tc JOIN \`classes\` c ON c.class_code = tc.class_code
                 SET tc.class_name = c.class_name`)
      }

      if (await absent('coaches', 'coach_type')) await q(`ALTER TABLE \`coaches\` ADD COLUMN coach_type
               ENUM('AC_FIRST','AC_2_TIER','AC_3_TIER','SLEEPER','CHAIR_CAR','EXECUTIVE','GENERAL')
               NULL AFTER class_code`)
      if (await lookupSurvives('classes')) {
        await q(`UPDATE \`coaches\` c JOIN \`classes\` cl ON cl.class_code = c.class_code
                 SET c.coach_type = cl.coach_type`)
      }

      if (await absent('bookings', 'train_no')) await q(`ALTER TABLE \`bookings\`
        ADD COLUMN train_no VARCHAR(16) NULL AFTER train_id,
        ADD COLUMN train_name VARCHAR(96) NULL AFTER train_no,
        ADD COLUMN origin_code VARCHAR(10) NULL AFTER travel_class,
        ADD COLUMN destination_code VARCHAR(10) NULL AFTER origin_code,
        ADD COLUMN origin_name VARCHAR(96) NULL AFTER destination_code,
        ADD COLUMN destination_name VARCHAR(96) NULL AFTER origin_name`)
      if (await present('bookings', 'train_id')) {
        await q(`UPDATE \`bookings\` b
                 JOIN \`trains\` t ON t.id = b.train_id
                 JOIN \`stations\` o ON o.id = b.origin_station_id
                 JOIN \`stations\` d ON d.id = b.destination_station_id
                 SET b.train_no = t.train_number, b.train_name = t.train_name,
                     b.origin_code = o.station_code, b.origin_name = o.station_name,
                     b.destination_code = d.station_code, b.destination_name = d.station_name`)
        await q(`UPDATE \`bookings\` SET train_no = COALESCE(train_no, 'UNKNOWN')`)
        await q('ALTER TABLE `bookings` MODIFY COLUMN train_no VARCHAR(16) NOT NULL')
      }

      if (await absent('payments', 'train_no')) await q(`ALTER TABLE \`payments\`
        ADD COLUMN train_no VARCHAR(16) NULL AFTER expires_at,
        ADD COLUMN train_name VARCHAR(96) NULL AFTER train_no,
        ADD COLUMN from_station VARCHAR(8) NULL AFTER train_name,
        ADD COLUMN to_station VARCHAR(8) NULL AFTER from_station,
        ADD COLUMN passenger_name VARCHAR(96) NULL AFTER to_station,
        ADD COLUMN passenger_email VARCHAR(160) NULL AFTER passenger_name,
        ADD COLUMN passenger_contact VARCHAR(32) NULL AFTER passenger_email,
        ADD COLUMN refunded_amount BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER amount`)
      if (await present('payments', 'booking_id')) {
        await q(`UPDATE \`payments\` p
                 JOIN \`bookings\` b ON b.booking_id = p.booking_id
                 JOIN \`trains\` t ON t.id = b.train_id
                 JOIN \`stations\` o ON o.id = b.origin_station_id
                 JOIN \`stations\` d ON d.id = b.destination_station_id
                 LEFT JOIN \`booking_passengers\` bp ON bp.booking_id = b.booking_id AND bp.position = 1
                 SET p.train_no = t.train_number, p.train_name = t.train_name,
                     p.from_station = o.station_code, p.to_station = d.station_code,
                     p.passenger_name = bp.full_name, p.passenger_email = b.contact_email,
                     p.passenger_contact = b.contact_phone`)
      }
      await q(`UPDATE \`payments\` p
               SET p.refunded_amount = COALESCE(
                 (SELECT SUM(r.amount) FROM \`refunds\` r WHERE r.payment_id = p.payment_id), 0)`)

      // Constraints come off before the columns they reference.
      await q('ALTER TABLE `payments` DROP FOREIGN KEY fk_payments_booking')
      await q('ALTER TABLE `payments` DROP COLUMN booking_id')
      await q(`ALTER TABLE \`bookings\` DROP FOREIGN KEY fk_bookings_destination,
               DROP FOREIGN KEY fk_bookings_origin, DROP FOREIGN KEY fk_bookings_user,
               DROP FOREIGN KEY fk_bookings_train`)
      await q('ALTER TABLE `bookings` DROP COLUMN origin_station_id, DROP COLUMN destination_station_id')
      await q('ALTER TABLE `api_request_logs` DROP FOREIGN KEY fk_api_request_logs_actor')
      await q('ALTER TABLE `coaches` DROP FOREIGN KEY fk_coaches_class')
      await q('ALTER TABLE `train_classes` DROP FOREIGN KEY fk_train_classes_class')
      await q('ALTER TABLE `stations` DROP FOREIGN KEY fk_stations_state, DROP COLUMN state_id')
      await q('ALTER TABLE `booking_passengers` DROP INDEX uq_booking_passengers_position')
      await q('ALTER TABLE `seat_holds` DROP INDEX uq_seat_holds_booking_seat')
      await q('ALTER TABLE `trains` ADD INDEX idx_trains_number (train_number)')
      await q('ALTER TABLE `stations` ADD INDEX idx_stations_code (station_code)')
      await q('DROP TABLE IF EXISTS `classes`')
      await q('DROP TABLE IF EXISTS `states`')

    } finally {
      // The view is rebuilt whatever happened above, including when a step
      // threw. See the note where it is dropped: a missing view sends every
      // query behind it to "table doesn't exist" with nothing to connect that
      // to the rollback that is in progress.
      // One statement, no multipleStatements. The migration's own connection does
      // not enable that flag -- only the dedicated one behind runSqlScript does --
      // so this cannot be the `DROP VIEW` + `CREATE VIEW` pair that views.sql
      // uses. `CREATE OR REPLACE` covers the drop by itself.
      await queryInterface.sequelize.query(VIEWS_BEFORE.trim())
      console.log('  + v_payment_history rebuilt for the rolled-back schema')
    }
  },
}

module.exports.UP_STEPS = UP
