const http = require('http');
const jwt = require('jsonwebtoken');
const app = require('../src/server');
const pool = require('../src/config/db');

let server;
const PORT = 5098;
const BASE_URL = `http://localhost:${PORT}`;

/** Emails this run created, so the finally block can clean up after a crash too. */
const createdEmails = [];

async function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE_URL}${path}`);
    const reqOptions = {
      method: options.method || 'GET',
      headers: options.headers || {},
    };

    const req = http.request(url, reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: JSON.parse(data),
          });
        } catch {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            raw: data,
          });
        }
      });
    });

    req.on('error', reject);

    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    req.end();
  });
}

/**
 * A user, created the way an application creates one: through POST
 * /auth/register. Unique per call, so two cases never collide on the email or
 * phone uniqueness the endpoint enforces.
 */
async function registerUser(name) {
  const n = Date.now() % 100000000;
  const email = `${name.split(' ')[0].toLowerCase()}.${n}@example.com`;
  const phone = String(9000000000 + n).slice(0, 10);
  const res = await request('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { name, email, phone, password: 'TestPass@123' },
  });
  createdEmails.push(email);
  return { res, email, phone };
}

/** The token the profile route verifies: same claim shape the login issues. */
const tokenFor = (id, email) =>
  jwt.sign({ id, email, role: 'passenger' }, process.env.JWT_SECRET || 'yatrio_jwt_secret_dev_2026', {
    expiresIn: '1d',
  });

async function runProfileTests() {
  console.log('====================================================');
  console.log('    Running Authenticated User Profile Tests        ');
  console.log('====================================================\n');

  server = app.listen(PORT);
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✓ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${message}`);
      failed++;
    }
  }

  try {
    // 1. Unauthenticated request to /users/profile should fail with 401
    {
      const res = await request('/users/profile');
      assert(res.status === 401, 'Unauthenticated GET /users/profile returns 401');
    }

    // 2. A registered user reads their own profile back with a signed token.
    //
    //    The user is created here rather than looked up by a fixed email. This
    //    case used to search for one named person's row, so it passed only on
    //    the database that person had registered on and failed everywhere else
    //    -- including the ones seeded by `npm run db:seed`.
    {
      const { res: registration, email, phone } = await registerUser('Aarav Sharma');

      assert(registration.status === 201, 'POST /auth/register returns 201');
      assert(
        typeof registration.body?.data?.id === 'number',
        'register returns the new user id (the insert id, not undefined)'
      );

      const res = await request('/users/profile', {
        headers: { Authorization: `Bearer ${tokenFor(registration.body?.data?.id, email)}` },
      });

      assert(res.status === 200, 'Authenticated request returns 200');
      assert(res.body.success === true, 'Response has success: true');
      assert(res.body.user.name === 'Aarav Sharma', 'Returned name matches the registered name');
      assert(res.body.user.email === email, 'Returned email matches the registered email');
      assert(res.body.user.phone === phone, 'Returned phone matches the registered phone');
      assert(res.body.user.createdAt !== undefined, 'Returned profile includes createdAt');
    }

    // 3. A second user gets their own row back, proving the profile is read
    //    from the token's user id and not from any fixed record.
    {
      const { res: registration, email, phone } = await registerUser('Diya Mehta');
      assert(registration.status === 201, 'Second POST /auth/register returns 201');

      const res = await request('/users/profile', {
        headers: { Authorization: `Bearer ${tokenFor(registration.body?.data?.id, email)}` },
      });

      assert(res.status === 200, 'Second profile returns 200');
      assert(res.body.user.name === 'Diya Mehta', 'Dynamic name returns the second user');
      assert(res.body.user.email === email, 'Dynamic email returns the second user');
      assert(res.body.user.phone === phone, 'Dynamic phone returns the second user');
    }

    console.log('\n====================================================');
    console.log(`Profile Test Results: ${passed} PASSED, ${failed} FAILED`);
    console.log('====================================================\n');
  } finally {
    // Whatever happened above, these rows are the suite's own and must not
    // survive it: an address left behind is an address the next run's
    // uniqueness check then trips over.
    for (const email of createdEmails) {
      await pool.query('DELETE FROM users WHERE email = ?', [email]).catch(() => {});
    }
    if (createdEmails.length > 0) {
      console.log(`  Cleaned up ${createdEmails.length} temporary user(s)\n`);
    }

    server.close();
    // The Sequelize pool and Redis's reconnect timer both hold the event loop
    // open after the last assertion, so a green run would hang here forever
    // instead of exiting.
    const { close } = require('../src/config/database');
    const { redis } = require('../src/config/redis');
    await close().catch(() => {});
    await redis.quit().catch(() => {});
    redis.disconnect();
  }

  if (failed > 0) {
    process.exit(1);
  }
}

runProfileTests().catch((err) => {
  console.error('Test runner fatal error:', err);
  if (server) server.close();
  process.exit(1);
});
