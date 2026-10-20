/**
 * Redis-backed Cache Service for shared infrastructure (Team 7)
 * Made backward-compatible with the original interface for Team 2
 *
 * Redis is optional, so every method resolves rather than rejects: a miss
 * returns null and a write becomes a no-op, letting callers fall through to
 * MySQL exactly as the docs describe. Failures are reported once rather than
 * per call — a full stack trace for each of the two cache operations on every
 * request buried the actual server log.
 */
const { redis } = require('../../config/redis');

class CacheService {
  constructor(defaultTtlSeconds = 300) {
    this.defaultTtl = parseInt(process.env.CACHE_TTL_SECONDS, 10) || defaultTtlSeconds;
  }

  /**
   * Report a Redis failure at most once. The cache is an optimisation, so a
   * repeated miss is not news — config/redis.js already says Redis is down
   * once with the details.
   */
  reportOnce(kind, err) {
    if (this.reported) return;
    this.reported = true;
    console.warn(`[Yatrio] Cache ${kind} unavailable, serving uncached: ${err.message}`);
  }

  async get(key) {
    if (redis.status !== 'ready') return null;
    try {
      const data = await redis.get(key);
      if (!data) return null;
      return JSON.parse(data);
    } catch (err) {
      this.reportOnce('get', err);
      return null;
    }
  }

  async set(key, value, ttlSeconds) {
    if (redis.status !== 'ready') return;
    try {
      const ttl = ttlSeconds ? ttlSeconds : this.defaultTtl;
      const data = JSON.stringify(value);
      await redis.set(key, data, 'EX', ttl);
    } catch (err) {
      this.reportOnce('set', err);
    }
  }

  async del(key) {
    if (redis.status !== 'ready') return;
    try {
      await redis.del(key);
    } catch (err) {
      this.reportOnce('del', err);
    }
  }

  async flush() {
    if (redis.status !== 'ready') return;
    try {
      await redis.flushdb();
    } catch (err) {
      this.reportOnce('flush', err);
    }
  }

  async size() {
    if (redis.status !== 'ready') return 0;
    try {
      return await redis.dbsize();
    } catch (err) {
      this.reportOnce('size', err);
      return 0;
    }
  }
}

module.exports = new CacheService();