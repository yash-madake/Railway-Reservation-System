const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const stationsData = [
  { code: 'PUNE', name: 'Pune Junction', city: 'Pune', state: 'Maharashtra' },
  { code: 'MMCT', name: 'Mumbai Central', city: 'Mumbai', state: 'Maharashtra' },
  { code: 'CSMT', name: 'Chhatrapati Shivaji Maharaj Terminus', city: 'Mumbai', state: 'Maharashtra' },
  { code: 'DR', name: 'Dadar Central', city: 'Mumbai', state: 'Maharashtra' },
  { code: 'TNA', name: 'Thane', city: 'Thane', state: 'Maharashtra' },
  { code: 'KYN', name: 'Kalyan Junction', city: 'Kalyan', state: 'Maharashtra' },
  { code: 'KJT', name: 'Karjat Junction', city: 'Karjat', state: 'Maharashtra' },
  { code: 'LNL', name: 'Lonavala', city: 'Lonavala', state: 'Maharashtra' },
  { code: 'NDLS', name: 'New Delhi', city: 'New Delhi', state: 'Delhi' },
  { code: 'NZM', name: 'Hazrat Nizamuddin', city: 'New Delhi', state: 'Delhi' },
  { code: 'AGC', name: 'Agra Cantt', city: 'Agra', state: 'Uttar Pradesh' },
  { code: 'GWL', name: 'Gwalior Junction', city: 'Gwalior', state: 'Madhya Pradesh' },
  { code: 'JHS', name: 'VGL Jhansi', city: 'Jhansi', state: 'Uttar Pradesh' },
  { code: 'BPL', name: 'Bhopal Junction', city: 'Bhopal', state: 'Madhya Pradesh' },
  { code: 'ET', name: 'Itarsi Junction', city: 'Itarsi', state: 'Madhya Pradesh' },
  { code: 'BSL', name: 'Bhusaval Junction', city: 'Bhusaval', state: 'Maharashtra' },
  { code: 'MMR', name: 'Manmad Junction', city: 'Manmad', state: 'Maharashtra' },
  { code: 'ADI', name: 'Ahmedabad Junction', city: 'Ahmedabad', state: 'Gujarat' },
  { code: 'JP', name: 'Jaipur Junction', city: 'Jaipur', state: 'Rajasthan' },
  { code: 'HWH', name: 'Howrah Junction', city: 'Kolkata', state: 'West Bengal' },
  { code: 'MAS', name: 'Chennai Central', city: 'Chennai', state: 'Tamil Nadu' },
  { code: 'SBC', name: 'KSR Bengaluru', city: 'Bengaluru', state: 'Karnataka' },
];

