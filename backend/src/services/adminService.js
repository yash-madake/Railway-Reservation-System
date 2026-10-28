const pool = require('../config/db');
const redis = require('./redisService');
const { recordAudit } = require('./auditService');

const allowedSorts = {
  users: { createdAt: 'u.created_at', name: 'u.full_name', email: 'u.email', role: 'u.role', status: 'u.status' },
  bookings: { createdAt: 'b.created_at', journeyDate: 'b.journey_date', amount: 'b.amount', status: 'b.status', pnr: 'b.pnr' },
  payments: { createdAt: 'p.created_at', amount: 'p.amount', status: 'p.status' },
  cancellations: { cancelledAt: 'c.cancelled_at', refundAmount: 'c.refund_amount', status: 'c.status' },
  audit: { createdAt: 'a.created_at', action: 'a.action', module: 'a.module', status: 'a.status' }
};

function pagination(query, resource) {
  const page = Math.max(parseInt(query.page || '1', 10) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(query.pageSize || '20', 10) || 20, 1), 100);
  const sortBy = allowedSorts[resource][query.sortBy] ? query.sortBy : Object.keys(allowedSorts[resource])[0];
  const sortOrder = String(query.sortOrder).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  return { page, pageSize, offset: (page - 1) * pageSize, order: `${allowedSorts[resource][sortBy]} ${sortOrder}` };
}

async function listUsers(query) {
  const p = pagination(query, 'users'); const params=[]; const where=[];
  if (query.search) { where.push('(u.full_name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)'); params.push(`%${query.search}%`,`%${query.search}%`,`%${query.search}%`); }
  if (query.role) { where.push('u.role = ?'); params.push(query.role); }
  if (query.status) { where.push('u.status = ?'); params.push(query.status); }
  const w=where.length?`WHERE ${where.join(' AND ')}`:'';
  const [[{total}]] = await pool.query(`SELECT COUNT(*) total FROM users u ${w}`, params);
  const [data] = await pool.query(`SELECT u.id,u.full_name name,u.email,u.phone,u.role,u.status,u.created_at createdAt FROM users u ${w} ORDER BY ${p.order} LIMIT ? OFFSET ?`, [...params,p.pageSize,p.offset]);
  return {data,page:p.page,pageSize:p.pageSize,total,totalPages:Math.ceil(total/p.pageSize)};
}

async function listBookings(query) {
  const p = pagination(query,'bookings'); const params=[]; const where=[];
  if(query.search){where.push('(b.pnr LIKE ? OR u.full_name LIKE ? OR b.origin_code LIKE ? OR b.destination_code LIKE ?)'); params.push(`%${query.search}%`,`%${query.search}%`,`%${query.search}%`,`%${query.search}%`);}
  if(query.status){where.push('b.status=?');params.push(query.status);}
  if(query.train){where.push('t.train_number=?');params.push(query.train);}
  if(query.class){where.push('b.travel_class=?');params.push(query.class);}
  if(query.origin){where.push('b.origin_code=?');params.push(query.origin);}
  if(query.destination){where.push('b.destination_code=?');params.push(query.destination);}
  if(query.from){where.push('b.journey_date>=?');params.push(query.from);}
  if(query.to){where.push('b.journey_date<=?');params.push(query.to);}
  const w=where.length?`WHERE ${where.join(' AND ')}`:'';
  const [[{total}]] = await pool.query(`SELECT COUNT(*) total FROM bookings b LEFT JOIN users u ON u.id=b.user_id LEFT JOIN trains t ON t.id=b.train_id ${w}`,params);
  const [data]=await pool.query(`SELECT b.id,b.pnr,b.journey_date journeyDate,b.origin_code origin,b.destination_code destination,b.travel_class travelClass,b.passengers,b.amount,b.status,b.created_at createdAt,u.full_name passenger,t.train_number trainNumber,t.train_name trainName FROM bookings b LEFT JOIN users u ON u.id=b.user_id LEFT JOIN trains t ON t.id=b.train_id ${w} ORDER BY ${p.order} LIMIT ? OFFSET ?`,[...params,p.pageSize,p.offset]);
  return {data,page:p.page,pageSize:p.pageSize,total,totalPages:Math.ceil(total/p.pageSize)};
}

