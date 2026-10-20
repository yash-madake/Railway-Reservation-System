'use strict'

const nodemailer = require('nodemailer')

/**
 * Outgoing email (Nodemailer over SMTP).
 *
 * Configured from backend/.env:
 *   SMTP_HOST   e.g. smtp.gmail.com
 *   SMTP_PORT   465 (SSL) or 587 (STARTTLS)
 *   SMTP_USER   the sending address
 *   SMTP_PASS   for Gmail, a 16-character App Password, not the login password
 *   MAIL_FROM   optional, e.g.  "Yatrio" <youraddress@gmail.com>
 *
 * If SMTP is not configured, the code is printed to the server console instead
 * of being emailed, so the project still runs on a machine with no mail set up.
 * That fallback is switched off when NODE_ENV=production.
 */

const isPlaceholder = (v) => !v || /XXXX|your_|placeholder|example\.com/i.test(v)

function isConfigured() {
  return (
    !isPlaceholder(process.env.SMTP_HOST) &&
    !isPlaceholder(process.env.SMTP_USER) &&
    !isPlaceholder(process.env.SMTP_PASS)
  )
}

let transporter = null

function getTransporter() {
  if (transporter) return transporter

  const port = Number(process.env.SMTP_PORT ?? 465)

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    // Fail in seconds, not minutes, so a mail problem never leaves the
    // register request hanging.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  })

  return transporter
}

const escapeHtml = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

function buildHtml({ name, otp, ttlMinutes }) {
  const spaced = otp.split('').join('&nbsp;')

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellspacing="0" cellpadding="0"
                 style="max-width:480px;background:#ffffff;border-radius:14px;overflow:hidden;">
            <tr>
              <td style="background:#0a2a66;padding:22px 28px;color:#ffffff;font-size:22px;font-weight:bold;">
                Yatrio
              </td>
            </tr>
            <tr>
              <td style="padding:28px;color:#0f172a;font-size:15px;line-height:1.6;">
                <p style="margin:0 0 12px;">Hi ${escapeHtml(name)},</p>
                <p style="margin:0 0 18px;">
                  Use this code to verify your email address and finish creating your Yatrio account:
                </p>
                <div style="text-align:center;margin:0 0 18px;">
                  <span style="display:inline-block;background:#eff6ff;color:#0a2a66;font-size:32px;
                               font-weight:bold;letter-spacing:6px;padding:14px 22px;border-radius:10px;">
                    ${spaced}
                  </span>
                </div>
                <p style="margin:0 0 8px;">
                  This code expires in <strong>${ttlMinutes} minutes</strong>.
                </p>
                <p style="margin:0;color:#64748b;font-size:13px;">
                  Didn't create a Yatrio account? You can safely ignore this email.
                  Never share this code with anyone.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

function buildText({ name, otp, ttlMinutes }) {
  return (
    `Hi ${name},\n\n` +
    `Your Yatrio verification code is: ${otp}\n\n` +
    `It expires in ${ttlMinutes} minutes. If you did not create a Yatrio account, ignore this email.\n` +
    `Never share this code with anyone.\n`
  )
}

/**
 * Send the verification code. Rejects if the mail server refuses or is
 * unreachable, so the caller can tell the user instead of pretending it worked.
 */
async function sendOtpEmail({ to, name, otp, ttlMinutes }) {
  if (!isConfigured()) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SMTP is not configured')
    }

    console.warn(
      '\n  [Yatrio] SMTP is not configured, so no email was sent.\n' +
        `    Verification code for ${to}: ${otp}\n` +
        '    Add SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS to backend/.env to send real emails.\n',
    )
    return { delivered: false }
  }

  await getTransporter().sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject: 'Your Yatrio verification code',
    text: buildText({ name, otp, ttlMinutes }),
    html: buildHtml({ name, otp, ttlMinutes }),
  })

  return { delivered: true }
}

module.exports = { sendOtpEmail, isConfigured }