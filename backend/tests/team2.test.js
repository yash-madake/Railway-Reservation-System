const http = require('http');
const app = require('../src/server');

let server;
const PORT = 5099;
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
  console.log('       Running Team 2 Backend Endpoint Tests        ');
  console.log('====================================================\n');

  server = app.listen(PORT);
  let passed = 0;
  let failed = 0;

  // A date a week out, computed rather than written down. The endpoint refuses
  // past journey dates (PAST_DATE), so a hardcoded literal rots: the day after
  // it passes, every one of these searches fails validation and the assertion
  // that trips is the station pair, not the date.
  const FUTURE_DATE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

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
    // Test 1: GET /stations
    console.log('Test Suite 1: Station Master & Search');
    {
      const res = await request('/stations');
      assert(res.status === 200, 'GET /stations returns 200');
      assert(res.body.success === true, 'GET /stations returns success: true');
      assert(Array.isArray(res.body.data), 'GET /stations returns array of stations');
      assert(res.body.data.length > 0, 'GET /stations returns non-empty station data');
      assert(res.body.pagination.total >= 20, 'GET /stations pagination has total >= 20');
    }

    // Test 2: GET /stations/search?q=pune
    {
      const res = await request('/stations/search?q=pune');
      assert(res.status === 200, 'GET /stations/search?q=pune returns 200');
      assert(
        res.body.data.some((s) => s.code === 'PUNE'),
        'Station PUNE found in search results'
      );
    }

    // Test 3: GET /stations/search?q=NDLS
    {
      const res = await request('/stations/search?q=NDLS');
      assert(res.status === 200, 'GET /stations/search?q=NDLS returns 200');
      assert(
        res.body.data.some((s) => s.code === 'NDLS'),
        'Station NDLS found in search results'
      );
    }

    // Test 4: Missing search query
    {
      const res = await request('/stations/search');
      assert(res.status === 400, 'GET /stations/search without "q" returns 400');
      assert(
        res.body.error?.code === 'SEARCH_QUERY_REQUIRED',
        'Error code SEARCH_QUERY_REQUIRED returned'
      );
    }

    console.log('\nTest Suite 2: Train Search Between Stations');

    // Test 5: Valid search between PUNE and CSMT
    {
      const res = await request(`/trains/between?from=PUNE&to=CSMT&date=${FUTURE_DATE}`);
      assert(res.status === 200, 'GET /trains/between returns 200 for valid route');
      assert(res.body.success === true, 'Response contains success: true');
      assert(res.body.data.total >= 2, 'Found at least 2 trains between PUNE and CSMT');
      assert(
        res.body.data.trains[0].departure !== undefined,
        'Train has departure time'
      );
      assert(
        res.body.data.trains[0].arrival !== undefined,
        'Train has arrival time'
      );
      assert(
        res.body.data.trains[0].duration !== undefined,
        'Train has duration calculation'
      );
      assert(
        Array.isArray(res.body.data.trains[0].classes),
        'Train has classes array'
      );
    }

    // Test 6: Same source and destination
    {
      const res = await request(`/trains/between?from=PUNE&to=PUNE&date=${FUTURE_DATE}`);
      assert(res.status === 400, 'Same station returns 400');
      assert(
        res.body.error?.code === 'SAME_STATION',
        'Returns error code SAME_STATION'
      );
    }

    // Test 7: Non-existent station in DB
    {
      const res = await request(`/trains/between?from=XXXX&to=CSMT&date=${FUTURE_DATE}`);
      assert(res.status === 400, 'Non-existent station returns 400');
      assert(
        res.body.error?.code === 'STATION_NOT_FOUND',
        'Returns error code STATION_NOT_FOUND'
      );
    }

    // Test 7b: Invalid station code format
    {
      const res = await request(`/trains/between?from=TOOLONGCODE&to=CSMT&date=${FUTURE_DATE}`);
      assert(res.status === 400, 'Invalid format station returns 400');
      assert(
        res.body.error?.code === 'INVALID_STATION_CODE',
        'Returns error code INVALID_STATION_CODE'
      );
    }

    // Test 8: Past date
    {
      const res = await request('/trains/between?from=PUNE&to=CSMT&date=2020-01-01');
      assert(res.status === 400, 'Past date returns 400');
      assert(
        res.body.error?.code === 'PAST_DATE',
        'Returns error code PAST_DATE'
      );
    }

    // Test 9: Invalid date format
    {
      const res = await request('/trains/between?from=PUNE&to=CSMT&date=invalid-date');
      assert(res.status === 400, 'Malformed date returns 400');
      assert(
        res.body.error?.code === 'INVALID_DATE_FORMAT',
        'Returns error code INVALID_DATE_FORMAT'
      );
    }

    console.log('\nTest Suite 3: Train Details & Lookup');

    // Test 10: GET /trains/12127
    {
      const res = await request('/trains/12127');
      assert(res.status === 200, 'GET /trains/12127 returns 200');
      assert(res.body.data.trainNumber === '12127', 'Train number is 12127');
      assert(Array.isArray(res.body.data.stops), 'Train details include stops array');
      assert(res.body.data.stops.length >= 7, 'Train 12127 has 7 stops in route');
      assert(Array.isArray(res.body.data.classes), 'Train details include classes');
      assert(Array.isArray(res.body.data.runningDays), 'Train details include running days');
    }

    // Test 11: GET /trains/99999 (Not Found)
    {
      const res = await request('/trains/99999');
      assert(res.status === 404, 'Non-existent train returns 404');
      assert(
        res.body.error?.code === 'TRAIN_NOT_FOUND',
        'Returns error code TRAIN_NOT_FOUND'
      );
    }

    // Test 12: GET /trains/search?q=Rajdhani
    {
      const res = await request('/trains/search?q=Rajdhani');
      assert(res.status === 200, 'GET /trains/search?q=Rajdhani returns 200');
      assert(
        res.body.data.length >= 2,
        'Found Rajdhani trains in search'
      );
    }

    console.log('\n====================================================');
    console.log(`Test Results: ${passed} PASSED, ${failed} FAILED`);
    console.log('====================================================\n');
  } finally {
    server.close();
    // The Sequelize pool and Redis's reconnect timer both hold the event loop
    // open after the last assertion, so a green run would hang here forever
    // instead of exiting. Close them and let the process finish.
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

runTests().catch((err) => {
  console.error('Test runner fatal error:', err);
  if (server) server.close();
  process.exit(1);
});