async function listPayments(query) {
  const p=pagination(query,'payments'); const params=[]; const where=[];
  if(query.search){where.push('(p.transaction_id LIKE ? OR b.pnr LIKE ?)');params.push(`%${query.search}%`,`%${query.search}%`);}
  if(query.status){where.push('p.status=?');params.push(query.status);}
  const w=where.length?`WHERE ${where.join(' AND ')}`:'';
  const [[{total}]]=await pool.query(`SELECT COUNT(*) total FROM payments p LEFT JOIN bookings b ON b.id=p.booking_id ${w}`,params);
  const [data]=await pool.query(`SELECT p.id,p.transaction_id transactionId,p.amount,p.status,p.method,p.paid_at paidAt,p.created_at createdAt,b.pnr FROM payments p LEFT JOIN bookings b ON b.id=p.booking_id ${w} ORDER BY ${p.order} LIMIT ? OFFSET ?`,[...params,p.pageSize,p.offset]);
  return {data,page:p.page,pageSize:p.pageSize,total,totalPages:Math.ceil(total/p.pageSize)};
}

async function listCancellations(query) {
  const p=pagination(query,'cancellations'); const params=[]; const where=[];
  if(query.search){where.push('(b.pnr LIKE ? OR c.reason LIKE ?)');params.push(`%${query.search}%`,`%${query.search}%`);}
  if(query.status){where.push('c.status=?');params.push(query.status);}
  const w=where.length?`WHERE ${where.join(' AND ')}`:'';
  const [[{total}]]=await pool.query(`SELECT COUNT(*) total FROM cancellations c LEFT JOIN bookings b ON b.id=c.booking_id ${w}`,params);
  const [data]=await pool.query(`SELECT c.id,b.pnr,c.reason,c.refund_amount refundAmount,c.status,c.cancelled_at cancelledAt FROM cancellations c LEFT JOIN bookings b ON b.id=c.booking_id ${w} ORDER BY ${p.order} LIMIT ? OFFSET ?`,[...params,p.pageSize,p.offset]);
  return {data,page:p.page,pageSize:p.pageSize,total,totalPages:Math.ceil(total/p.pageSize)};
}

async function dashboard() {
  const cached=await redis.get('admin:dashboard'); if(cached) return cached;
  const [[row]] = await pool.query('SELECT get_dashboard_statistics() stats');
  const stats = typeof row.stats === 'string'
  ? JSON.parse(row.stats)
  : row.stats;
  const [recent]=await pool.query(`SELECT * FROM v_booking_summary ORDER BY created_at DESC LIMIT 8`);
  const [revenue]=await pool.query(`SELECT revenue_date date,revenue,successful_payments payments FROM v_revenue_daily WHERE revenue_date >= CURRENT_DATE() - INTERVAL 6 DAY ORDER BY revenue_date`);
  const [routes]=await pool.query(`SELECT origin_code origin,destination_code destination,COUNT(*) bookings,ROUND(SUM(amount),2) revenue FROM bookings WHERE status <> 'CANCELLED' GROUP BY origin_code,destination_code ORDER BY bookings DESC LIMIT 6`);
  const result={stats,recent,revenue,routes}; await redis.set('admin:dashboard',result,30); return result;
}

async function auditLogs(query) {
  const p=pagination(query,'audit'); const params=[]; const where=[];
  if(query.search){where.push('(a.module LIKE ? OR a.action LIKE ? OR a.record_id LIKE ? OR a.ip_address LIKE ?)'); params.push(`%${query.search}%`,`%${query.search}%`,`%${query.search}%`,`%${query.search}%`);}
  if(query.module){where.push('a.module=?');params.push(query.module);}
  if(query.status){where.push('a.status=?');params.push(query.status);}
  const w=where.length?`WHERE ${where.join(' AND ')}`:'';
  const [[{total}]]=await pool.query(`SELECT COUNT(*) total FROM audit_logs a ${w}`,params);
  const [data]=await pool.query(`SELECT a.id,a.action,a.module,a.record_id recordId,a.status,a.ip_address ipAddress,a.details,a.created_at createdAt,u.email actor FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_user_id ${w} ORDER BY ${p.order} LIMIT ? OFFSET ?`,[...params,p.pageSize,p.offset]);
  return {data,page:p.page,pageSize:p.pageSize,total,totalPages:Math.ceil(total/p.pageSize)};
}


