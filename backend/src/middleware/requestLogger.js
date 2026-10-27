const pool = require('../config/db');
module.exports = (req,res,next) => {
  const started=Date.now();
  res.on('finish',()=>{
    if (!req.path.startsWith('/api/v1/admin')) return;
    pool.query(`INSERT INTO api_request_logs(method,path,status_code,duration_ms,user_id) VALUES(?,?,?,?,?)`,[req.method,req.originalUrl,res.statusCode,Date.now()-started,req.user?.id||null]).catch(()=>{});
  });
  next();
};
