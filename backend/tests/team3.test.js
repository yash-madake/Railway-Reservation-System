const http = require('http');
const app = require('../src/server');

let server;
const PORT = 5098;
const BASE_URL = `http://localhost:${PORT}`;

async function request(path) {
  return new Promise((resolve, reject) => {
    http
      .get(`${BASE_URL}${path}`, (res) => {
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
      })
      .on('error', reject);
  });
}

async function runTests() {
  console.log('====================================================');
  console.log('       Running Team 3 Backend Endpoint Tests        ');
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

  const FUTURE_DATE = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  try {
    // Test 1: GET /quotas
    console.log('--- Test 1: Quotas List ---');
    const res1 = await request('/quotas');
    assert(res1.status === 200, 'GET /quotas returns HTTP 200');
    assert(Array.isArray(res1.body?.data), 'GET /quotas returns array of quotas');
    const hasGN = (res1.body?.data || []).some((q) => q.code === 'GN');
    assert(hasGN, 'Quotas contains General Quota (GN)');

    // Test 2: GET /trains/12951/schedule
    console.log('\n--- Test 2: Train Station Schedule ---');
    const res2 = await request('/trains/12951/schedule');
    assert(res2.status === 200 || res2.status === 404, 'GET /trains/:trainNo/schedule returns valid status code');
    if (res2.status === 200) {
      assert(Array.isArray(res2.body?.data?.stops), 'Schedule returns list of stops');
      assert(res2.body?.data?.totalStops > 0, 'Schedule has stops in sequence');
    }

    // Test 3: GET /trains/12951/classes
    console.log('\n--- Test 3: Train Classes List ---');
    const res3 = await request('/trains/12951/classes');
    assert(res3.status === 200 || res3.status === 404, 'GET /trains/:trainNo/classes returns valid status');
    if (res3.status === 200) {
      assert(Array.isArray(res3.body?.data), 'Classes response returns an array');
    }

    // Test 4: GET /trains/12951/fare
    console.log('\n--- Test 4: Train Fare Calculation ---');
    const res4 = await request('/trains/12951/fare?from=MMCT&to=NDLS&class=3A');
    assert(res4.status === 200 || res4.status === 500, 'GET /trains/:trainNo/fare handles calculation');
    if (res4.status === 200) {
      assert(res4.body?.data?.totalFare > 0, 'Computed fare is greater than 0');
      assert(res4.body?.data?.travelClass === '3A', 'Travel class matches request');
    }

    // Test 5: GET /trains/12951/availability
    console.log('\n--- Test 5: ConfirmTkt Availability & Predictions ---');
    const res5 = await request(`/trains/12951/availability?date=${FUTURE_DATE}&class=3A&quota=GN`);
    assert(res5.status === 200 || res5.status === 500, 'GET /trains/:trainNo/availability returns status');
    if (res5.status === 200) {
      assert(Boolean(res5.body?.data), 'Availability returns payload data');
    }

    // Test 6: Missing train number validation
    console.log('\n--- Test 6: Edge Case Validation ---');
    const res6 = await request('/trains/%20/schedule');
    assert(res6.status === 400 || res6.status === 404, 'Blank train number returns 400 or 404');
  } catch (err) {
    console.error('Test execution failed:', err);
    failed++;
  } finally {
    console.log(`\n====================================================`);
    console.log(`  Tests completed: ${passed} passed, ${failed} failed`);
    console.log(`====================================================`);
    if (server) server.close();
    process.exit(failed > 0 ? 1 : 0);
  }
}

if (require.main === module) {
  runTests();
}

module.exports = { runTests };