async function listTrains(query = {}) {
  const page = Math.max(parseInt(query.page || '1', 10) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(query.pageSize || '20', 10) || 20, 1), 100);
  const offset = (page - 1) * pageSize;
  const params = [];
  const where = [];
  if (query.search) {
    where.push('(t.train_number LIKE ? OR t.train_name LIKE ?)');
    params.push(`%${query.search}%`, `%${query.search}%`);
  }
  if (query.type) { where.push('LOWER(t.train_type)=LOWER(?)'); params.push(query.type); }
  if (query.status) { where.push('LOWER(t.status)=LOWER(?)'); params.push(query.status); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) total FROM trains t ${w}`, params);
  const [data] = await pool.query(`
    SELECT t.id, t.train_number number, t.train_name name, t.train_type type,
           t.status, MIN(tr1.station_id) sourceStationId, MAX(tr2.station_id) destinationStationId,
           (SELECT s.station_code FROM stations s WHERE s.id = (
             SELECT tr.station_id FROM train_routes tr WHERE tr.train_id=t.id ORDER BY tr.stop_sequence ASC LIMIT 1
           )) source,
           (SELECT s.station_code FROM stations s WHERE s.id = (
             SELECT tr.station_id FROM train_routes tr WHERE tr.train_id=t.id ORDER BY tr.stop_sequence DESC LIMIT 1
           )) destination,
           (SELECT TIME_FORMAT(tr.departure_time,'%H:%i') FROM train_routes tr WHERE tr.train_id=t.id ORDER BY tr.stop_sequence ASC LIMIT 1) dep,
           (SELECT TIME_FORMAT(tr.arrival_time,'%H:%i') FROM train_routes tr WHERE tr.train_id=t.id ORDER BY tr.stop_sequence DESC LIMIT 1) arr
    FROM trains t
    LEFT JOIN train_routes tr1 ON tr1.train_id=t.id AND tr1.stop_sequence=(SELECT MIN(x.stop_sequence) FROM train_routes x WHERE x.train_id=t.id)
    LEFT JOIN train_routes tr2 ON tr2.train_id=t.id AND tr2.stop_sequence=(SELECT MAX(x.stop_sequence) FROM train_routes x WHERE x.train_id=t.id)
    ${w}
    GROUP BY t.id
    ORDER BY t.id DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
  return { data, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}


async function getTrainDetail(id) {
  const [[train]] = await pool.query(`
    SELECT id, train_number trainNumber, train_name trainName, train_type trainType, status, pantry_available pantryAvailable,
           created_at createdAt, updated_at updatedAt
    FROM trains WHERE id=? LIMIT 1`, [id]);
  if (!train) { const e=new Error('Train not found'); e.status=404; throw e; }
  const [routes] = await pool.query(`
    SELECT tr.id, tr.stop_sequence stopSequence, tr.arrival_time arrivalTime, tr.departure_time departureTime,
           tr.distance_km distanceKm, tr.day_offset dayOffset, tr.halt_minutes haltMinutes, tr.platform,
           s.id stationId, s.station_code stationCode, s.station_name stationName, s.city, s.state
    FROM train_routes tr JOIN stations s ON s.id=tr.station_id
    WHERE tr.train_id=? ORDER BY tr.stop_sequence`, [id]);
  const [days] = await pool.query(`SELECT day_of_week day FROM train_running_days WHERE train_id=? ORDER BY FIELD(day_of_week,'MON','TUE','WED','THU','FRI','SAT','SUN')`, [id]);
  const [classes] = await pool.query(`SELECT id,class_code classCode,class_name className,base_fare baseFare,total_seats totalSeats,available_seats availableSeats FROM train_classes WHERE train_id=? ORDER BY id`, [id]);
  return {...train, routes, runningDays:days.map(x=>x.day), classes};
}