const trainsData = [
  {
    number: '12127',
    name: 'Mumbai - Pune Intercity SF Express',
    type: 'Superfast',
    pantry: true,
    runningDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
    classes: [
      { code: 'CC', name: 'AC Chair Car', fare: 415, total: 150, available: 68 },
      { code: '2S', name: 'Second Sitting', fare: 110, total: 400, available: 120 }
    ],
    route: [
      { code: 'CSMT', seq: 1, arr: null, dep: '06:40:00', dist: 0, day: 1, halt: 0, platform: '8' },
      { code: 'DR', seq: 2, arr: '06:50:00', dep: '06:52:00', dist: 9, day: 1, halt: 2, platform: '5' },
      { code: 'TNA', seq: 3, arr: '07:13:00', dep: '07:15:00', dist: 33, day: 1, halt: 2, platform: '5' },
      { code: 'KYN', seq: 4, arr: '07:38:00', dep: '07:40:00', dist: 53, day: 1, halt: 2, platform: '4' },
      { code: 'KJT', seq: 5, arr: '08:18:00', dep: '08:20:00', dist: 100, day: 1, halt: 2, platform: '1' },
      { code: 'LNL', seq: 6, arr: '09:03:00', dep: '09:05:00', dist: 128, day: 1, halt: 2, platform: '1' },
      { code: 'PUNE', seq: 7, arr: '09:57:00', dep: null, dist: 192, day: 1, halt: 0, platform: '2' },
    ]
  },
  {
    number: '12128',
    name: 'Pune - Mumbai Intercity SF Express',
    type: 'Superfast',
    pantry: true,
    runningDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
    classes: [
      { code: 'CC', name: 'AC Chair Car', fare: 415, total: 150, available: 54 },
      { code: '2S', name: 'Second Sitting', fare: 110, total: 400, available: 95 }
    ],
    route: [
      { code: 'PUNE', seq: 1, arr: null, dep: '17:55:00', dist: 0, day: 1, halt: 0, platform: '4' },
      { code: 'LNL', seq: 2, arr: '18:47:00', dep: '18:48:00', dist: 64, day: 1, halt: 1, platform: '2' },
      { code: 'KJT', seq: 3, arr: '19:33:00', dep: '19:35:00', dist: 92, day: 1, halt: 2, platform: '2' },
      { code: 'KYN', seq: 4, arr: '20:13:00', dep: '20:15:00', dist: 139, day: 1, halt: 2, platform: '7' },
      { code: 'TNA', seq: 5, arr: '20:33:00', dep: '20:35:00', dist: 159, day: 1, halt: 2, platform: '6' },
      { code: 'DR', seq: 6, arr: '20:53:00', dep: '20:55:00', dist: 183, day: 1, halt: 2, platform: '6' },
      { code: 'CSMT', seq: 7, arr: '21:05:00', dep: null, dist: 192, day: 1, halt: 0, platform: '8' },
    ]
  },
  {
    number: '12123',
    name: 'Deccan Queen Superfast',
    type: 'Superfast',
    pantry: true,
    runningDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
    classes: [
      { code: 'CC', name: 'AC Chair Car', fare: 440, total: 120, available: 32 },
      { code: '2S', name: 'Second Sitting', fare: 115, total: 450, available: 110 }
    ],
    route: [
      { code: 'CSMT', seq: 1, arr: null, dep: '17:10:00', dist: 0, day: 1, halt: 0, platform: '8' },
      { code: 'KYN', seq: 2, arr: '18:08:00', dep: '18:10:00', dist: 53, day: 1, halt: 2, platform: '4' },
      { code: 'KJT', seq: 3, arr: '18:48:00', dep: '18:50:00', dist: 100, day: 1, halt: 2, platform: '1' },
      { code: 'LNL', seq: 4, arr: '19:33:00', dep: '19:35:00', dist: 128, day: 1, halt: 2, platform: '1' },
      { code: 'PUNE', seq: 5, arr: '20:25:00', dep: null, dist: 192, day: 1, halt: 0, platform: '5' },
    ]
  },
  {
    number: '12124',
    name: 'Deccan Queen Superfast (Pune - CSMT)',
    type: 'Superfast',
    pantry: true,
    runningDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
    classes: [
      { code: 'CC', name: 'AC Chair Car', fare: 440, total: 120, available: 45 },
      { code: '2S', name: 'Second Sitting', fare: 115, total: 450, available: 160 }
    ],
    route: [
      { code: 'PUNE', seq: 1, arr: null, dep: '07:15:00', dist: 0, day: 1, halt: 0, platform: '5' },
      { code: 'LNL', seq: 2, arr: '08:06:00', dep: '08:07:00', dist: 64, day: 1, halt: 1, platform: '2' },
      { code: 'KJT', seq: 3, arr: '08:53:00', dep: '08:55:00', dist: 92, day: 1, halt: 2, platform: '2' },
      { code: 'KYN', seq: 4, arr: '09:33:00', dep: '09:35:00', dist: 139, day: 1, halt: 2, platform: '7' },
      { code: 'CSMT', seq: 5, arr: '10:25:00', dep: null, dist: 192, day: 1, halt: 0, platform: '8' },
    ]
  },
  {
    number: '12125',
    name: 'Pragati Express',
    type: 'Express',
    pantry: false,
    runningDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'],
    classes: [
      { code: 'CC', name: 'AC Chair Car', fare: 395, total: 80, available: 22 },
      { code: '2S', name: 'Second Sitting', fare: 105, total: 350, available: 88 }
    ],
    route: [
      { code: 'CSMT', seq: 1, arr: null, dep: '16:25:00', dist: 0, day: 1, halt: 0, platform: '12' },
      { code: 'DR', seq: 2, arr: '16:37:00', dep: '16:39:00', dist: 9, day: 1, halt: 2, platform: '5' },
      { code: 'TNA', seq: 3, arr: '17:03:00', dep: '17:05:00', dist: 33, day: 1, halt: 2, platform: '5' },
      { code: 'KYN', seq: 4, arr: '17:28:00', dep: '17:30:00', dist: 53, day: 1, halt: 2, platform: '4' },
      { code: 'LNL', seq: 5, arr: '18:53:00', dep: '18:55:00', dist: 128, day: 1, halt: 2, platform: '1' },
      { code: 'PUNE', seq: 6, arr: '19:50:00', dep: null, dist: 192, day: 1, halt: 0, platform: '2' },
    ]
  },
  {
    number: '12951',
    name: 'Mumbai Tejas Rajdhani',
    type: 'Rajdhani',
    pantry: true,
    runningDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
    classes: [
      { code: '1A', name: 'First AC', fare: 4850, total: 24, available: 12 },
      { code: '2A', name: 'Second AC', fare: 2890, total: 144, available: 45 },
      { code: '3A', name: 'Third AC', fare: 2065, total: 320, available: 110 }
    ],
    route: [
      { code: 'MMCT', seq: 1, arr: null, dep: '17:00:00', dist: 0, day: 1, halt: 0, platform: '1' },
      { code: 'ADI', seq: 2, arr: '22:15:00', dep: '22:25:00', dist: 493, day: 1, halt: 10, platform: '3' },
      { code: 'NDLS', seq: 3, arr: '08:32:00', dep: null, dist: 1384, day: 2, halt: 0, platform: '3' },
    ]
  },
  {
    number: '12002',
    name: 'Bhopal Shatabdi Express',
    type: 'Shatabdi',
    pantry: true,
    runningDays: ['MON', 'TUE', 'WED', 'THU', 'SAT', 'SUN'], // Runs all days except Friday
    classes: [
      { code: 'EC', name: 'Executive Chair Car', fare: 2150, total: 46, available: 20 },
      { code: 'CC', name: 'AC Chair Car', fare: 1120, total: 350, available: 140 }
    ],
    route: [
      { code: 'NDLS', seq: 1, arr: null, dep: '06:00:00', dist: 0, day: 1, halt: 0, platform: '1' },
      { code: 'AGC', seq: 2, arr: '07:50:00', dep: '07:55:00', dist: 195, day: 1, halt: 5, platform: '1' },
      { code: 'GWL', seq: 3, arr: '09:23:00', dep: '09:28:00', dist: 313, day: 1, halt: 5, platform: '1' },
      { code: 'JHS', seq: 4, arr: '10:45:00', dep: '10:50:00', dist: 410, day: 1, halt: 5, platform: '1' },
      { code: 'BPL', seq: 5, arr: '14:40:00', dep: null, dist: 702, day: 1, halt: 0, platform: '1' },
    ]
  },
  {
    number: '22221',
    name: 'CSMT - Hazrat Nizamuddin Rajdhani',
    type: 'Rajdhani',
    pantry: true,
    runningDays: ['MON', 'WED', 'FRI', 'SAT'],
    classes: [
      { code: '1A', name: 'First AC', fare: 4720, total: 24, available: 8 },
      { code: '2A', name: 'Second AC', fare: 2840, total: 120, available: 35 },
      { code: '3A', name: 'Third AC', fare: 2010, total: 280, available: 72 }
    ],
    route: [
      { code: 'CSMT', seq: 1, arr: null, dep: '16:00:00', dist: 0, day: 1, halt: 0, platform: '18' },
      { code: 'KYN', seq: 2, arr: '16:43:00', dep: '16:45:00', dist: 53, day: 1, halt: 2, platform: '4' },
      { code: 'BSL', seq: 3, arr: '22:45:00', dep: '22:50:00', dist: 444, day: 1, halt: 5, platform: '4' },
      { code: 'BPL', seq: 4, arr: '05:05:00', dep: '05:10:00', dist: 843, day: 2, halt: 5, platform: '1' },
      { code: 'JHS', seq: 5, arr: '08:30:00', dep: '08:35:00', dist: 1135, day: 2, halt: 5, platform: '4' },
      { code: 'GWL', seq: 6, arr: '09:38:00', dep: '09:40:00', dist: 1232, day: 2, halt: 2, platform: '2' },
      { code: 'AGC', seq: 7, arr: '10:58:00', dep: '11:00:00', dist: 1350, day: 2, halt: 2, platform: '2' },
      { code: 'NZM', seq: 8, arr: '13:55:00', dep: null, dist: 1538, day: 2, halt: 0, platform: '6' },
    ]
  },
  {
    number: '11077',
    name: 'Jhelum Express (Pune - New Delhi)',
    type: 'Express',
    pantry: true,
    runningDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
    classes: [
      { code: '2A', name: 'Second AC', fare: 2420, total: 96, available: 25 },
      { code: '3A', name: 'Third AC', fare: 1690, total: 320, available: 65 },
      { code: 'SL', name: 'Sleeper', fare: 630, total: 540, available: 112 },
      { code: '2S', name: 'Second Sitting', fare: 380, total: 200, available: 40 }
    ],
    route: [
      { code: 'PUNE', seq: 1, arr: null, dep: '17:20:00', dist: 0, day: 1, halt: 0, platform: '1' },
      { code: 'MMR', seq: 2, arr: '23:10:00', dep: '23:15:00', dist: 308, day: 1, halt: 5, platform: '1' },
      { code: 'BSL', seq: 3, arr: '01:40:00', dep: '01:45:00', dist: 492, day: 2, halt: 5, platform: '6' },
      { code: 'ET', seq: 4, arr: '06:45:00', dep: '06:55:00', dist: 799, day: 2, halt: 10, platform: '1' },
      { code: 'BPL', seq: 5, arr: '08:45:00', dep: '08:50:00', dist: 891, day: 2, halt: 5, platform: '2' },
      { code: 'JHS', seq: 6, arr: '13:10:00', dep: '13:20:00', dist: 1183, day: 2, halt: 10, platform: '4' },
      { code: 'GWL', seq: 7, arr: '14:40:00', dep: '14:45:00', dist: 1280, day: 2, halt: 5, platform: '2' },
      { code: 'AGC', seq: 8, arr: '17:15:00', dep: '17:20:00', dist: 1398, day: 2, halt: 5, platform: '2' },
      { code: 'NDLS', seq: 9, arr: '21:35:00', dep: null, dist: 1593, day: 2, halt: 0, platform: '5' },
    ]
  }
];

