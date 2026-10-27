const pool = require('../config/db');

async function recordAudit({ actorUserId, action, module, recordId, status='SUCCESS', ipAddress, details }) {
  await pool.query(
    `INSERT INTO audit_logs (actor_user_id, action, module, record_id, status, ip_address, details)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [actorUserId || null, action, module, recordId || null, status, ipAddress || null, details ? JSON.stringify(details) : null]
  );
}

module.exports = { recordAudit };
