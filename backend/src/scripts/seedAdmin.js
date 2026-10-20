const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

async function seedAdmin() {
    console.log('==============================================');
    console.log('  Seeding Local Development Admin User        ');
    console.log('==============================================');

    try {
        // The shared Sequelize connection, same as the running server.
        const adminEmail = 'admin@yatrio.local';
        const adminPhone = '0000000000'; // Placeholder to satisfy UNIQUE constraint if needed
        const rawPassword = 'Admin@123';

        // Check if admin already exists
        const [existing] = await db.query(
            'SELECT id, email FROM users WHERE email = ?',
            [adminEmail]
        );

        if (existing.length > 0) {
            console.log(`[INFO] Admin user ${adminEmail} already exists. Skipping seed.`);
            return;
        }

        // Hash the password using the existing bcryptjs implementation
        console.log(`[INFO] Hashing password...`);
        const hashedPassword = await bcrypt.hash(rawPassword, 10);

        // Insert the admin user
        console.log(`[INFO] Inserting admin into database...`);

        /**
         * `db.query` returns `[results, metadata]`, but for a raw INSERT driven
         * by `replacements` Sequelize nests one level deeper still — `results` is
         * itself an array, so the shape is `[[ResultSetHeader], metadata]`.
         *
         * Destructuring once and reading `.insertId` off the result therefore
         * yields undefined even on a successful insert, which is how this script
         * used to print "ID: undefined" after reporting success. Unwrap until a
         * scalar, which covers both shapes.
         */
        const [rows] = await db.query(
            `INSERT INTO users (full_name, email, phone, password, role, status)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                'System Administrator',
                adminEmail,
                adminPhone,
                hashedPassword,
                'admin', // enum is 'passenger' | 'admin' per 000_create_users.sql
                'active'
            ]
        );

        const result = Array.isArray(rows) ? rows[0] : rows;
        const insertedId = result?.insertId ?? null;
        if (!insertedId) {
            throw new Error('Insert reported success but returned no id; the admin row may be incomplete.');
        }

        console.log(`✅ Successfully created ADMIN user!`);
        console.log(`   Email:    ${adminEmail}`);
        console.log(`   Password: ${rawPassword}`);
        console.log(`   ID:       ${insertedId}`);
        console.log('\nYou can now log in at /admin/login');

    } catch (error) {
        console.error('❌ Failed to seed admin user:', error);
        process.exit(1);
    } finally {
        await db.end();
    }
}

if (require.main === module) {
    seedAdmin()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
}

module.exports = seedAdmin;
