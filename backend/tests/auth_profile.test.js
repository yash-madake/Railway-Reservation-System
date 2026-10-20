const http = require('http');
const jwt = require('jsonwebtoken');
require('dotenv').config();
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
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
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
    // 1. Unauthenticated request to /users/profile and /profile should fail with 401
    {
      const res = await request('/users/profile');
      assert(res.status === 401, 'Unauthenticated GET /users/profile returns 401');

      const resDirect = await request('/profile');
      assert(resDirect.status === 401, 'Unauthenticated GET /profile returns 401');

      const resPut = await request('/profile', { method: 'PUT', body: { name: 'Unauthorized' } });
      assert(resPut.status === 401, 'Unauthenticated PUT /profile returns 401');
    }

    // 2. Test profile with Hrutuja's user record in database
    {
      let [[hrutujaRow]] = await pool.query(
        "SELECT id, full_name, email, phone, role FROM users WHERE phone = '8237921793' OR email LIKE '%hrutuja%' LIMIT 1;"
      );

      assert(Boolean(hrutujaRow), 'Hrutuja user exists in database');

      if (hrutujaRow) {
        const token = jwt.sign(
          { id: hrutujaRow.id, email: hrutujaRow.email, role: hrutujaRow.role },
          process.env.JWT_SECRET || 'yatrio_jwt_secret_dev_2026',
          { expiresIn: '1d' }
        );

        const res = await request('/users/profile', {
          headers: { Authorization: `Bearer ${token}` },
        });

        assert(res.status === 200, 'Authenticated request returns 200');
        assert(res.body.success === true, 'Response has success: true');
        assert(res.body.user.name === hrutujaRow.full_name, `Returned name matches database: ${hrutujaRow.full_name}`);
        assert(res.body.user.email === hrutujaRow.email, `Returned email matches database: ${hrutujaRow.email}`);
        assert(res.body.user.phone === hrutujaRow.phone, `Returned phone matches database: ${hrutujaRow.phone}`);
        assert(res.body.user.createdAt !== undefined, 'Returned profile includes createdAt');
      }
    }

    // 3. Test profile with dynamic user (Vikram Joshi)
    {
      // Clean up previous test user if exists
      await pool.query("DELETE FROM users WHERE email = 'vikram.j@example.com';");

      // Insert test user
      const [insertResult] = await pool.query(
        `INSERT INTO users (full_name, email, phone, password, role)
         VALUES ('Vikram Joshi', 'vikram.j@example.com', '9890123456', 'hash_test_pwd', 'passenger');`
      );
      const testUserId = insertResult?.insertId || insertResult;

      const token = jwt.sign(
        { id: testUserId, email: 'vikram.j@example.com', role: 'passenger' },
        process.env.JWT_SECRET || 'yatrio_jwt_secret_dev_2026',
        { expiresIn: '1d' }
      );

      const res = await request('/users/profile', {
        headers: { Authorization: `Bearer ${token}` },
      });

      assert(res.status === 200, 'Vikram profile returns 200');
      assert(res.body.user.name === 'Vikram Joshi', 'Dynamic name returns Vikram Joshi');
      assert(res.body.user.email === 'vikram.j@example.com', 'Dynamic email returns vikram.j@example.com');
      assert(res.body.user.phone === '9890123456', 'Dynamic phone returns 9890123456');

      // 4. Test authenticated PUT /profile to update profile fields (including extensions)
      const putRes = await request('/profile', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
        body: {
          name: 'Vikram A. Joshi',
          phone: '9890999999',
          gender: 'Male',
          date_of_birth: '1990-05-15',
          emergency_contact_name: 'Anita Joshi',
          emergency_contact_phone: '9890111111',
          preferred_class: '3A',
          berth_preference: 'Lower',
          food_preference: 'Non-vegetarian',
          address: '42 MG Road',
          city: 'Pune',
          state: 'Maharashtra',
          pincode: '411001',
          id_type: 'Aadhaar Card',
          id_number: '123456789012',
        },
      });

      assert(putRes.status === 200, 'PUT /profile returns 200 on valid update');
      assert(putRes.body.success === true, 'PUT /profile response has success: true');
      assert(putRes.body.user.name === 'Vikram A. Joshi', 'Updated name in response is Vikram A. Joshi');
      assert(putRes.body.user.phone === '9890999999', 'Updated phone in response is 9890999999');
      assert(putRes.body.user.emergency_contact_name === 'Anita Joshi', 'Updated emergency contact name is Anita Joshi');
      assert(putRes.body.user.emergency_contact_phone === '9890111111', 'Updated emergency contact phone is 9890111111');
      assert(putRes.body.user.preferred_class === '3A', 'Updated preferred class is 3A');
      assert(putRes.body.user.berth_preference === 'Lower', 'Updated berth preference is Lower');
      assert(putRes.body.user.food_preference === 'Non-vegetarian', 'Updated food preference is Non-vegetarian');
      assert(putRes.body.user.pincode === '411001', 'Updated pincode is 411001');

      // 5. Test persistence on subsequent GET /profile
      const getAgainRes = await request('/profile', {
        headers: { Authorization: `Bearer ${token}` },
      });

      assert(getAgainRes.status === 200, 'GET /profile after update returns 200');
      assert(getAgainRes.body.user.name === 'Vikram A. Joshi', 'Persisted name matches update');
      assert(getAgainRes.body.user.phone === '9890999999', 'Persisted phone matches update');
      assert(getAgainRes.body.user.emergency_contact_name === 'Anita Joshi', 'Persisted emergency contact matches');
      assert(getAgainRes.body.user.emergency_contact_phone === '9890111111', 'Persisted emergency phone matches');
      assert(getAgainRes.body.user.preferred_class === '3A', 'Persisted preferred class matches');
      assert(getAgainRes.body.user.berth_preference === 'Lower', 'Persisted berth preference matches update');
      assert(getAgainRes.body.user.food_preference === 'Non-vegetarian', 'Persisted food preference matches update');

      // 6. Test PUT /profile validation rejections
      const invalidNameRes = await request('/profile', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
        body: { name: 'A' },
      });
      assert(invalidNameRes.status === 400, 'PUT /profile returns 400 for name shorter than 2 characters');

      const invalidEmergencyPhoneRes = await request('/profile', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
        body: { emergency_contact_phone: '123' },
      });
      assert(invalidEmergencyPhoneRes.status === 400, 'PUT /profile returns 400 for invalid emergency phone');

      const invalidPinRes = await request('/profile', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
        body: { pincode: '123' },
      });
      assert(invalidPinRes.status === 400, 'PUT /profile returns 400 for invalid PIN code');

      // Clean up
      await pool.query("DELETE FROM users WHERE id = ?;", [testUserId]);
      assert(true, 'Temporary test user cleaned up');
    }

    console.log('\n====================================================');
    console.log(`Profile Test Results: ${passed} PASSED, ${failed} FAILED`);
    console.log('====================================================\n');
  } finally {
    if (server) server.close();
  }

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runProfileTests().catch((err) => {
  console.error('Test runner fatal error:', err);
  if (server) server.close();
  process.exit(1);
});
