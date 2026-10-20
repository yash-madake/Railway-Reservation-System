const http = require('http');
const jwt = require('jsonwebtoken');
require('dotenv').config();
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
    // 1. Unauthenticated request to /users/profile, /profile, and PUT /profile should fail with 401
    {
      const res = await request('/users/profile');
      assert(res.status === 401, 'Unauthenticated GET /users/profile returns 401');

      const resDirect = await request('/profile');
      assert(resDirect.status === 401, 'Unauthenticated GET /profile returns 401');

      const resPut = await request('/profile', { method: 'PUT', body: { name: 'Unauthorized' } });
      assert(resPut.status === 401, 'Unauthenticated PUT /profile returns 401');
    }

    // 2. A registered user reads their own profile back with a signed token.
    let user1Token;
    let user1Id;
    let user1Email;
    let user1Phone;
    {
      const { res: registration, email, phone } = await registerUser('Aarav Sharma');

      assert(registration.status === 201, 'POST /auth/register returns 201');
      assert(
        typeof registration.body?.data?.id === 'number',
        'register returns the new user id (the insert id, not undefined)'
      );

      user1Id = registration.body?.data?.id;
      user1Email = email;
      user1Phone = phone;
      user1Token = tokenFor(user1Id, email);

      const res = await request('/users/profile', {
        headers: { Authorization: `Bearer ${user1Token}` },
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

    // 4. Test authenticated PUT /profile to update profile fields (including extensions)
    {
      const updatedPhone = String(Number(user1Phone) + 1).slice(0, 10);
      const emergencyPhone = '9890111111';

      const putRes = await request('/profile', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${user1Token}` },
        body: {
          name: 'Aarav K. Sharma',
          phone: updatedPhone,
          gender: 'Male',
          date_of_birth: '1990-05-15',
          emergency_contact_name: 'Pooja Sharma',
          emergency_contact_phone: emergencyPhone,
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
      assert(putRes.body.user.name === 'Aarav K. Sharma', 'Updated name in response is Aarav K. Sharma');
      assert(putRes.body.user.phone === updatedPhone, 'Updated phone in response matches update');
      assert(putRes.body.user.emergency_contact_name === 'Pooja Sharma', 'Updated emergency contact name matches');
      assert(putRes.body.user.emergency_contact_phone === emergencyPhone, 'Updated emergency contact phone matches');
      assert(putRes.body.user.preferred_class === '3A', 'Updated preferred class is 3A');
      assert(putRes.body.user.berth_preference === 'Lower', 'Updated berth preference is Lower');
      assert(putRes.body.user.food_preference === 'Non-vegetarian', 'Updated food preference is Non-vegetarian');
      assert(putRes.body.user.pincode === '411001', 'Updated pincode is 411001');

      // 5. Test persistence on subsequent GET /profile
      const getAgainRes = await request('/profile', {
        headers: { Authorization: `Bearer ${user1Token}` },
      });

      assert(getAgainRes.status === 200, 'GET /profile after update returns 200');
      assert(getAgainRes.body.user.name === 'Aarav K. Sharma', 'Persisted name matches update');
      assert(getAgainRes.body.user.phone === updatedPhone, 'Persisted phone matches update');
      assert(getAgainRes.body.user.emergency_contact_name === 'Pooja Sharma', 'Persisted emergency contact matches');
      assert(getAgainRes.body.user.emergency_contact_phone === emergencyPhone, 'Persisted emergency phone matches');
      assert(getAgainRes.body.user.preferred_class === '3A', 'Persisted preferred class matches');
      assert(getAgainRes.body.user.berth_preference === 'Lower', 'Persisted berth preference matches update');
      assert(getAgainRes.body.user.food_preference === 'Non-vegetarian', 'Persisted food preference matches update');
    }

    // 6. Test PUT /profile validation rejections
    {
      const invalidNameRes = await request('/profile', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${user1Token}` },
        body: { name: 'A' },
      });
      assert(invalidNameRes.status === 400, 'PUT /profile returns 400 for name shorter than 2 characters');

      const invalidEmergencyPhoneRes = await request('/profile', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${user1Token}` },
        body: { emergency_contact_phone: '123' },
      });
      assert(invalidEmergencyPhoneRes.status === 400, 'PUT /profile returns 400 for invalid emergency phone');

      const invalidPinRes = await request('/profile', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${user1Token}` },
        body: { pincode: '123' },
      });
      assert(invalidPinRes.status === 400, 'PUT /profile returns 400 for invalid PIN code');
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

    if (server) server.close();
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
  process.exit(0);
}

runProfileTests().catch((err) => {
  console.error('Test runner fatal error:', err);
  if (server) server.close();
  process.exit(1);
});
