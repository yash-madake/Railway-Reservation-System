const service = require('../services/adminService');
const { recordAudit } = require('../services/auditService');
const redis = require('../services/redisService');
const pool = require('../config/db');

const safe = (fn) => async (req,res,next) => { try { const data=await fn(req); res.json({success:true,data}); } catch(e){ next(e); } };

exports.dashboard = safe(() => service.dashboard());
exports.users = safe(req => service.listUsers(req.query));
exports.bookings = safe(req => service.listBookings(req.query));
exports.payments = safe(req => service.listPayments(req.query));
exports.cancellations = safe(req => service.listCancellations(req.query));
exports.auditLogs = safe(req => service.auditLogs(req.query));
exports.monitoring = safe(async () => {
  const [api]=await pool.query(`SELECT COUNT(*) requests, SUM(status_code>=500) errors, ROUND(AVG(duration_ms),1) avgDurationMs, MAX(duration_ms) maxDurationMs FROM api_request_logs WHERE created_at >= NOW()-INTERVAL 1 HOUR`);
  return {api:api[0],redis:await redis.status(),serverTime:new Date().toISOString()};
});
exports.analytics = safe(async () => {
  const [[revenue]]=await pool.query('SELECT get_daily_revenue(30) value');
  const [[routes]]=await pool.query('SELECT get_popular_routes(10) value');
  const [[occupancy]]=await pool.query('SELECT get_train_occupancy(10) value');
  return {revenue:JSON.parse(revenue.value||'[]'),routes:JSON.parse(routes.value||'[]'),occupancy:JSON.parse(occupancy.value||'[]')};
});

exports.writeAudit = async (req, action, module, recordId, details) => {
  try { await recordAudit({actorUserId:req.user?.id,action,module,recordId,ipAddress:req.ip,details}); } catch(e) { console.error('Audit write failed:',e.message); }
};

exports.trains = safe(req => service.listTrains(req.query));
exports.trainDetail = safe(req => service.getTrainDetail(req.params.id));
exports.addTrainRoute = async (req,res,next) => {
  try { const data=await service.addTrainRoute(req.params.id, req.body, req.user?.id, req.ip); res.status(201).json({success:true,data}); }
  catch(e){ next(e); }
};
exports.deleteTrainRoute = async (req,res,next) => {
  try { const data=await service.deleteTrainRoute(req.params.id, req.params.routeId, req.user?.id, req.ip); res.json({success:true,data}); }
  catch(e){ next(e); }
};
exports.deleteTrain = async (req,res,next) => {
  try { const data=await service.deleteTrain(req.params.id, req.user?.id, req.ip); res.json({success:true,data}); }
  catch(e){ next(e); }
};

exports.createTrain = async (req,res,next) => {
  try { const data=await service.createTrain(req.body, req.user?.id, req.ip); res.status(201).json({success:true,data}); }
  catch(e){ next(e); }
};
exports.deactivateTrain = async (req,res,next) => {
  try { const data=await service.deactivateTrain(req.params.id, req.user?.id, req.ip); res.json({success:true,data}); }
  catch(e){ next(e); }
};

exports.stations = safe(req => service.listStations(req.query));
exports.createStation = async (req,res,next) => {
  try { const data=await service.createStation(req.body, req.user?.id, req.ip); res.status(201).json({success:true,data}); }
  catch(e){ next(e); }
};
exports.updateStation = async (req,res,next) => {
  try { const data=await service.updateStation(req.params.id, req.body, req.user?.id, req.ip); res.json({success:true,data}); }
  catch(e){ next(e); }
};
exports.deactivateStation = async (req,res,next) => {
  try { const data=await service.deactivateStation(req.params.id, req.user?.id, req.ip); res.json({success:true,data}); }
  catch(e){ next(e); }
};
exports.defenceCandidates = safe(
  () => service.listVerifiedDefenceCandidates()
);