async function addTrainRoute(trainId, payload, actorUserId, ipAddress) {
  const stationCode = String(payload.stationCode || '').trim().toUpperCase();
  const stopSequence = Number(payload.stopSequence);
  if (!stationCode || !Number.isInteger(stopSequence) || stopSequence < 1) { const e=new Error('Station code and a valid stop sequence are required'); e.status=400; throw e; }
  const [[train]] = await pool.query('SELECT id FROM trains WHERE id=? LIMIT 1', [trainId]);
  if (!train) { const e=new Error('Train not found'); e.status=404; throw e; }
  const [[station]] = await pool.query('SELECT id FROM stations WHERE station_code=? AND status="active" LIMIT 1', [stationCode]);
  if (!station) { const e=new Error('Station not found or inactive'); e.status=400; throw e; }
  const connection=await pool.getConnection();
  try {
    await connection.beginTransaction();
    // Shift existing stops so the requested sequence can be inserted safely.
    await connection.query('UPDATE train_routes SET stop_sequence=stop_sequence+100000 WHERE train_id=? AND stop_sequence>=?', [trainId, stopSequence]);
    await connection.query(`INSERT INTO train_routes(train_id,station_id,stop_sequence,arrival_time,departure_time,distance_km,day_offset,halt_minutes,platform) VALUES(?,?,?,?,?,?,?,?,?)`, [trainId,station.id,stopSequence,payload.arrivalTime||null,payload.departureTime||null,Number(payload.distanceKm)||0,Number(payload.dayOffset)||1,Number(payload.haltMinutes)||0,String(payload.platform||'1')]);
    await connection.query('UPDATE train_routes SET stop_sequence=stop_sequence-100000 WHERE train_id=? AND stop_sequence>=?', [trainId, 100000+stopSequence]);
    await connection.commit();
    await recordAudit({actorUserId,action:'TRAIN_ROUTE_ADDED',module:'TRAIN_ROUTE',recordId:trainId,ipAddress,details:{stationCode,stopSequence}});
    return await getTrainDetail(trainId);
  } catch(e) { await connection.rollback(); if(e.code==='ER_DUP_ENTRY'){e.status=409;e.message='A route stop with this sequence already exists';} throw e; }
  finally { connection.release(); }
}

async function deleteTrainRoute(trainId, routeId, actorUserId, ipAddress) {
  const [[route]] = await pool.query('SELECT id, stop_sequence stopSequence FROM train_routes WHERE id=? AND train_id=? LIMIT 1',[routeId,trainId]);
  if (!route) { const e=new Error('Route stop not found'); e.status=404; throw e; }
  const [[count]] = await pool.query('SELECT COUNT(*) count FROM train_routes WHERE train_id=?',[trainId]);
  if (Number(count.count) <= 2) { const e=new Error('A train must keep at least a source and destination stop'); e.status=400; throw e; }
  const connection=await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query('DELETE FROM train_routes WHERE id=? AND train_id=?',[routeId,trainId]);
    await connection.query('UPDATE train_routes SET stop_sequence=stop_sequence-1 WHERE train_id=? AND stop_sequence>?',[trainId,route.stopSequence]);
    await connection.commit();
    await recordAudit({actorUserId,action:'TRAIN_ROUTE_DELETED',module:'TRAIN_ROUTE',recordId:routeId,ipAddress,details:{trainId}});
    return await getTrainDetail(trainId);
  } catch(e){ await connection.rollback(); throw e; } finally { connection.release(); }
}

async function deleteTrain(id, actorUserId, ipAddress) {
  const [[train]] = await pool.query('SELECT id,train_number trainNumber FROM trains WHERE id=? LIMIT 1',[id]);
  if (!train) { const e=new Error('Train not found'); e.status=404; throw e; }
  const [result] = await pool.query('DELETE FROM trains WHERE id=?',[id]);
  if (!result.affectedRows) { const e=new Error('Train could not be deleted'); e.status=400; throw e; }
  await recordAudit({actorUserId,action:'TRAIN_DELETED',module:'TRAIN_MASTER',recordId:id,ipAddress,details:{trainNumber:train.trainNumber}});
  return {id,trainNumber:train.trainNumber,deleted:true};
}

