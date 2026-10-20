'use strict'

/**
 * Demo network expansion — more trains, routes, classes and berths.
 *
 * The database shipped with 9 trains, which is not enough to exercise anything
 * that fans out over the network: search returns two or three results for most
 * station pairs, `get_popular_routes` has nothing to rank, and the seat map has
 * a single train to show. This adds 12 more so the common corridors are
 * populated.
 *
 * ## Relationship to the other seed scripts
 *
 * `seedRailwayData.js` is the original Team 2 master data and is left alone.
 * This script is additive and shares its shape: it upserts on the natural keys,
 * so running it twice changes nothing the second time.
 *
 * Coach and berth rows are NOT created here. `seedCoaches.js` builds them to
 * match each class's `total_seats`, and doing it in two places would let the
 * two disagree. Run that afterwards — `npm run db:seed` does both in order,
 * and `seedExpandedNetwork` calls it directly when run as the main module.
 *
 * ## Where the numbers come from
 *
 * Distances are the real approximate kilometre figures for these corridors, so
 * the pro-rated fares the server computes land in a believable range. Fares are
 * whole-route `base_fare` values in rupees, stored on `train_classes` and
 * divided by route length at read time — which is why a 1384 km train carries a
 * much larger number than a 192 km one.
 *
 * Timings are illustrative and internally consistent: arrival times and day
 * numbers advance across midnight the way a real overnight timetable does.
 *
 *   node src/scripts/seedExpandedNetwork.js
 */

require('dotenv').config()

const { close } = require('../config/database')
const { seedCoaches } = require('./seedCoaches')

/**
 * Additional stations.
 *
 * Only genuinely missing junctions on the corridors below. Everything else
 * reuses the 22 stations `seedRailwayData.js` already created.
 */
const NEW_STATIONS = [
  { code: 'BRC', name: 'Vadodara Junction', city: 'Vadodara', state: 'Gujarat' },
  { code: 'ST', name: 'Surat', city: 'Surat', state: 'Gujarat' },
  { code: 'KOTA', name: 'Kota Junction', city: 'Kota', state: 'Rajasthan' },
  { code: 'RTM', name: 'Ratlam Junction', city: 'Ratlam', state: 'Madhya Pradesh' },
  { code: 'UPR', name: 'Ujjain Junction', city: 'Ujjain', state: 'Madhya Pradesh' },
  { code: 'BDTS', name: 'Bardoli', city: 'Surat', state: 'Gujarat' },
  { code: 'BRCN', name: 'Vadodara Cantt', city: 'Vadodara', state: 'Gujarat' },
  { code: 'KTE', name: 'Katni Murwara', city: 'Katni', state: 'Madhya Pradesh' },
  { code: 'SDL', name: 'Shajapur', city: 'Shajapur', state: 'Madhya Pradesh' },
  { code: 'NAB', name: 'Nagbhir', city: 'Nagpur', state: 'Maharashtra' },
]

/**
 * The trains being added.
 *
 * `classes[].total` is the authoritative capacity: `seedCoaches.js` sizes the
 * coaches to sum exactly to it, so availability can be derived by counting
 * inventory rather than trusting a static counter.
 */
