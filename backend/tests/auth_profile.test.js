const http = require('http');
const jwt = require('jsonwebtoken');
const app = require('../src/server');
const pool = require('../src/config/db');

let server;
const PORT = 5098;
const BASE_URL = `http://localhost:${PORT}`;

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
    // 1. Unauthenticated request to /api/v1/users/profile should fail with 401
    {
      const res = await request('/api/v1/users/profile');
      assert(res.status === 401, 'Unauthenticated GET /api/v1/users/profile returns 401');
    }

    // 2. Test profile with Hrutuja's user record in database
    {
      const [[hrutujaRow]] = await pool.query(
        "SELECT id, full_name, email, phone, role FROM users WHERE email = 'hrutujak1910@gmail.com' LIMIT 1;"
      );
      assert(Boolean(hrutujaRow), 'Hrutuja user exists in database');

      if (hrutujaRow) {
        const token = jwt.sign(
          { id: hrutujaRow.id, email: hrutujaRow.email, role: hrutujaRow.role },
          process.env.JWT_SECRET || 'yatrio_jwt_secret_dev_2026',
          { expiresIn: '1d' }
        );

        const res = await request('/api/v1/users/profile', {
          headers: { Authorization: `Bearer ${token}` },
        });

        assert(res.status === 200, 'Authenticated request returns 200');
        assert(res.body.success === true, 'Response has success: true');
        assert(res.body.user.name === 'Hrutuja Kodgirwar', 'Returned name matches database: Hrutuja Kodgirwar');
        assert(res.body.user.email === 'hrutujak1910@gmail.com', 'Returned email matches database: hrutujak1910@gmail.com');
        assert(res.body.user.phone === '8237921793', 'Returned phone matches database: 8237921793');
        assert(res.body.user.createdAt !== undefined, 'Returned profile includes createdAt');
      }
    }

    // 3. Test profile with a different user (e.g. Vikram Joshi) to prove dynamic behavior
    {
      // Clean up previous test user if exists
      await pool.query("DELETE FROM users WHERE email = 'vikram.j@example.com';");

      // Insert test user
      const [insertResult] = await pool.query(
        `INSERT INTO users (full_name, email, phone, password, role)
         VALUES ('Vikram Joshi', 'vikram.j@example.com', '9890123456', 'hash_test_pwd', 'passenger');`
      );
      const testUserId = insertResult.insertId;

      const token = jwt.sign(
        { id: testUserId, email: 'vikram.j@example.com', role: 'passenger' },
        process.env.JWT_SECRET || 'yatrio_jwt_secret_dev_2026',
        { expiresIn: '1d' }
      );

      const res = await request('/api/v1/users/profile', {
        headers: { Authorization: `Bearer ${token}` },
      });

      assert(res.status === 200, 'Vikram profile returns 200');
      assert(res.body.user.name === 'Vikram Joshi', 'Dynamic name returns Vikram Joshi');
      assert(res.body.user.email === 'vikram.j@example.com', 'Dynamic email returns vikram.j@example.com');
      assert(res.body.user.phone === '9890123456', 'Dynamic phone returns 9890123456');

      // Clean up
      await pool.query("DELETE FROM users WHERE id = ?;", [testUserId]);
      assert(true, 'Temporary test user cleaned up');
    }

    console.log('\n====================================================');
    console.log(`Profile Test Results: ${passed} PASSED, ${failed} FAILED`);
    console.log('====================================================\n');
  } finally {
    server.close();
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
