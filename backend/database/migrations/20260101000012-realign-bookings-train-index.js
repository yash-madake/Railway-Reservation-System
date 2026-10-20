'use strict'

/**
 * Re-point `idx_bookings_train_departure` at `train_id`.
 *
 * Migration 011 dropped `bookings.train_no`. MySQL does not drop an index when a
 * column in it goes — it trims the index down to whatever columns remain, so
 * `idx_bookings_train_departure (train_no, departure_at)` silently became
 * `(departure_at)`.
 *
 * That leaves a single-column index under a name that claims two columns, which
 * is the kind of thing nobody notices until someone reads it as a composite. The
 * index is rebuilt over `train_id` instead, which is the same query this index
 * exists to serve — bookings for a train on a date — now that the number lives
 * on `trains` and the booking keys off the id.
 *
 * Kept as its own migration rather than folded into 011: 011 is already applied
 * to live databases, and editing an applied migration means those databases and
 * any fresh install end up with different schemas.
 */

const { QueryTypes } = require('sequelize')

module.exports = {
  async up(queryInterface) {
    const q = (sql) => queryInterface.sequelize.query(sql)

    const [{ v: isOld }] = await queryInterface.sequelize.query(
      `SELECT COUNT(*) AS v FROM information_schema.statistics
        WHERE table_schema = DATABASE() AND table_name = 'bookings'
          AND index_name = 'idx_bookings_train_departure' AND column_name = 'departure_at'
          AND seq_in_index = 1`,
      { type: require('sequelize').QueryTypes.SELECT },
    )

    if (Number(isOld) > 0) {
      await q('ALTER TABLE `bookings` DROP INDEX idx_bookings_train_departure')
      console.log('  - drop idx_bookings_train_departure (trimmed to departure_at)')
    }

    const [{ v: exists }] = await queryInterface.sequelize.query(
      `SELECT COUNT(*) AS v FROM information_schema.statistics
        WHERE table_schema = DATABASE() AND table_name = 'bookings'
          AND index_name = 'idx_bookings_train_departure'`,
      { type: require('sequelize').QueryTypes.SELECT },
    )

    if (Number(exists) === 0) {
      await q('ALTER TABLE `bookings` ADD INDEX idx_bookings_train_departure (train_id, departure_at)')
      console.log('  + rebuild idx_bookings_train_departure on (train_id, departure_at)')
    } else {
      console.log('  - skip idx_bookings_train_departure (already correct)')
    }
  },

  /**
   * Put the index back the way migration 010 left it: `(departure_at)` alone.
   *
   * The naive `DROP INDEX` does not work. `bookings.train_id` is the leftmost
   * column of a foreign key (`fk_bookings_train`), and MySQL will not drop an
   * index a constraint is standing on --
   * "Cannot drop index ... needed in a foreign key constraint" -- which is the
   * rollback dying on the first statement and leaving nothing behind.
   *
   * So the index is rebuilt first, under a different name, giving the constraint
   * something else to stand on. The old name is then free to drop.
   */
  async down(queryInterface) {
    const q = (sql) => queryInterface.sequelize.query(sql)
    const count = async (sql, ...replacements) => {
      const [row] = await queryInterface.sequelize.query(sql, {
        replacements,
        type: QueryTypes.SELECT,
      })
      return Number(row.v)
    }

    const hasIndex = await count(
      `SELECT COUNT(*) AS v FROM information_schema.statistics
        WHERE table_schema = DATABASE() AND table_name = 'bookings'
          AND index_name = 'idx_bookings_train_departure'`,
    )
    if (hasIndex === 0) {
      console.log('  - skip idx_bookings_train_departure (already absent)')
      return
    }

    const hasForeignKey = await count(
      `SELECT COUNT(*) AS v FROM information_schema.referential_constraints
        WHERE constraint_schema = DATABASE() AND constraint_name = 'fk_bookings_train'`,
    )

    // Leftover from an earlier attempt that died here.
    // MySQL has no `DROP INDEX IF EXISTS` -- that is MariaDB -- so the presence
    // check has to happen against information_schema first.
    const hasStandIn = await count(
      `SELECT COUNT(*) AS v FROM information_schema.statistics
        WHERE table_schema = DATABASE() AND table_name = 'bookings'
          AND index_name = 'idx_bookings_train_rollback'`,
    )
    if (hasStandIn > 0) {
      await q('ALTER TABLE `bookings` DROP INDEX idx_bookings_train_rollback')
      console.log('  - drop leftover idx_bookings_train_rollback')
    }

    // The foreign key has to come off, not be stood in for.
    //
    // A stand-in index on (train_id, departure_at) does satisfy the constraint --
    // and then the constraint re-binds to it, so dropping the stand-in fails with
    // the very error this was meant to avoid. There is no index to leave behind
    // once the key that wanted one is dropped, and MySQL creates the replacement
    // itself when the key goes back on.
    if (hasForeignKey > 0) {
      await q('ALTER TABLE `bookings` DROP FOREIGN KEY fk_bookings_train')
      console.log('  - fk_bookings_train dropped')
    }

    await q('ALTER TABLE `bookings` DROP INDEX idx_bookings_train_departure')
    await q('ALTER TABLE `bookings` ADD INDEX idx_bookings_train_departure (departure_at)')
    console.log('  - idx_bookings_train_departure reduced to (departure_at)')

    if (hasForeignKey > 0) {
      await q(
        'ALTER TABLE `bookings` ADD CONSTRAINT fk_bookings_train FOREIGN KEY (train_id) REFERENCES `trains`(id)',
      )
      console.log('  + fk_bookings_train restored')
    }
  },
}
