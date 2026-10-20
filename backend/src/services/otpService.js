'use strict'

const crypto = require('crypto')
const pool = require('../config/db')
const mailService = require('./mailService')

/**
 * Email OTP — generate, store, send, verify.
 *
 * Codes live in MySQL (table `email_otps`), not Redis. Redis in this project is
 * optional and its disabled stand-in answers every GET with null, which would
 * make every code "wrong". A verification code has to survive a Redis outage.
 *
 * Only a keyed hash (HMAC-SHA256) of the code is stored. A 6-digit code is too
 * small to protect with a plain hash, so the key (OTP_SECRET, falling back to
 * JWT_SECRET) is what keeps a copy of the table from being reversible.
 *
 * All time comparisons use MySQL's own NOW(), so the app server's clock and
 * time zone can never disagree with the stored timestamps.
 */

const TTL_MINUTES = Number(process.env.OTP_TTL_MINUTES ?? 10)
const MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS ?? 5)
const COOLDOWN_SECONDS = Number(process.env.OTP_RESEND_COOLDOWN_SECONDS ?? 60)
const MAX_SENDS_PER_HOUR = Number(process.env.OTP_MAX_SENDS_PER_HOUR ?? 5)
const HOUR_SECONDS = 60 * 60

function secret() {
  const s = process.env.OTP_SECRET || process.env.JWT_SECRET
  if (!s) {
    throw new Error('OTP_SECRET or JWT_SECRET must be set to issue verification codes')
  }
  return s
}

function generateOtp() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
}

function hashOtp(userId, otp) {
  return crypto.createHmac('sha256', secret()).update(`${userId}:${otp}`).digest('hex')
}

function hashesMatch(a, b) {
  const x = Buffer.from(a, 'hex')
  const y = Buffer.from(b, 'hex')
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

async function deleteOtp(userId) {
  await pool.query('DELETE FROM email_otps WHERE user_id = ?', [userId])
}

/**
 * Can a new code be sent to this user right now?
 * @returns {Promise<{allowed: true} | {allowed: false, reason: string, retryAfterSeconds: number}>}
 */
async function checkSendAllowed(userId) {
  const [rows] = await pool.query(
    `SELECT resend_count,
            TIMESTAMPDIFF(SECOND, last_sent_at, NOW())          AS since_last_sent,
            TIMESTAMPDIFF(SECOND, resend_window_start, NOW())   AS since_window
       FROM email_otps
      WHERE user_id = ?
      LIMIT 1`,
    [userId],
  )

  if (!rows.length) return { allowed: true }

  const row = rows[0]
  const sinceLast = Number(row.since_last_sent)
  const sinceWindow = Number(row.since_window)

  if (sinceLast < COOLDOWN_SECONDS) {
    return {
      allowed: false,
      reason: 'RESEND_COOLDOWN',
      retryAfterSeconds: COOLDOWN_SECONDS - sinceLast,
    }
  }

  if (sinceWindow < HOUR_SECONDS && Number(row.resend_count) >= MAX_SENDS_PER_HOUR) {
    return {
      allowed: false,
      reason: 'RESEND_LIMIT',
      retryAfterSeconds: HOUR_SECONDS - sinceWindow,
    }
  }

  return { allowed: true }
}

/**
 * Create a fresh code for the user (replacing any previous one), store its
 * hash, and email it. If the email cannot be sent, the stored code is removed
 * so the user can try again straight away, and the error is re-thrown.
 */
async function issueAndSendOtp({ userId, email, name }) {
  const otp = generateOtp()
  const hash = hashOtp(userId, otp)

  // One row per user. A second send replaces the code and resets the attempt
  // counter, and keeps a running count of sends inside the current hour.
  await pool.query(
    `INSERT INTO email_otps
        (user_id, otp_hash, expires_at, attempts, last_sent_at, resend_count, resend_window_start)
     VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), 0, NOW(), 1, NOW())
     ON DUPLICATE KEY UPDATE
        otp_hash            = VALUES(otp_hash),
        expires_at          = VALUES(expires_at),
        attempts            = 0,
        last_sent_at        = NOW(),
        resend_count        = IF(TIMESTAMPDIFF(SECOND, resend_window_start, NOW()) >= ${HOUR_SECONDS}, 1, resend_count + 1),
        resend_window_start = IF(TIMESTAMPDIFF(SECOND, resend_window_start, NOW()) >= ${HOUR_SECONDS}, NOW(), resend_window_start)`,
    [userId, hash, TTL_MINUTES],
  )

  try {
    return await mailService.sendOtpEmail({
      to: email,
      name,
      otp,
      ttlMinutes: TTL_MINUTES,
    })
  } catch (err) {
    await deleteOtp(userId).catch(() => {})
    throw err
  }
}

/**
 * Check a submitted code.
 * @returns {Promise<{ok: true} | {ok: false, reason: 'NO_OTP'|'EXPIRED'|'LOCKED'|'MISMATCH', attemptsLeft?: number}>}
 */
async function verifyOtp(userId, code) {
  const [rows] = await pool.query(
    `SELECT otp_hash, attempts, (expires_at <= NOW()) AS is_expired
       FROM email_otps
      WHERE user_id = ?
      LIMIT 1`,
    [userId],
  )

  if (!rows.length) return { ok: false, reason: 'NO_OTP' }

  const row = rows[0]

  if (Number(row.is_expired) === 1) {
    await deleteOtp(userId)
    return { ok: false, reason: 'EXPIRED' }
  }

  if (Number(row.attempts) >= MAX_ATTEMPTS) {
    return { ok: false, reason: 'LOCKED' }
  }

  // Spend the attempt first, in the same statement that checks the limit, so
  // two requests racing each other cannot both slip under it.
  const [spent] = await pool.query(
    'UPDATE email_otps SET attempts = attempts + 1 WHERE user_id = ? AND attempts < ?',
    [userId, MAX_ATTEMPTS],
  )

  if (!Number(spent.affectedRows)) return { ok: false, reason: 'LOCKED' }

  if (!hashesMatch(hashOtp(userId, code), row.otp_hash)) {
    return {
      ok: false,
      reason: 'MISMATCH',
      attemptsLeft: Math.max(0, MAX_ATTEMPTS - (Number(row.attempts) + 1)),
    }
  }

  await deleteOtp(userId)
  return { ok: true }
}

module.exports = {
  checkSendAllowed,
  issueAndSendOtp,
  verifyOtp,
  deleteOtp,
  TTL_MINUTES,
  COOLDOWN_SECONDS,
  MAX_ATTEMPTS,
}