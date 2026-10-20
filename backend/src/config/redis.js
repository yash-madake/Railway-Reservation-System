'use strict'

const Redis = require('ioredis')
const env = require('./env')

/**
 * Redis — the optional cache and rate-limit store (Team 7).
 *
 * Redis is optional by design. When it is unreachable the API degrades rather
 * than failing: cache reads miss and fall through to MySQL, and the rate
 * limiter counts in memory. See ../../REDIS_DOCUMENTATION.md.
 *
 * Degrading fast is the whole job here. The default ioredis behaviour is to
 * park commands issued while disconnected in an *offline queue* and replay them
 * once a connection lands. With the reconnect backoff below, that turns every
 * cache read into a multi-second wait before it finally rejects — so requests
 * did not fail, they just took 7-12s. `enableOfflineQueue: false` rejects them
 * immediately instead, which is what "degrades rather than failing" has to mean
 * if it is to be worth anything.
 *
 * Reconnecting is still attempted in the background, so a Redis that comes back
 * is picked up without a restart.
 */

const redisConfig = {
  host: env.redis.host,
  port: env.redis.port,
  password: env.redis.password,
  db: env.redis.db,

  /**
   * Reject commands immediately while disconnected instead of queueing them
   * behind the reconnect backoff. This is what keeps a Redis outage from
   * turning every cached route into a slow request.
   */
  enableOfflineQueue: false,

  /** One attempt, then reject — paired with the setting above for a fast miss. */
  maxRetriesPerRequest: 1,

  /**
   * Keep trying, with a capped backoff, so Redis coming back needs no restart.
   * Note this retries the *connection* only; it never re-runs the commands
   * enableOfflineQueue dropped, which is the correct trade for a cache.
   */
  retryStrategy(times) {
    return Math.min(times * 50, 2000)
  },
}

/**
 * Stand-in used when REDIS_ENABLED=false. Keeps the same surface as the real
 * client so callers — including rate-limit-redis, which is handed `redis.call`
 * at require time — do not have to branch on whether Redis is in play.
 */
function disabledClient() {
  return {
    status: 'disabled',
    on() {
      return this
    },
    call() {
      return Promise.reject(new Error('Redis is disabled (REDIS_ENABLED=false)'))
    },
    get() {
      return Promise.resolve(null)
    },
    set() {
      return Promise.resolve('OK')
    },
    del() {
      return Promise.resolve(0)
    },
    flushdb() {
      return Promise.resolve('OK')
    },
    dbsize() {
      return Promise.resolve(0)
    },
    ping() {
      return Promise.reject(new Error('Redis is disabled (REDIS_ENABLED=false)'))
    },
    quit() {
      return Promise.resolve('OK')
    },
    disconnect() {},
  }
}

const redis = env.redis.enabled ? new Redis(redisConfig) : disabledClient()

let reportedFailure = false

if (env.redis.enabled) {
  redis.on('ready', () => {
    // Only worth saying when it recovers, otherwise a server that has never
    // had Redis repeats this line on every boot for no information.
    if (reportedFailure) {
      console.log('✅ Redis reconnected — cache and shared rate limits are live.');
    } else {
      console.log('✅ Redis connected successfully.');
    }
    reportedFailure = false
  })

  redis.on('error', (err) => {
    // Redis being down is not per-request news and must not scroll the log.
    // Say it once, then stay quiet until it comes back.
    if (reportedFailure) return
    reportedFailure = true
    console.warn(
      `\n  [Yatrio] Redis is unreachable at ${env.redis.host}:${env.redis.port} (${err.message}).\n` +
        '    Continuing without it: cache reads fall through to MySQL and the\n' +
        '    rate limiter counts in memory, so requests stay fast and correct.\n' +
        '    Reconnecting in the background — it will be picked up automatically.\n' +
        '    To silence this entirely, set REDIS_ENABLED=false in backend/.env.\n',
    )
  })
}

/**
 * Health check function for Redis
 * @returns {Promise<boolean>}
 */
const checkRedisHealth = async () => {
  try {
    await redis.ping()
    return true
  } catch {
    return false
  }
}

module.exports = {
  redis,
  checkRedisHealth,
  isRedisEnabled: () => env.redis.enabled,
}