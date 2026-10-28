'use strict';

/**
 * seedTeam3Datasets.js
 * Ingests Team 3 Fares, Quotas, Station/Train Zones and seeds 14-day Demo Availability Snapshots.
 */

const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const { sslOptions } = require('../config/database');

const FARE_MATRIX = [
  // 1 - 500 km
  { classCode: 'SL', min: 1, max: 500, base: 270, resFee: 20, sfFee: 30, gst: 0 },
  { classCode: '3A', min: 1, max: 500, base: 680, resFee: 40, sfFee: 45, gst: 5 },
  { classCode: '2A', min: 1, max: 500, base: 980, resFee: 50, sfFee: 50, gst: 5 },
  { classCode: '1A', min: 1, max: 500, base: 1650, resFee: 60, sfFee: 75, gst: 5 },
  { classCode: 'CC', min: 1, max: 500, base: 560, resFee: 40, sfFee: 45, gst: 5 },
  { classCode: '2S', min: 1, max: 500, base: 110, resFee: 15, sfFee: 15, gst: 0 },

  // 501 - 1000 km
  { classCode: 'SL', min: 501, max: 1000, base: 480, resFee: 20, sfFee: 30, gst: 0 },
  { classCode: '3A', min: 501, max: 1000, base: 1150, resFee: 40, sfFee: 45, gst: 5 },
  { classCode: '2A', min: 501, max: 1000, base: 1680, resFee: 50, sfFee: 50, gst: 5 },
  { classCode: '1A', min: 501, max: 1000, base: 2850, resFee: 60, sfFee: 75, gst: 5 },
  { classCode: 'CC', min: 501, max: 1000, base: 950, resFee: 40, sfFee: 45, gst: 5 },
  { classCode: '2S', min: 501, max: 1000, base: 210, resFee: 15, sfFee: 15, gst: 0 },

  // 1001 - 2000 km
  { classCode: 'SL', min: 1001, max: 2000, base: 680, resFee: 20, sfFee: 30, gst: 0 },
  { classCode: '3A', min: 1001, max: 2000, base: 1750, resFee: 40, sfFee: 45, gst: 5 },
  { classCode: '2A', min: 1001, max: 2000, base: 2550, resFee: 50, sfFee: 50, gst: 5 },
  { classCode: '1A', min: 1001, max: 2000, base: 4250, resFee: 60, sfFee: 75, gst: 5 },
  { classCode: 'CC', min: 1001, max: 2000, base: 1450, resFee: 40, sfFee: 45, gst: 5 },
  { classCode: '2S', min: 1001, max: 2000, base: 310, resFee: 15, sfFee: 15, gst: 0 },

  // > 2000 km
  { classCode: 'SL', min: 2001, max: 9999, base: 880, resFee: 20, sfFee: 30, gst: 0 },
  { classCode: '3A', min: 2001, max: 9999, base: 2250, resFee: 40, sfFee: 45, gst: 5 },
  { classCode: '2A', min: 2001, max: 9999, base: 3300, resFee: 50, sfFee: 50, gst: 5 },
  { classCode: '1A', min: 2001, max: 9999, base: 5400, resFee: 60, sfFee: 75, gst: 5 },
  { classCode: 'CC', min: 2001, max: 9999, base: 1950, resFee: 40, sfFee: 45, gst: 5 },
  { classCode: '2S', min: 2001, max: 9999, base: 410, resFee: 15, sfFee: 15, gst: 0 },
];

const QUOTAS = [
  { code: 'GN', name: 'General Quota', desc: 'Standard open booking quota' },
  { code: 'TQ', name: 'Tatkal Quota', desc: 'Last-minute emergency travel quota' },
  { code: 'LD', name: 'Ladies Quota', desc: 'Reserved quota for female passengers' },
  { code: 'PT', name: 'Premium Tatkal', desc: 'Dynamic pricing tatkal quota' },
  { code: 'SS', name: 'Senior Citizen', desc: 'Lower berth quota for seniors' },
];

const STATION_ZONES = {
  NDLS: 'NR',
  NZM: 'NR',
  MMCT: 'WR',
  CSMT: 'CR',
  DR: 'CR',
  TNA: 'CR',
  KYN: 'CR',
  KJT: 'CR',
  LNL: 'CR',
  PUNE: 'CR',
  AGC: 'NCR',
  GWL: 'NCR',
  JHS: 'NCR',
  BPL: 'WCR',
  RKMP: 'WCR',
  ET: 'WCR',
  BSL: 'CR',
  MMR: 'CR',
  ADI: 'WR',
  BRC: 'WR',
  ST: 'WR',
  KOTA: 'WCR',
  RTM: 'WR',
  JP: 'NWR',
  HWH: 'ER',
  SDAH: 'ER',
  MAS: 'SR',
  SBC: 'SWR',
  TVC: 'SR',
  IPR: 'ECR',
};

const TRAIN_ZONES = {
  '12951': 'WR',
  '12952': 'WR',
  '12002': 'NR',
  '12009': 'WR',
  '12010': 'WR',
  '12127': 'CR',
  '12128': 'CR',
  '12123': 'CR',
  '12124': 'CR',
  '12260': 'NR',
  '12301': 'ER',
  '12431': 'NR',
  '22691': 'SWR',
};

