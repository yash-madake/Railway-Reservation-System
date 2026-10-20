const rateLimit = require('express-rate-limit');
const { MemoryStore } = require('express-rate-limit');
const RedisStore = require('rate-limit-redis').default;
const { redis } = require('../config/redis');
const env = require('../config/env');

/**
 * Counters in Redis, degrading to per-process memory when Redis is unusable.
 *
 * ## The bug this fixes
 *
 * The previous version caught every Redis failure with a bare `catch` and fell
 * through to `memoryStore`. That looked safe and was not: it degraded *silently*.
 * Observed in this codebase, the Redis command failed on **every single call**
 * ("Stream isn't writeable and enableOfflineQueue options is false"), so the
 * limiter ran entirely on per-process memory while `redis.status` reported
 * `ready` and nothing appeared in Redis.
 *
 * The consequences were invisible and matter:
 *   - counters reset on every restart, so a restart is a free quota reset;
 *   - counters were not shared between instances, so N instances meant N times
 *     the configured limit;
 *   - a genuine Redis outage looked identical to healthy operation.
 *
 * So the fallback stays — a Redis outage must not take the API down with it —
 * but it now retries once, and it *says* when it is degrading, at most once per
 * prefix, instead of failing quietly forever.
 */
class FallbackRedisStore {
  constructor(prefix) {
    this.prefix = prefix;
    this.localKeys = false; // The real Redis store is distributed
    this.redisStore = new RedisStore({
      sendCommand: (...args) => redis.call(...args),
      prefix,
    });
    this.memoryStore = new MemoryStore();
    this.degradedLogged = false;
  }

  init(options) {
    if (this.memoryStore.init) {
      this.memoryStore.init(options);
    }
    if (this.redisStore.init) {
      try {
        const p = this.redisStore.init(options);
        if (p && typeof p.catch === 'function') {
          p.catch(() => {});
        }
      } catch (err) {
        // ignore init errors when redis is down
      }
    }
  }

  /**
   * Run against Redis, falling back to memory only if it genuinely cannot.
   *
   * `method` is a name rather than a closure so the memory fallback can call the
   * matching method on `memoryStore` without the caller having to pass both.
   *
   * The retry matters for the transient case: ioredis is configured with
   * `enableOfflineQueue: false` so a command issued while the socket is settling
   * is rejected outright rather than queued, which is right for request latency
   * and wrong for a counter that is worth keeping.
   */
  async viaRedis(method, args) {
    if (redis.status !== 'ready') {
      this.reportDegraded('Redis is not ready');
      return this.memoryStore[method](...args);
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.redisStore[method](...args);
      } catch (err) {
        if (attempt === 1) {
          this.reportDegraded(err.message);
          return this.memoryStore[method](...args);
        }
        // One tick for the socket to settle before the retry.
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    /* unreachable */
  }

  /**
   * Announce a degraded limiter, once.
   *
   * A limiter that has quietly stopped being shared is worse than one that is
   * obviously broken, because the owner believes a limit is in force.
   */
  reportDegraded(reason) {
    if (this.degradedLogged) return;
    this.degradedLogged = true;
    console.warn(
      `[Yatrio] Rate-limit store "${this.prefix}" is running on per-process memory: ${reason}. ` +
        'Limits will reset on restart and are not shared between instances.',
    );
  }

  async increment(...args) {
    return this.viaRedis('increment', args);
  }

  async decrement(...args) {
    return this.viaRedis('decrement', args);
  }

  async resetKey(...args) {
    return this.viaRedis('resetKey', args);
  }
}

/**
 * A no-op limiter.
 *
 * Keeps the same call signature as the real one, so `app.use('/', apiLimiter)`
 * stays untouched whether limiting is on or off — the switch lives in one place
 * and nothing downstream has to know about it.
 */
const passthrough = () => (req, res, next) => next();

const build = (opts) => (env.rateLimit.enabled ? rateLimit(opts) : passthrough());

// Shared Redis-backed rate limiting middleware for API requests (with in-memory fallback)
const apiLimiter = build({
  windowMs: env.rateLimit.apiWindowMs,
  max: env.rateLimit.apiMax,
  standardHeaders: true,
  legacyHeaders: false,
  requestPropertyName: 'apiRateLimit',
  // Paths that must never count against the ceiling.
  //
  // `/health` is polled by load balancers on a timer; counting it means the
  // health check itself is what eventually trips the limit for everyone behind
  // the same address. The root banner is a static page and costs nothing to
  // serve.
  skip: (req) => req.path === '/health' || req.path === '/',
  message: {
    message: 'Too many requests from this IP, please try again shortly',
  },
  store: new FallbackRedisStore('rl:api:'),
});

// Stricter rate limiter for authentication routes
const authLimiter = build({
  windowMs: env.rateLimit.authWindowMs,
  max: env.rateLimit.authMax,
  standardHeaders: true,
  legacyHeaders: false,
  requestPropertyName: 'authRateLimit',
  message: {
    message: 'Too many authentication attempts, please try again later',
  },
  store: new FallbackRedisStore('rl:auth:'),
});

/**
 * Delete every stored limiter counter.
 *
 * Counters are in Redis, so they outlive a restart and outlive disabling the
 * limiter. Without this, switching limiting off does not unblock anyone who has
 * already exhausted their window — the request is refused before the limiter's
 * enabled flag is even consulted, because a proxy in front of the app may still
 * be serving the 429 from its own cache, or the client may have cached it.
 *
 * Best-effort: a Redis outage means there is nothing to clear and nothing to
 * report, so failures are logged and swallowed.
 */
async function flushRateLimitKeys() {
  if (redis.status !== 'ready') {
    console.warn('[Yatrio] Rate-limit flush skipped: Redis is not ready.');
    return 0;
  }

  let removed = 0;
  try {
    let cursor = '0';
    do {
      const [next, keys] = await redis.call('SCAN', cursor, 'MATCH', 'rl:*', 'COUNT', 200);
      cursor = next;
      if (keys.length > 0) {
        await redis.call('DEL', ...keys);
        removed += keys.length;
      }
    } while (cursor !== '0');
  } catch (err) {
    console.warn('[Yatrio] Rate-limit flush failed:', err.message);
    return removed;
  }

  console.log(`[Yatrio] Rate-limit flush complete — removed ${removed} counter(s).`);
  return removed;
}

module.exports = {
  apiLimiter,
  authLimiter,
  flushRateLimitKeys,
  rateLimitEnabled: env.rateLimit.enabled,
};
