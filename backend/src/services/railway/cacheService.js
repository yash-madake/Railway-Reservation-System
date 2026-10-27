/**
 * Simple in-memory TTL cache for Team 2 Railway service
 */
class CacheService {
  constructor(defaultTtlSeconds = 300) {
    this.cache = new Map();
    this.defaultTtl = (parseInt(process.env.CACHE_TTL_SECONDS, 10) || defaultTtlSeconds) * 1000;
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;

    if (Date.now() > item.expiry) {
      this.cache.delete(key);
      return null;
    }

    return item.value;
  }

  set(key, value, ttlSeconds) {
    const ttl = ttlSeconds ? ttlSeconds * 1000 : this.defaultTtl;
    this.cache.set(key, {
      value,
      expiry: Date.now() + ttl,
    });
  }

  del(key) {
    this.cache.delete(key);
  }

  flush() {
    this.cache.clear();
  }

  size() {
    return this.cache.size;
  }
}

module.exports = new CacheService();