async function seedTeam3Data() {
  console.log('==============================================');
  console.log('  Seeding Team 3 Fares, Quotas & Availability  ');
  console.log('==============================================');

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    port: process.env.DB_PORT || 3306,
    database: process.env.DB_NAME || 'yatrio_db',
    ...(sslOptions ? { ssl: sslOptions } : {}),
  });

  try {
    // 1. Seed Quotas
    console.log('1. Seeding Quotas...');
    for (const q of QUOTAS) {
      await connection.query(
        `INSERT INTO quotas (quota_code, quota_name, description, is_active)
         VALUES (?, ?, ?, TRUE)
         ON DUPLICATE KEY UPDATE quota_name = VALUES(quota_name), description = VALUES(description);`,
        [q.code, q.name, q.desc]
      );
    }
    console.log(`   Seeded ${QUOTAS.length} booking quotas.`);

    // 2. Seed Fares Matrix
    console.log('2. Seeding Fares Distance Matrix...');
    for (const f of FARE_MATRIX) {
      await connection.query(
        `INSERT INTO fares (class_code, min_distance_km, max_distance_km, base_fare, reservation_fee, superfast_charge, gst_percent)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE 
            base_fare = VALUES(base_fare), 
            reservation_fee = VALUES(reservation_fee), 
            superfast_charge = VALUES(superfast_charge), 
            gst_percent = VALUES(gst_percent);`,
        [f.classCode, f.min, f.max, f.base, f.resFee, f.sfFee, f.gst]
      );
    }
    console.log(`   Seeded ${FARE_MATRIX.length} fare slab rules.`);

    // 3. Update Station Railway Zones
    console.log('3. Updating Station Railway Zones...');
    for (const [code, zone] of Object.entries(STATION_ZONES)) {
      await connection.query(
        `UPDATE stations SET railway_zone = ? WHERE station_code = ?;`,
        [zone, code]
      );
    }

    // 4. Update Train Railway Zones
    console.log('4. Updating Train Railway Zones...');
    for (const [trainNo, zone] of Object.entries(TRAIN_ZONES)) {
      await connection.query(
        `UPDATE trains SET railway_zone = ? WHERE train_number = ?;`,
        [zone, trainNo]
      );
    }

    // 5. Seed Demo Availability Snapshots for the next 14 days
    console.log('5. Generating 14-day Demo Availability Snapshots for test & active trains...');
    const [trainRows] = await connection.query(
      `SELECT id, train_number FROM trains 
        WHERE train_number IN ('12951', '12952', '12001', '12002', '12003', '12004', '22691', '12301', '12302', '12953', '12954', '12267') 
           OR id <= 150;`
    );
    const [classRows] = await connection.query(`SELECT DISTINCT class_code FROM train_classes;`);

    const availableClasses = classRows.map((r) => r.class_code);
    const quotaCodes = ['GN', 'TQ', 'LD', 'PT'];

    let snapshotCount = 0;
    const today = new Date();
    const batchValues = [];

    for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
      const targetDate = new Date(today);
      targetDate.setDate(today.getDate() + dayOffset);
      const dateString = targetDate.toISOString().split('T')[0];

      for (const train of trainRows) {
        for (const cls of availableClasses) {
          for (const quota of quotaCodes) {
            // Generate deterministic but realistic ConfirmTkt numbers
            const hash = (train.id * 17 + dayOffset * 31 + quota.charCodeAt(0) * 7 + cls.charCodeAt(0)) % 100;

            let totalSeats = 60;
            let availableSeats = 0;
            let racSeats = 0;
            let waitingSeats = 0;
            let status = 'AVAILABLE';
            let probability = 100;

            if (quota === 'GN') {
              totalSeats = 72;
              if (hash < 65) {
                status = 'AVAILABLE';
                availableSeats = 15 + (hash % 45);
                probability = 100;
              } else if (hash < 82) {
                status = 'RAC';
                availableSeats = 0;
                racSeats = 4 + (hash % 12);
                probability = 88;
              } else {
                status = 'WL';
                availableSeats = 0;
                waitingSeats = 3 + (hash % 18);
                probability = Math.max(45, 95 - waitingSeats * 3);
              }
            } else if (quota === 'TQ') {
              totalSeats = 16;
              availableSeats = (hash % 12) + 2;
              status = 'AVAILABLE';
              probability = 100;
            } else if (quota === 'LD') {
              totalSeats = 6;
              availableSeats = (hash % 5) + 1;
              status = 'AVAILABLE';
              probability = 100;
            } else if (quota === 'PT') {
              totalSeats = 12;
              availableSeats = (hash % 8) + 2;
              status = 'AVAILABLE';
              probability = 100;
            }

            batchValues.push([
              train.id,
              dateString,
              cls,
              quota,
              totalSeats,
              availableSeats,
              racSeats,
              waitingSeats,
              status,
              probability,
            ]);
            snapshotCount++;
          }
        }
      }
    }

    // Bulk insert in chunks of 500
    const CHUNK_SIZE = 500;
    for (let i = 0; i < batchValues.length; i += CHUNK_SIZE) {
      const chunk = batchValues.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
      const flattened = chunk.flat();
      await connection.query(
        `INSERT INTO availability_snapshots (
          train_id, journey_date, class_code, quota_code,
          total_seats, available_seats, rac_seats, waiting_seats,
          status, confirmation_probability
        ) VALUES ${placeholders}
        ON DUPLICATE KEY UPDATE 
          total_seats = VALUES(total_seats),
          available_seats = VALUES(available_seats),
          rac_seats = VALUES(rac_seats),
          waiting_seats = VALUES(waiting_seats),
          status = VALUES(status),
          confirmation_probability = VALUES(confirmation_probability);`,
        flattened
      );
    }

    console.log(`   Successfully seeded ${snapshotCount} availability snapshots across 14 dates.`);
    console.log('✅ Team 3 Dataset Seeding Complete!');
  } catch (err) {
    console.error('❌ Error seeding Team 3 datasets:', err);
    throw err;
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  seedTeam3Data().then(() => process.exit(0)).catch(() => process.exit(1));
}

module.exports = { seedTeam3Data };