async function createTrain(payload, actorUserId, ipAddress) {
  const {
    trainNumber, trainName, trainType = 'Express', status = 'active',
    sourceStation, destinationStation, departureTime, arrivalTime,
    distanceKm = 0, runningDays = ['MON','TUE','WED','THU','FRI','SAT','SUN'], classes = []
  } = payload;
  if (!trainNumber || !trainName || !sourceStation || !destinationStation || !departureTime || !arrivalTime) {
    const e = new Error('Train number, name, source, destination and timings are required'); e.status=400; throw e;
  }
  if (sourceStation === destinationStation) { const e=new Error('Source and destination stations must be different'); e.status=400; throw e; }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[src]] = await connection.query('SELECT id FROM stations WHERE station_code=? LIMIT 1', [sourceStation]);
    const [[dst]] = await connection.query('SELECT id FROM stations WHERE station_code=? LIMIT 1', [destinationStation]);
    if (!src || !dst) { const e=new Error('Selected station was not found'); e.status=400; throw e; }
    const [result] = await connection.query(
      `INSERT INTO trains(train_number,train_name,train_type,status) VALUES(?,?,?,?)`,
      [trainNumber, trainName, trainType, String(status).toLowerCase()]
    );
    const trainId = result.insertId;
    await connection.query(
      `INSERT INTO train_routes(train_id,station_id,stop_sequence,arrival_time,departure_time,distance_km,day_offset) VALUES(?,?,?,?,?,?,?)`,
      [trainId, src.id, 1, null, departureTime, 0, 1]
    );
    await connection.query(
      `INSERT INTO train_routes(train_id,station_id,stop_sequence,arrival_time,departure_time,distance_km,day_offset) VALUES(?,?,?,?,?,?,?)`,
      [trainId, dst.id, 2, arrivalTime, null, Number(distanceKm)||0, 1]
    );
    for (const day of runningDays || []) {
      await connection.query(`INSERT IGNORE INTO train_running_days(train_id,day_of_week) VALUES(?,?)`, [trainId, day]);
    }
    for (const c of (classes && classes.length ? classes : [{classCode:'SL',className:'Sleeper (SL)',coaches:1,seatsPerCoach:72}])) {
      const coaches = Math.max(Number(c.coaches)||1,1);
      const seats = Math.max(Number(c.seatsPerCoach)||1,1);
      await connection.query(
        `INSERT INTO train_classes(train_id,class_code,class_name,base_fare,total_seats,available_seats) VALUES(?,?,?,?,?,?)`,
        [trainId, c.classCode, c.className || c.classCode, Number(c.baseFare)||0, coaches*seats, coaches*seats]
      );
    }
    await connection.commit();
    await recordAudit({ actorUserId, action:'TRAIN_CREATED', module:'TRAIN_MASTER', recordId:trainId, ipAddress, details:{trainNumber} });
    return { id: trainId, trainNumber };
  } catch (e) {
    await connection.rollback();
    if (e.code === 'ER_DUP_ENTRY') { e.status=409; e.message='A train with this train number already exists'; }
    throw e;
  } finally { connection.release(); }
}

async function deactivateTrain(id, actorUserId, ipAddress) {
  const [result] = await pool.query(`UPDATE trains SET status='inactive' WHERE id=? AND status <> 'inactive'`, [id]);
  if (!result.affectedRows) { const e=new Error('Train not found or already inactive'); e.status=404; throw e; }
  await recordAudit({ actorUserId, action:'TRAIN_DEACTIVATED', module:'TRAIN_MASTER', recordId:id, ipAddress });
  return { id, status:'inactive' };
}

async function listStations(query = {}) {
  const page = Math.max(parseInt(query.page || '1', 10) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(query.pageSize || '20', 10) || 20, 1), 100);
  const offset = (page - 1) * pageSize;
  const params = [];
  const where = [];
  if (query.search) {
    where.push('(station_code LIKE ? OR station_name LIKE ? OR city LIKE ?)');
    const q = `%${query.search}%`;
    params.push(q, q, q);
  }
  if (query.state) { where.push('LOWER(state)=LOWER(?)'); params.push(query.state); }
  if (query.status) { where.push('status=?'); params.push(String(query.status).toLowerCase()); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) total FROM stations ${w}`, params);
  const [data] = await pool.query(`
    SELECT id, station_code code, station_name name, city, state, timezone, status,
           created_at createdAt, updated_at updatedAt
    FROM stations ${w}
    ORDER BY station_name ASC
    LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
  return { data, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}