async function seedRailwayData() {
  console.log('==================================================');
  console.log('    Seeding Team 2 Railway Master Data (MySQL)    ');
  console.log('==================================================');

  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'yatrio_db',
    port: process.env.DB_PORT || 3306
  });

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 1. Insert Stations
    console.log('Seeding stations...');
    const stationIdMap = new Map();

    for (const stn of stationsData) {
      await connection.query(
        `INSERT INTO stations (station_code, station_name, city, state, timezone, status)
         VALUES (?, ?, ?, ?, 'Asia/Kolkata', 'active')
         ON DUPLICATE KEY UPDATE 
            station_name = VALUES(station_name),
            city = VALUES(city),
            state = VALUES(state);`,
        [stn.code, stn.name, stn.city, stn.state]
      );

      const [[row]] = await connection.query(
        'SELECT id FROM stations WHERE station_code = ? LIMIT 1;',
        [stn.code]
      );
      stationIdMap.set(stn.code, row.id);
    }
    console.log(`  ✓ Seeded ${stationIdMap.size} stations.`);

    // 2. Insert Trains
    console.log('Seeding trains and routes...');
    for (const t of trainsData) {
      await connection.query(
        `INSERT INTO trains (train_number, train_name, train_type, status, pantry_available)
         VALUES (?, ?, ?, 'active', ?)
         ON DUPLICATE KEY UPDATE
            train_name = VALUES(train_name),
            train_type = VALUES(train_type),
            pantry_available = VALUES(pantry_available);`,
        [t.number, t.name, t.type, t.pantry]
      );

      const [[trainRow]] = await connection.query(
        'SELECT id FROM trains WHERE train_number = ? LIMIT 1;',
        [t.number]
      );
      const trainId = trainRow.id;

      // 3. Running days
      await connection.query('DELETE FROM train_running_days WHERE train_id = ?;', [trainId]);
      for (const day of t.runningDays) {
        await connection.query(
          `INSERT INTO train_running_days (train_id, day_of_week) VALUES (?, ?);`,
          [trainId, day]
        );
      }

      // 4. Classes
      await connection.query('DELETE FROM train_classes WHERE train_id = ?;', [trainId]);
      for (const cls of t.classes) {
        await connection.query(
          `INSERT INTO train_classes (train_id, class_code, class_name, base_fare, total_seats, available_seats)
           VALUES (?, ?, ?, ?, ?, ?);`,
          [trainId, cls.code, cls.name, cls.fare, cls.total, cls.available]
        );
      }

      // 5. Routes
      await connection.query('DELETE FROM train_routes WHERE train_id = ?;', [trainId]);
      for (const r of t.route) {
        const stationId = stationIdMap.get(r.code);
        if (!stationId) {
          console.warn(`Station code ${r.code} not found in map!`);
          continue;
        }
        await connection.query(
          `INSERT INTO train_routes 
             (train_id, station_id, stop_sequence, arrival_time, departure_time, distance_km, day_offset, halt_minutes, platform)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          [trainId, stationId, r.seq, r.arr, r.dep, r.dist, r.day, r.halt, r.platform]
        );
      }
    }

    await connection.commit();
    console.log(`  ✓ Successfully seeded ${trainsData.length} trains with routes, running days, and classes.`);
    console.log('Railway master data seed finished successfully!\n');
  } catch (err) {
    await connection.rollback();
    console.error('Seed error, rolled back:', err);
    throw err;
  } finally {
    connection.release();
    await pool.end();
  }
}

if (require.main === module) {
  seedRailwayData()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = seedRailwayData;
