const bcrypt = require('bcryptjs');
const pool = require('../config/db');
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

async function seed() {
  const password = process.env.ADMIN_SEED_PASSWORD || 'Admin@12345';
  const hash = await bcrypt.hash(password, 10);
  await pool.query(`INSERT INTO users(full_name,email,phone,password,role,status) VALUES(?,?,?,?, 'admin','active') ON DUPLICATE KEY UPDATE role='admin', status='active'`, ['Yatrio Administrator','trio.in','9000000000',hash]);
  const [[admin]] = await pool.query(`SELECT id FROM users WHERE email='admin@yatrio.in' LIMIT 1`);
  const [trains] = await pool.query(`SELECT id,train_number FROM trains ORDER BY id LIMIT 5`);
  const [stations] = await pool.query(`SELECT station_code FROM stations ORDER BY id LIMIT 10`);
  if (trains.length >= 2 && stations.length >= 4) {
    const [users] = await pool.query(`SELECT id FROM users WHERE role='passenger' LIMIT 10`);
    for (let i=0;i<12;i++) {
      const pnr=`${2435600000+i}`;
      await pool.query(`INSERT INTO bookings(pnr,user_id,train_id,origin_code,destination_code,journey_date,travel_class,passengers,amount,status) VALUES(?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE pnr=pnr`, [pnr,users[i%Math.max(users.length,1)]?.id||admin.id,trains[i%trains.length].id,stations[i%stations.length].station_code,stations[(i+2)%stations.length].station_code,new Date(Date.now()+((i%7)+1)*86400000).toISOString().slice(0,10),i%3===0?'3A':'SL',1,850+i*120,i%7===0?'WAITLISTED':'CONFIRMED']);
    }
    const [bookings] = await pool.query(`SELECT id,amount FROM bookings ORDER BY id DESC LIMIT 12`);
    for (const b of bookings) await pool.query(`INSERT INTO payments(booking_id,transaction_id,amount,status,method,paid_at) VALUES(?,?,?,?,?,NOW()) ON DUPLICATE KEY UPDATE transaction_id=transaction_id`,[b.id,`TXN-${b.id}`,b.amount,'SUCCESS','UPI']);
  }
  console.log('Team 7 seed complete. Admin login: admin@yatrio.in / configured ADMIN_SEED_PASSWORD (default Admin@12345).');
  await pool.end();
}
seed().catch(e=>{console.error(e);process.exit(1);});
