'use strict'

/**
 * Shared database access for every team.
 *
 * There is one Sequelize instance — one connection pool, one TLS
 * configuration, one place to read credentials — and every team goes through
 * it. Sequelize drives the same `mysql2` driver underneath, so nothing is lost
 * by routing Teams 1, 2 and 7 through it instead of each opening their own
 * raw pool.
 *
 * This module keeps the mysql2-shaped surface those teams already call:
 *
 *     const [rows] = await pool.query('SELECT ... WHERE id = ?', [id]);
 *
 * Sequelize returns `[results, metadata]` for raw queries too, so the shape
 * their code destructures is unchanged and none of it had to be rewritten.
 * Prefer the models in `src/models/` for Team 5's payment tables; this is for
 * the queries that are genuinely raw.
 */

const { QueryTypes } = require('sequelize');
const { sequelize } = require('./database');

/**
 * Run a stored procedure on the connection Sequelize already manages.
 *
 * A CALL returns several result sets, and Sequelize's query API flattens them
 * to the first row — `CALL search_stations(...)` with five matches comes back as
 * one bare object, not an array. Code written against mysql2 expects the
 * driver's own `[results, fields]` and indexes into it.
 *
 * Sequelize is mysql2 underneath, so borrowing the connection from its pool
 * gives exactly that shape, with one set of credentials, one TLS
 * configuration and one place that decides when a connection is opened.
 */
async function callProcedure(sql, values, options) {
    const transactional = options.transaction?.connection;
    const connection =
        transactional ??
        (await sequelize.connectionManager.getConnection({ type: QueryTypes.RAW }));

    // Sequelize's pool hands out mysql2's callback interface, not its promise
    // wrapper, so the result is promisified here rather than awaited directly.
    const run = new Promise((resolve, reject) => {
        connection.query(sql, values, (err, results, fields) => {
            if (err) reject(err);
            else resolve([results, fields]);
        });
    });

    try {
        return await run;
    } finally {
        if (!transactional) {
            sequelize.connectionManager.releaseConnection(connection);
        }
    }
}

/**
 * @param {string} sql
 * @param {Array|object} [values] positional `?` bindings, as mysql2 took them
 * @param {object} [options] passed through to Sequelize — use this to supply a
 *   `transaction` from `sequelize.transaction()`
 * @returns {Promise<[unknown, unknown]>} `[results, metadata]`
 */
async function query(sql, values, options = {}) {
    // Stored procedures go on the raw connection; everything else through
    // Sequelize's own query interface.
    if (/^\s*CALL\b/i.test(sql)) {
        return callProcedure(sql, values, options);
    }

    const opts = { ...options };

    if (values !== undefined) {
        opts.replacements = values;
    }

    const result = await sequelize.query(sql, opts);

    /**
     * An INSERT answered the way mysql2 answers one.
     *
     * mysql2 returns a ResultSetHeader, so `const [r] = await query(...)`
     * followed by `r.insertId` is how every mysql2 caller reads the new id.
     * Sequelize's raw path hands back the id and the affected-row count as two
     * bare numbers instead, so that same read is `undefined` on a perfectly
     * successful insert -- which is how POST /auth/register answered with
     * `data.id: undefined`, and why seedAdmin.js grew an unwrap of its own.
     * Rebuild the header here so the surface this module documents is the one
     * callers get. SELECTs and UPDATE/DELETE already arrive in a workable
     * shape and are returned untouched.
     */
    if (/^\s*INSERT\b/i.test(sql)) {
        const [insertId, affectedRows] = Array.isArray(result) ? result : [result, undefined];
        return [
            {
                fieldCount: 0,
                affectedRows: Number(affectedRows) || 0,
                insertId: Number(insertId) || 0,
                info: '',
                serverStatus: 0,
                warningStatus: 0,
                changedRows: 0,
            },
            Array.isArray(result) ? result[1] : undefined,
        ];
    }

    return result;
}

/** Identical to query() — the two differ only in protocol handling, not results. */
const execute = query;

/**
 * A handle shaped like the mysql2 connection that scripts used to open, so
 * existing code can keep its `beginTransaction` / `commit` / `rollback` /
 * `release` shape while running on Sequelize.
 *
 * Commit and rollback are no-ops because Sequelize's `transaction()` wrapper
 * already resolves on success and rolls back if the callback throws.
 */
function transactionHandle(transaction) {
    return {
        query: (sql, values) => query(sql, values, { transaction }),
        beginTransaction: async () => {},
        commit: async () => {},
        rollback: async () => {},
        release: () => {},
    };
}

module.exports = {
    query,
    execute,
    transactionHandle,

    /** The shared instance, for callers that need transactions or models. */
    get sequelize() {
        return sequelize;
    },

    async end() {
        await sequelize.close();
    },
};