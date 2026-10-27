const jwt = require('jsonwebtoken');

function authenticateJWT(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: { code: 'AUTH_REQUIRED', message: 'Authentication is required.' } });
  }
  const token = header.slice(7).trim();
  if (!token) return res.status(401).json({ success: false, error: { code: 'AUTH_REQUIRED', message: 'Authentication is required.' } });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ success: false, error: { code: 'AUTH_INVALID', message: 'Your session is invalid or expired.' } });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ success: false, error: { code: 'ADMIN_REQUIRED', message: 'Administrator access is required.' } });
  }
  next();
}

module.exports = { authenticateJWT, requireAdmin };
