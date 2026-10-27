const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const dataDir = path.join(__dirname, '../../data');
const workbook = JSON.parse(fs.readFileSync(path.join(dataDir, 'import/workbook-data.json'), 'utf8'));

function parseCsvLine(line) {
  const out = []; let cell = ''; let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && quoted && line[i + 1] === '"') { cell += '"'; i++; }
    else if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) { out.push(cell); cell = ''; }
    else cell += ch;
  }
  out.push(cell); return out;
}
function readCsv(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines.shift()).map(h => h.trim());
  return lines.map(line => { const cells = parseCsvLine(line); const row = {}; headers.forEach((h, i) => row[h] = (cells[i] || '').trim()); return row; });
}
const clean = v => String(v ?? '').trim();
const timeOrNull = v => { const s = clean(v); return !s || s === '00:00:00' ? null : /^\d{1,2}:\d{2}(:\d{2})?$/.test(s) ? (s.length === 5 ? `${s}:00` : s) : null; };

async function main() {
  const db = await mysql.createPool({host:process.env.DB_HOST||'localhost',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD||'',database:process.env.DB_NAME||'yatrio_db',connectionLimit:4});
  const conn = await db.getConnection();
  try {
    console.log('Importing station, train, route and PNR data supplied with this project...');
    const stationMeta = new Map();
    for (const s of workbook.Stations || []) {
      const code=clean(s['Station Code']).toUpperCase(); if (!code) continue;
      stationMeta.set(code,{code,name:clean(s['Station Name']),city:clean(s.City)||clean(s['Station Name']),state:clean(s.State)||'Unknown'});
    }
    const routeFiles = [
      {file:'source/Train_details_22122017.csv', year:2017, cols:{no:'Train No',name:'Train Name',seq:'SEQ',code:'Station Code',station:'Station Name',arr:'Arrival time',dep:'Departure Time',dist:'Distance',src:'Source Station',srcName:'Source Station Name',dst:'Destination Station',dstName:'Destination Station Name'}},
      {file:'source/isl_wise_train_detail_03082015_v1.csv', year:2015, cols:{no:'Train No.',name:'train Name',seq:'islno',code:'station Code',station:'Station Name',arr:'Arrival time',dep:'Departure time',dist:'Distance',src:'Source Station Code',srcName:'source Station Name',dst:'Destination station Code',dstName:'Destination Station Name'}}
    ];
    const trainGroups = new Map();
    for (const spec of routeFiles) {
      const rows=readCsv(path.join(dataDir,spec.file));
      for (const r of rows) {
        const c=spec.cols; const number=clean(r[c.no]); const code=clean(r[c.code]).toUpperCase();
        if (!number || !code) continue;
        // Prefer the newer 2017 source where train numbers overlap.
        if (spec.year===2015 && trainGroups.has(number)) continue;
        const seq=Number(r[c.seq])||1;
        if (!trainGroups.has(number)) trainGroups.set(number,{number,name:clean(r[c.name])||`Train ${number}`,year:spec.year,sourceCode:clean(r[c.src]).toUpperCase(),sourceName:clean(r[c.srcName]),destinationCode:clean(r[c.dst]).toUpperCase(),destinationName:clean(r[c.dstName]),stops:[]});
        const group=trainGroups.get(number);
        if (group.year!==spec.year) continue;
        group.stops.push({seq,code,name:clean(r[c.station])||code,arr:timeOrNull(r[c.arr]),dep:timeOrNull(r[c.dep]),distance:Number(r[c.dist])||0});
        if (!stationMeta.has(code)) stationMeta.set(code,{code,name:clean(r[c.station])||code,city:clean(r[c.station])||code,state:'Unknown'});
      }
    }
    // The workbook adds recent illustrative trains/PNR data not necessarily present in the historic route CSVs.
    const wbTrains = new Map((workbook.Trains||[]).map(t=>[clean(t['Train No']),t]));
    for (const [number,t] of wbTrains) {
      if (!trainGroups.has(number)) {
        const source=clean(t['Origin Station']).toUpperCase(), dest=clean(t['Destination Station']).toUpperCase();
        trainGroups.set(number,{number,name:clean(t['Train Name']),year:2026,sourceCode:source,sourceName:source,destinationCode:dest,destinationName:dest,stops:[{seq:1,code:source,name:source,arr:null,dep:timeOrNull(t['Departure Time']),distance:0},{seq:2,code:dest,name:dest,arr:timeOrNull(t['Arrival Time']),dep:null,distance:Number(t['Distance (km)'])||0}]});
        for (const code of [source,dest]) if (code&&!stationMeta.has(code)) stationMeta.set(code,{code,name:code,city:code,state:'Unknown'});
      }
    }
    await conn.beginTransaction();
    for (const s of stationMeta.values()) {
      await conn.query(`INSERT INTO stations(station_code,station_name,city,state,timezone,status) VALUES(?,?,?,?, 'Asia/Kolkata','active') ON DUPLICATE KEY UPDATE station_name=VALUES(station_name), city=IF(stations.state='Unknown',VALUES(city),stations.city)`,[s.code,s.name.slice(0,100),s.city.slice(0,100),s.state.slice(0,100)]);
    }
    const [stationRows]=await conn.query('SELECT id,station_code FROM stations');
    const stationIds=new Map(stationRows.map(s=>[s.station_code,s.id]));
    let trainCount=0, routeCount=0;
    for (const g of trainGroups.values()) {
      const wb=wbTrains.get(g.number); const type=clean(wb?.Type)||(/rajdhani/i.test(g.name)?'Rajdhani':/shatabdi/i.test(g.name)?'Shatabdi':/vande bharat/i.test(g.name)?'Vande Bharat':'Express');
      await conn.query(`INSERT INTO trains(train_number,train_name,train_type,status,pantry_available) VALUES(?,?,?,'active',?) ON DUPLICATE KEY UPDATE train_name=VALUES(train_name),train_type=VALUES(train_type)`,[g.number,g.name.slice(0,100),type,/true|yes/i.test(clean(wb?.['Pantry Available']))]);
      const [[train]]=await conn.query('SELECT id FROM trains WHERE train_number=?',[g.number]);
      await conn.query('DELETE FROM train_routes WHERE train_id=?',[train.id]);
      const stops=g.stops.sort((a,b)=>a.seq-b.seq);
      for (let i=0;i<stops.length;i++) {
        const st=stops[i], sid=stationIds.get(st.code); if (!sid) continue;
        await conn.query(`INSERT INTO train_routes(train_id,station_id,stop_sequence,arrival_time,departure_time,distance_km,day_offset) VALUES(?,?,?,?,?,?,?)`,[train.id,sid,i+1,st.arr,st.dep,st.distance,st.seq>1 && st.arr && stops[i-1]?.dep && st.arr < stops[i-1].dep ? 2 : 1]); routeCount++;
      }
      trainCount++;
    }
    // Load sample PNR records as booking records. These are sample/reference data from the workbook, not live IRCTC transactions.
    let bookingCount=0;
    for (const p of workbook.PNR_Master||[]) {
      const pnr=clean(p['PNR Number']); const trainNo=clean(p['Train No']); const journey=clean(p['Journey Date']).slice(0,10);
      if (!pnr || !/^\d{4}-\d{2}-\d{2}$/.test(journey)) continue;
      const trainId=trainGroups.has(trainNo) ? (await conn.query('SELECT id FROM trains WHERE train_number=?',[trainNo]))[0][0]?.id : null;
      const statusMap={CNF:'CONFIRMED',RAC:'RAC',WL:'WAITLISTED',CAN:'CANCELLED',NOSB:'WAITLISTED'};
      const status=statusMap[clean(p['Current Status']).toUpperCase()]||'CONFIRMED';
      const train=wbTrains.get(trainNo); const origin=clean(train?.['Origin Station'])||'UNK'; const destination=clean(train?.['Destination Station'])||'UNK';
      await conn.query(`INSERT INTO bookings(pnr,user_id,train_id,origin_code,destination_code,journey_date,travel_class,passengers,amount,status) VALUES(?,NULL,?,?,?,?,?,1,?,?) ON DUPLICATE KEY UPDATE train_id=VALUES(train_id),origin_code=VALUES(origin_code),destination_code=VALUES(destination_code),journey_date=VALUES(journey_date),travel_class=VALUES(travel_class),amount=VALUES(amount),status=VALUES(status)`,[pnr,trainId||null,origin,destination,journey,clean(p['Class Code'])||'SL',Number(p['Total Fare (₹)'])||0,status]); bookingCount++;
    }
    await conn.commit();
    console.log(`Imported/upserted ${stationMeta.size} stations, ${trainCount} trains, ${routeCount} route stops, ${bookingCount} sample PNR bookings.`);
    console.log('Note: historical train schedules and workbook PNR records are reference/demo data, not live railway data.');
  } catch (e) { await conn.rollback(); throw e; }
  finally { conn.release(); await db.end(); }
}
main().catch(e=>{console.error('Provided-data import failed:',e.message);process.exit(1)});
