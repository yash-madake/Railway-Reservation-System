const buckets = new Map();
const WINDOW_MS = 60_000;
const LIMIT = 120;

module.exports = (req,res,next) => {
  const key = req.ip || 'unknown'; const now=Date.now(); const current=buckets.get(key);
  if(!current || now-current.start>=WINDOW_MS){ buckets.set(key,{start:now,count:1}); return next(); }
  current.count += 1;
  if(current.count>LIMIT) return res.status(429).json({success:false,error:{code:'RATE_LIMITED',message:'Too many requests. Please try again shortly.'}});
  next();
};