const TRAINS = [
  {
    number: '12952',
    name: 'Mumbai Rajdhani (Ahmedabad - Hazrat Nizamuddin)',
    type: 'Rajdhani',
    pantry: true,
    runningDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
    classes: [
      { code: '1A', name: 'First AC', fare: 4820, total: 48, available: 11 },
      { code: '2A', name: 'Second AC', fare: 2990, total: 144, available: 38 },
      { code: '3A', name: 'Third AC', fare: 2180, total: 320, available: 96 },
    ],
    route: [
      { code: 'ADI', seq: 1, arr: null, dep: '19:00:00', dist: 0, day: 1, halt: 0, platform: '2' },
      { code: 'BRC', seq: 2, arr: '23:35:00', dep: '23:45:00', dist: 349, day: 1, halt: 10, platform: '1' },
      { code: 'ST', seq: 3, arr: '01:20:00', dep: '01:28:00', dist: 479, day: 2, halt: 8, platform: '2' },
      { code: 'BRCN', seq: 4, arr: '04:05:00', dep: '04:12:00', dist: 578, day: 2, halt: 7, platform: '3' },
      { code: 'RTM', seq: 5, arr: '07:20:00', dep: '07:28:00', dist: 747, day: 2, halt: 8, platform: '1' },
      { code: 'KOTA', seq: 6, arr: '12:50:00', dep: '12:58:00', dist: 1085, day: 2, halt: 8, platform: '2' },
      { code: 'NZM', seq: 7, arr: '17:10:00', dep: null, dist: 1276, day: 2, halt: 0, platform: '4' },
    ],
  },
  {
    number: '12009',
    name: 'Mumbai Ahmedabad Shatabdi',
    type: 'Shatabdi',
    pantry: true,
    runningDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
    classes: [
      { code: 'EC', name: 'Executive Chair Car', fare: 640, total: 120, available: 26 },
      { code: '2S', name: 'Second Sitting', fare: 380, total: 300, available: 142 },
    ],
    route: [
      { code: 'MMCT', seq: 1, arr: null, dep: '06:20:00', dist: 0, day: 1, halt: 0, platform: '8' },
      { code: 'DR', seq: 2, arr: '06:28:00', dep: '06:30:00', dist: 4, day: 1, halt: 2, platform: '12' },
      { code: 'TNA', seq: 3, arr: '06:52:00', dep: '06:54:00', dist: 34, day: 1, halt: 2, platform: '6' },
      { code: 'KYN', seq: 4, arr: '07:25:00', dep: '07:27:00', dist: 65, day: 1, halt: 2, platform: '4' },
      { code: 'KJT', seq: 5, arr: '08:12:00', dep: '08:14:00', dist: 101, day: 1, halt: 2, platform: '2' },
      { code: 'LNL', seq: 6, arr: '08:55:00', dep: '08:57:00', dist: 128, day: 1, halt: 2, platform: '3' },
      { code: 'ST', seq: 7, arr: '11:25:00', dep: '11:33:00', dist: 284, day: 1, halt: 8, platform: '1' },
      { code: 'BDTS', seq: 8, arr: '11:52:00', dep: '11:54:00', dist: 309, day: 1, halt: 2, platform: '2' },
      { code: 'BRC', seq: 9, arr: '13:45:00', dep: null, dist: 389, day: 1, halt: 0, platform: '1' },
    ],
  },
  {
    number: '12953',
    name: 'Mumbai Rajdhani (Ahmedabad - Hazrat Nizamuddin)',
    type: 'Rajdhani',
    pantry: true,
    runningDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
    classes: [
      { code: '1A', name: 'First AC', fare: 4820, total: 48, available: 9 },
      { code: '2A', name: 'Second AC', fare: 2990, total: 144, available: 29 },
      { code: '3A', name: 'Third AC', fare: 2180, total: 320, available: 71 },
    ],
    route: [
      { code: 'ADI', seq: 1, arr: null, dep: '21:30:00', dist: 0, day: 1, halt: 0, platform: '4' },
      { code: 'BRC', seq: 2, arr: '02:05:00', dep: '02:15:00', dist: 349, day: 2, halt: 10, platform: '2' },
      { code: 'ST', seq: 3, arr: '03:50:00', dep: '03:58:00', dist: 479, day: 2, halt: 8, platform: '1' },
      { code: 'RTM', seq: 4, arr: '09:50:00', dep: '09:58:00', dist: 747, day: 2, halt: 8, platform: '3' },
      { code: 'KOTA', seq: 5, arr: '15:20:00', dep: '15:28:00', dist: 1085, day: 2, halt: 8, platform: '1' },
      { code: 'NZM', seq: 6, arr: '19:40:00', dep: null, dist: 1276, day: 2, halt: 0, platform: '2' },
    ],
  },
  {
    number: '12416',
    name: 'Saurashtra Kranti Express',
    type: 'Express',
    pantry: false,
    // Not a daily service — the weekday filter on the train page needs a train
    // that genuinely does not run every day to show anything.
    runningDays: ['MON', 'WED', 'FRI'],
    classes: [
      { code: '3A', name: 'Third AC', fare: 1120, total: 288, available: 133 },
      { code: 'SL', name: 'Sleeper', fare: 380, total: 400, available: 204 },
    ],
    route: [
      { code: 'SBC', seq: 1, arr: null, dep: '20:15:00', dist: 0, day: 1, halt: 0, platform: '1' },
      { code: 'NAB', seq: 2, arr: '06:05:00', dep: '06:15:00', dist: 861, day: 2, halt: 10, platform: '2' },
      { code: 'BPL', seq: 3, arr: '15:40:00', dep: '15:50:00', dist: 1416, day: 2, halt: 10, platform: '5' },
      { code: 'RTM', seq: 4, arr: '19:30:00', dep: '19:38:00', dist: 1594, day: 2, halt: 8, platform: '1' },
      { code: 'BRC', seq: 5, arr: '00:25:00', dep: '00:33:00', dist: 1791, day: 3, halt: 8, platform: '3' },
      { code: 'ST', seq: 6, arr: '02:10:00', dep: '02:18:00', dist: 1921, day: 3, halt: 8, platform: '2' },
      { code: 'MMCT', seq: 7, arr: '06:05:00', dep: null, dist: 2051, day: 3, halt: 0, platform: '4' },
    ],
  },
  {
    number: '12941',
    name: 'Bhopal Shatabdi Express',
    type: 'Shatabdi',
    pantry: true,
    runningDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
    classes: [
      { code: 'EC', name: 'Executive Chair Car', fare: 720, total: 120, available: 44 },
      { code: '2S', name: 'Second Sitting', fare: 455, total: 300, available: 167 },
    ],
    route: [
      { code: 'NZM', seq: 1, arr: null, dep: '06:05:00', dist: 0, day: 1, halt: 0, platform: '3' },
      { code: 'AGC', seq: 2, arr: '08:25:00', dep: '08:30:00', dist: 194, day: 1, halt: 5, platform: '1' },
      { code: 'GWL', seq: 3, arr: '11:40:00', dep: '11:48:00', dist: 455, day: 1, halt: 8, platform: '2' },
      { code: 'KTE', seq: 4, arr: '15:05:00', dep: '15:10:00', dist: 641, day: 1, halt: 5, platform: '3' },
      { code: 'BPL', seq: 5, arr: '16:55:00', dep: null, dist: 741, day: 1, halt: 0, platform: '4' },
    ],
  },
  {
    number: '12942',
    name: 'Bhopal Shatabdi (Bhopal - Hazrat Nizamuddin)',
    type: 'Shatabdi',
    pantry: true,
    runningDays: ['TUE', 'THU', 'SAT', 'SUN'],
    classes: [
      { code: 'EC', name: 'Executive Chair Car', fare: 720, total: 120, available: 51 },
      { code: '2S', name: 'Second Sitting', fare: 455, total: 300, available: 189 },
    ],
    route: [
      { code: 'BPL', seq: 1, arr: null, dep: '19:20:00', dist: 0, day: 1, halt: 0, platform: '2' },
      { code: 'KTE', seq: 2, arr: '21:10:00', dep: '21:15:00', dist: 100, day: 1, halt: 5, platform: '1' },
      { code: 'GWL', seq: 3, arr: '00:35:00', dep: '00:43:00', dist: 286, day: 2, halt: 8, platform: '4' },
      { code: 'AGC', seq: 4, arr: '03:50:00', dep: '03:55:00', dist: 547, day: 2, halt: 5, platform: '2' },
      { code: 'NZM', seq: 5, arr: '06:10:00', dep: null, dist: 741, day: 2, halt: 0, platform: '1' },
    ],
  },
  {
    number: '12925',
    name: 'Mumbai Nizamuddin - Raigad Sehwara Link Express',
    type: 'Express',
    pantry: true,
    runningDays: ['TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
    classes: [
      { code: '3A', name: 'Third AC', fare: 1420, total: 288, available: 118 },
      { code: 'SL', name: 'Sleeper', fare: 460, total: 400, available: 197 },
      { code: '2S', name: 'Second Sitting', fare: 330, total: 480, available: 251 },
    ],
    route: [
      { code: 'NZM', seq: 1, arr: null, dep: '19:40:00', dist: 0, day: 1, halt: 0, platform: '5' },
      { code: 'GWL', seq: 2, arr: '01:35:00', dep: '01:43:00', dist: 456, day: 2, halt: 8, platform: '2' },
      { code: 'BPL', seq: 3, arr: '05:20:00', dep: '05:30:00', dist: 742, day: 2, halt: 10, platform: '3' },
      { code: 'BSL', seq: 4, arr: '11:10:00', dep: '11:20:00', dist: 1116, day: 2, halt: 10, platform: '6' },
      { code: 'MMR', seq: 5, arr: '17:45:00', dep: '17:55:00', dist: 1364, day: 2, halt: 10, platform: '2' },
      { code: 'MMCT', seq: 6, arr: '21:30:00', dep: null, dist: 1451, day: 2, halt: 0, platform: '5' },
    ],
  },
  {
    number: '12909',
    name: 'Gujang Shatabdi Express',
    type: 'Shatabdi',
    pantry: true,
    runningDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
    classes: [
      { code: 'EC', name: 'Executive Chair Car', fare: 800, total: 120, available: 62 },
      { code: '2S', name: 'Second Sitting', fare: 500, total: 300, available: 211 },
    ],
    route: [
      { code: 'MMCT', seq: 1, arr: null, dep: '20:50:00', dist: 0, day: 1, halt: 0, platform: '10' },
      { code: 'ST', seq: 2, arr: '02:35:00', dep: '02:43:00', dist: 284, day: 2, halt: 8, platform: '3' },
      { code: 'ADI', seq: 3, arr: '05:15:00', dep: '05:23:00', dist: 353, day: 2, halt: 8, platform: '6' },
      { code: 'JP', seq: 4, arr: '13:05:00', dep: '13:13:00', dist: 626, day: 2, halt: 8, platform: '2' },
      { code: 'NZM', seq: 5, arr: '19:30:00', dep: null, dist: 1008, day: 2, halt: 0, platform: '3' },
    ],
  },
  {
    number: '12211',
    name: 'Durgiana Express',
    type: 'Express',
    pantry: false,
    runningDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
    classes: [
      { code: '2A', name: 'Second AC', fare: 1180, total: 144, available: 62 },
      { code: '3A', name: 'Third AC', fare: 820, total: 320, available: 158 },
      { code: 'SL', name: 'Sleeper', fare: 290, total: 400, available: 213 },
    ],
    route: [
      { code: 'NDLS', seq: 1, arr: null, dep: '18:15:00', dist: 0, day: 1, halt: 0, platform: '9' },
      { code: 'AGC', seq: 2, arr: '20:35:00', dep: '20:40:00', dist: 195, day: 1, halt: 5, platform: '2' },
      { code: 'JHS', seq: 3, arr: '23:15:00', dep: '23:23:00', dist: 410, day: 1, halt: 8, platform: '1' },
      { code: 'BPL', seq: 4, arr: '03:50:00', dep: '04:00:00', dist: 656, day: 2, halt: 10, platform: '3' },
      { code: 'BSL', seq: 5, arr: '11:00:00', dep: '11:10:00', dist: 1030, day: 2, halt: 10, platform: '4' },
      { code: 'MMCT', seq: 6, arr: '16:50:00', dep: null, dist: 1365, day: 2, halt: 0, platform: '7' },
    ],
  },
  {
    number: '11039',
    name: 'Maharashtra Express',
    type: 'Express',
    pantry: false,
    runningDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
    classes: [
      { code: '2A', name: 'Second AC', fare: 1090, total: 144, available: 54 },
      { code: '3A', name: 'Third AC', fare: 760, total: 320, available: 141 },
      { code: 'SL', name: 'Sleeper', fare: 265, total: 400, available: 228 },
      { code: '2S', name: 'Second Sitting', fare: 190, total: 480, available: 296 },
    ],
    route: [
      { code: 'NDLS', seq: 1, arr: null, dep: '17:05:00', dist: 0, day: 1, halt: 0, platform: '6' },
      { code: 'GWL', seq: 2, arr: '22:50:00', dep: '22:58:00', dist: 456, day: 1, halt: 8, platform: '1' },
      { code: 'BPL', seq: 3, arr: '02:35:00', dep: '02:45:00', dist: 742, day: 2, halt: 10, platform: '5' },
      { code: 'ET', seq: 4, arr: '06:40:00', dep: '06:48:00', dist: 962, day: 2, halt: 8, platform: '2' },
      { code: 'BSL', seq: 5, arr: '13:20:00', dep: '13:30:00', dist: 1336, day: 2, halt: 10, platform: '6' },
      { code: 'MMCT', seq: 6, arr: '18:55:00', dep: null, dist: 1571, day: 2, halt: 0, platform: '9' },
    ],
  },
  {
    number: '11008',
    name: 'HWH - Hazrat Nizamuddin Express',
    type: 'Express',
    pantry: true,
    runningDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
    classes: [
      { code: '2A', name: 'Second AC', fare: 1560, total: 144, available: 47 },
      { code: '3A', name: 'Third AC', fare: 1090, total: 320, available: 124 },
      { code: '2S', name: 'Second Sitting', fare: 420, total: 480, available: 263 },
    ],
    route: [
      { code: 'HWH', seq: 1, arr: null, dep: '20:15:00', dist: 0, day: 1, halt: 0, platform: '7' },
      { code: 'JHS', seq: 2, arr: '10:40:00', dep: '10:48:00', dist: 852, day: 2, halt: 8, platform: '3' },
      { code: 'BPL', seq: 3, arr: '16:30:00', dep: '16:40:00', dist: 1098, day: 2, halt: 10, platform: '2' },
      { code: 'GWL', seq: 4, arr: '21:15:00', dep: '21:23:00', dist: 1384, day: 2, halt: 8, platform: '4' },
      { code: 'NDLS', seq: 5, arr: '01:45:00', dep: null, dist: 1440, day: 3, halt: 0, platform: '1' },
    ],
  },
  {
    number: '12841',
    name: 'Coromandel Express',
    type: 'Superfast',
    pantry: true,
    runningDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
    classes: [
      { code: '2A', name: 'Second AC', fare: 1310, total: 144, available: 59 },
      { code: '3A', name: 'Third AC', fare: 920, total: 320, available: 149 },
      { code: 'SL', name: 'Sleeper', fare: 320, total: 400, available: 187 },
    ],
    route: [
      { code: 'SBC', seq: 1, arr: null, dep: '22:30:00', dist: 0, day: 1, halt: 0, platform: '4' },
      { code: 'NAB', seq: 2, arr: '10:20:00', dep: '10:30:00', dist: 861, day: 2, halt: 10, platform: '3' },
      { code: 'ET', seq: 3, arr: '20:15:00', dep: '20:25:00', dist: 1400, day: 2, halt: 10, platform: '5' },
      { code: 'BPL', seq: 4, arr: '00:50:00', dep: '01:00:00', dist: 1534, day: 3, halt: 10, platform: '1' },
      { code: 'BSL', seq: 5, arr: '07:40:00', dep: '07:50:00', dist: 1824, day: 3, halt: 10, platform: '2' },
      { code: 'MMCT', seq: 6, arr: '13:15:00', dep: null, dist: 2059, day: 3, halt: 0, platform: '6' },
    ],
  },
]

/** class_code -> coach_type, bay width and display order, matching the lookup. */
const COACH_TYPE = {
  '1A': 'AC_FIRST', '2A': 'AC_2_TIER', '3A': 'AC_3_TIER',
  EC: 'EXECUTIVE', CC: 'CHAIR_CAR', '2S': 'GENERAL', SL: 'SLEEPER',
};
const BAY_WIDTH = { '3A': 3, '2A': 2, '1A': 2 };
const CLASS_ORDER = { '1A': 1, '2A': 2, '3A': 3, EC: 4, CC: 5, '2S': 6, SL: 7 };

async function seedExpandedNetwork({ includeCoaches = true } = {}) {
  console.log('==================================================')
  console.log('   Seeding expanded demo railway network (MySQL)  ')
  console.log('==================================================\n')

  const pool = require('../config/db')

  console.log('Seeding additional stations...')
  // `stations.state` became `state_id` when migration 011 normalised the
  // schema, so the state name is resolved through the `states` lookup --
  // upserted first, so a state nothing else has used yet still resolves.
  for (const stn of NEW_STATIONS) {
    await pool.query(
      `INSERT INTO states (state_name) VALUES (?)
       ON DUPLICATE KEY UPDATE state_name = VALUES(state_name)`,
      [stn.state],
    )
    const [stateRows] = await pool.query(
      'SELECT state_id FROM states WHERE state_name = ? LIMIT 1',
      [stn.state],
    )
    await pool.query(
      `INSERT INTO stations (station_code, station_name, city, state_id, timezone, status)
       VALUES (?, ?, ?, ?, 'Asia/Kolkata', 'active')
       ON DUPLICATE KEY UPDATE
          station_name = VALUES(station_name),
          city         = VALUES(city),
          state_id     = VALUES(state_id)`,
      [stn.code, stn.name, stn.city, stateRows[0].state_id],
    )
  }
  console.log(`  ✓ ${NEW_STATIONS.length} station(s) upserted.`)

  // Every code referenced by a route, so a typo fails loudly here rather than
  // as a NULL station_id halfway through a timetable.
  const codes = [...new Set(TRAINS.flatMap((t) => t.route.map((s) => s.code)))]
  const placeholders = codes.map(() => '?').join(',')
  const [stationRows] = await pool.query(
    `SELECT id, station_code FROM stations WHERE station_code IN (${placeholders})`,
    codes,
  )
  const stationIds = new Map(stationRows.map((r) => [r.station_code, r.id]))

  const missing = codes.filter((c) => !stationIds.has(c))
  if (missing.length > 0) {
    throw new Error(`Route references unknown station codes: ${missing.join(', ')}`)
  }
  console.log(`  ✓ All ${codes.length} route station codes resolve.`)

  console.log('\nSeeding trains, routes, classes and running days...')
  for (const t of TRAINS) {
    await pool.query(
      `INSERT INTO trains (train_number, train_name, train_type, status, pantry_available)
       VALUES (?, ?, ?, 'active', ?)
       ON DUPLICATE KEY UPDATE
          train_name        = VALUES(train_name),
          train_type        = VALUES(train_type),
          pantry_available  = VALUES(pantry_available),
          status            = 'active'`,
      [t.number, t.name, t.type, t.pantry],
    )

    const [[trainRow]] = await pool.query('SELECT id FROM trains WHERE train_number = ? LIMIT 1', [t.number])
    const trainId = trainRow.id

    // Routes are replaced wholesale rather than upserted: a seed that upserts
    // them by (train, stop_sequence) leaves orphaned rows behind whenever a stop
    // is removed from the data, and this table is entirely seed-owned.
    await pool.query('DELETE FROM train_routes WHERE train_id = ?', [trainId])
    for (const stop of t.route) {
      await pool.query(
        `INSERT INTO train_routes
           (train_id, station_id, stop_sequence, arrival_time, departure_time,
            distance_km, day_offset, halt_minutes, platform)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          trainId,
          stationIds.get(stop.code),
          stop.seq,
          stop.arr,
          stop.dep,
          stop.dist,
          stop.day,
          stop.halt,
          stop.platform,
        ],
      )
    }

    // Running days: same reasoning, replaced not merged.
    await pool.query('DELETE FROM train_running_days WHERE train_id = ?', [trainId])
    for (const day of t.runningDays) {
      await pool.query(
        'INSERT INTO train_running_days (train_id, day_of_week) VALUES (?, ?)',
        [trainId, day],
      )
    }

    // Classes: keyed on (train_id, class_code), so upsert is safe here and keeps
    // the fare in step with any edit to the data above. There is no `status`
    // column — availability is derived by counting non-zero inventory masks, not
    // read off a status field.
    for (const c of t.classes) {
      // Two writes where there was one. `class_name` and `coach_type` are
      // properties of the class code, not of this train's copy of it, so they
      // go to the `classes` lookup (migration 011) and `train_classes` keeps
      // only what is genuinely per-train.
      await pool.query(
        `INSERT INTO \`classes\` (class_code, class_name, coach_type, berth_bay_width, sort_order)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            class_name      = VALUES(class_name),
            coach_type      = VALUES(coach_type),
            berth_bay_width = VALUES(berth_bay_width)`,
        [c.code, c.name, COACH_TYPE[c.code] ?? 'GENERAL', BAY_WIDTH[c.code] ?? 1, CLASS_ORDER[c.code] ?? 99],
      );

      await pool.query(
        `INSERT INTO train_classes (train_id, class_code, base_fare, total_seats, available_seats)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            base_fare        = VALUES(base_fare),
            total_seats      = VALUES(total_seats),
            available_seats  = VALUES(available_seats)`,
        [trainId, c.code, c.fare, c.total, c.available],
      );
    }

    console.log(
      `  ✓ ${t.number.padEnd(7)} ${String(t.type).padEnd(11)} ` +
        `${t.route.length} stops · ${t.classes.length} classes · ` +
        `${t.runningDays.length} days/week · ${t.route[t.route.length - 1].dist} km`,
    )
  }

  console.log(`\n  ✓ ${TRAINS.length} train(s) seeded.`)

  /**
   * Coaches and berths, sized to match `total_seats`.
   *
   * Delegated rather than reimplemented: `seedCoaches.js` already computes a
   * coach plan whose seats sum exactly to each class's total, and a second
   * implementation would be free to disagree with it.
   */
  if (includeCoaches) {
    console.log('\nBuilding coaches and berths for every train...')
    await seedCoaches()
  } else {
    console.log(
      '\n  Skipped coaches. Run `npm run db:seed:coaches` afterwards, or the new trains\n' +
        '  will have classes but no berths to select.',
    )
  }

  console.log('\nExpanded network seed complete.')
  return { stations: NEW_STATIONS.length, trains: TRAINS.length }
}

if (require.main === module) {
  seedExpandedNetwork()
    .then(async () => {
      await close()
      process.exit(0)
    })
    .catch(async (err) => {
      console.error('Expanded network seed failed:', err)
      await close()
      process.exit(1)
    })
}

module.exports = { seedExpandedNetwork, NEW_STATIONS, TRAINS }