async function createStation(payload, actorUserId, ipAddress) {
  const code = String(payload.stationCode || '').trim().toUpperCase();
  const name = String(payload.stationName || '').trim();
  const city = String(payload.city || '').trim();
  const state = String(payload.state || '').trim();
  const timezone = String(payload.timezone || 'Asia/Kolkata').trim();
  const status = String(payload.status || 'active').toLowerCase();
  if (!code || !name || !city || !state) {
    const e = new Error('Station code, name, city and state are required'); e.status = 400; throw e;
  }
  if (!/^[A-Z0-9]{2,10}$/.test(code)) { const e=new Error('Station code must contain 2-10 uppercase letters or numbers'); e.status=400; throw e; }
  if (!['active','inactive'].includes(status)) { const e=new Error('Invalid station status'); e.status=400; throw e; }
  try {
    const [result] = await pool.query(
      `INSERT INTO stations(station_code,station_name,city,state,timezone,status) VALUES(?,?,?,?,?,?)`,
      [code,name,city,state,timezone,status]
    );
    await recordAudit({actorUserId, action:'STATION_CREATED', module:'STATION_MASTER', recordId:result.insertId, ipAddress, details:{stationCode:code}});
    return { id: result.insertId, stationCode: code };
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') { e.status=409; e.message='A station with this code already exists'; }
    throw e;
  }
}

async function updateStation(id, payload, actorUserId, ipAddress) {
  const code = String(payload.stationCode || '').trim().toUpperCase();
  const name = String(payload.stationName || '').trim();
  const city = String(payload.city || '').trim();
  const state = String(payload.state || '').trim();
  const timezone = String(payload.timezone || 'Asia/Kolkata').trim();
  const status = String(payload.status || 'active').toLowerCase();
  if (!code || !name || !city || !state) { const e=new Error('Station code, name, city and state are required'); e.status=400; throw e; }
  if (!['active','inactive'].includes(status)) { const e=new Error('Invalid station status'); e.status=400; throw e; }
  try {
    const [result] = await pool.query(
      `UPDATE stations SET station_code=?,station_name=?,city=?,state=?,timezone=?,status=? WHERE id=?`,
      [code,name,city,state,timezone,status,id]
    );
    if (!result.affectedRows) { const e=new Error('Station not found'); e.status=404; throw e; }
    await recordAudit({actorUserId, action:'STATION_UPDATED', module:'STATION_MASTER', recordId:id, ipAddress, details:{stationCode:code}});
    return { id:Number(id), stationCode:code, status };
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') { e.status=409; e.message='A station with this code already exists'; }
    throw e;
  }
}

async function deactivateStation(id, actorUserId, ipAddress) {
  const [result] = await pool.query(`UPDATE stations SET status='inactive' WHERE id=? AND status <> 'inactive'`, [id]);
  if (!result.affectedRows) { const e=new Error('Station not found or already inactive'); e.status=404; throw e; }
  await recordAudit({actorUserId, action:'STATION_DEACTIVATED', module:'STATION_MASTER', recordId:id, ipAddress});
  return { id:Number(id), status:'inactive' };
}

module.exports={listUsers,listBookings,listPayments,listCancellations,dashboard,auditLogs,listTrains,getTrainDetail,createTrain,addTrainRoute,deleteTrainRoute,deleteTrain,deactivateTrain,listStations,createStation,updateStation,deactivateStation, listVerifiedDefenceCandidates};

async function listVerifiedDefenceCandidates() {
  const [rows] = await pool.query(`
    SELECT
      id AS serialNo,
      first_name AS firstName,
      last_name AS lastName,
      defence_id AS defenceId
    FROM defence_candidates
    WHERE verification_status = 'verified'
    ORDER BY id ASC
    LIMIT 150
  `);

  return rows;
}