let client = null;
let attempted = false;

async function getRedis() {
  if (attempted) return client;
  attempted = true;
  if (!process.env.REDIS_URL) return null;
  try {
    const { createClient } = require('redis');
    client = createClient({ url: process.env.REDIS_URL });
    client.on('error', (err) => console.error('Redis error:', err.message));
    await client.connect();
    return client;
  } catch (error) {
    console.warn('Redis unavailable; continuing without cache:', error.message);
    client = null;
    return null;
  }
}

async function get(key) { const r = await getRedis(); if (!r) return null; const value = await r.get(key); return value ? JSON.parse(value) : null; }
async function set(key, value, ttlSeconds=60) { const r = await getRedis(); if (!r) return false; await r.set(key, JSON.stringify(value), { EX: ttlSeconds }); return true; }
async function status() { const r = await getRedis(); return { configured: !!process.env.REDIS_URL, connected: !!r }; }

module.exports = { get, set, status };
