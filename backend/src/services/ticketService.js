'use strict'

/**
 * E-ticket email — sent once a booking has been paid for and confirmed.
 *
 * Called from the payment controller right after a payment is captured and the
 * booking moves to CONFIRMED. It builds a branded HTML ticket plus a PDF copy
 * and mails both to the booking's `contact_email`.
 *
 * ## It never throws
 *
 * The traveller has already paid and holds a valid ticket by the time this runs.
 * A mail outage, a missing address or a PDF problem must not turn that into an
 * error, so every failure is logged and swallowed, and `sendTicketForBooking`
 * resolves with a result object instead.
 *
 *   - no pdfkit installed     -> the email goes out without the PDF attached
 *   - no contact email        -> nothing is sent, logged
 *   - SMTP down / rejected    -> logged, booking unaffected
 */

const { QueryTypes } = require('sequelize')

const { sequelize } = require('../config/database')
const bookingStore = require('./booking/bookingService')
const mailService = require('./mailService')

const CLASS_NAMES = {
  '1A': 'First AC',
  '2A': 'AC 2-Tier',
  '3A': 'AC 3-Tier',
  SL: 'Sleeper',
  CC: 'AC Chair Car',
  EC: 'Executive Chair Car',
  '2S': 'Second Sitting',
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

// ---------------------------------------------------------------- formatting

const escapeHtml = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

/** Paise -> "1,29,620.00" style rupees, with Indian digit grouping. */
function rupees(paise) {
  if (paise === null || paise === undefined || Number.isNaN(Number(paise))) return null
  const total = Math.round(Number(paise))
  const whole = String(Math.floor(total / 100))
  const fraction = String(total % 100).padStart(2, '0')

  let grouped = whole
  if (whole.length > 3) {
    const lastThree = whole.slice(-3)
    const rest = whole.slice(0, -3)
    grouped = `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${lastThree}`
  }
  return `${grouped}.${fraction}`
}

/**
 * "Sat, 24 Oct 2026" from either a plain 'YYYY-MM-DD' string (taken as written,
 * so no timezone can move it a day) or a Date (read in Indian time).
 */
function formatDate(value) {
  if (!value) return null

  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const [y, m, d] = value.slice(0, 10).split('-').map(Number)
    const day = new Date(Date.UTC(y, m - 1, d))
    return `${WEEKDAYS[day.getUTCDay()]}, ${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`
  }

  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const ist = new Date(date.getTime() + IST_OFFSET_MS)
  return `${WEEKDAYS[ist.getUTCDay()]}, ${String(ist.getUTCDate()).padStart(2, '0')} ${MONTHS[ist.getUTCMonth()]} ${ist.getUTCFullYear()}`
}

/** "24 Oct 2026, 14:35 IST" */
function formatDateTime(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const ist = new Date(date.getTime() + IST_OFFSET_MS)
  const hh = String(ist.getUTCHours()).padStart(2, '0')
  const mm = String(ist.getUTCMinutes()).padStart(2, '0')
  return `${String(ist.getUTCDate()).padStart(2, '0')} ${MONTHS[ist.getUTCMonth()]} ${ist.getUTCFullYear()}, ${hh}:${mm} IST`
}

const titleCase = (s) => {
  const v = String(s ?? '').trim()
  return v ? v.charAt(0).toUpperCase() + v.slice(1).toLowerCase() : ''
}

// ---------------------------------------------------------------- data

/**
 * The journey date.
 *
 * `bookings.departure_at` is not filled in by the booking flow, so the date the
 * traveller picked lives on the seat hold. The column name is not assumed: the
 * row is read whole and the date column found by name, preferring the usual
 * spellings. Returns null when nothing is found, and the ticket then simply
 * leaves the date line out rather than printing a wrong one.
 */
async function findJourneyDate(bookingRef) {
  try {
    const rows = await sequelize.query('SELECT * FROM seat_holds WHERE booking_ref = :ref LIMIT 1', {
      replacements: { ref: bookingRef },
      type: QueryTypes.SELECT,
    })
    const row = rows[0]
    if (!row) return null

    const preferred = [
      'departure_date',
      'travel_date',
      'journey_date',
      'run_date',
      'trip_date',
      'service_date',
      'departure_on',
      'travel_on',
    ]
    const key =
      preferred.find((k) => k in row && row[k]) ??
      Object.keys(row).find((k) => /date/i.test(k) && !/(creat|updat|expir|hold|confirm|cancel)/i.test(k) && row[k])

    return key ? row[key] : null
  } catch (err) {
    console.warn(`[tickets] could not read the journey date for ${bookingRef}: ${err.message}`)
    return null
  }
}

/** Everything the ticket shows, flattened. */
function toTicket(booking, { journeyDate, payment }) {
  const classCode = booking.train?.class ?? ''
  const passengers = (booking.passengers ?? []).map((p) => ({
    name: p.name ?? '',
    age: p.age ?? null,
    gender: titleCase(p.gender),
    coach: p.coach ?? null,
    seat: p.seatNumber ?? null,
    berth: p.berthType ?? null,
  }))

  return {
    ref: booking.bookingRef,
    status: booking.status,
    trainNumber: booking.train?.number ?? '',
    trainName: booking.train?.name ?? '',
    classCode,
    className: CLASS_NAMES[String(classCode).toUpperCase()] ?? classCode,
    from: { code: booking.route?.from ?? '', name: booking.route?.fromName ?? '' },
    to: { code: booking.route?.to ?? '', name: booking.route?.toName ?? '' },
    distanceKm: booking.segment?.distanceKm ?? null,
    journeyDate: formatDate(journeyDate),
    passengers,
    amount: booking.fare?.amount ?? null,
    paymentId: payment?.paymentId ?? null,
    orderId: payment?.orderId ?? null,
    method: payment?.method ?? null,
    bookedAt: formatDateTime(booking.confirmedAt ?? booking.createdAt),
    email: booking.contact?.email ?? null,
    phone: booking.contact?.phone ?? null,
  }
}

const METHOD_NAMES = { upi: 'UPI', card: 'Card', netbanking: 'Net banking', wallet: 'Wallet', emi: 'EMI', paylater: 'Pay later' }
const methodLabel = (m) => (m ? METHOD_NAMES[String(m).toLowerCase()] ?? titleCase(m) : '')

const seatLabel = (p) => (p.coach && p.seat ? `${p.coach} / ${p.seat}` : '—')
const personLabel = (p) => [p.age != null ? `${p.age} yrs` : null, p.gender || null].filter(Boolean).join(', ')

// ---------------------------------------------------------------- email body

function buildTicketHtml(t) {
  const lead = t.passengers[0]?.name || 'traveller'
  const amount = rupees(t.amount)

  const passengerRows = t.passengers
    .map(
      (p, i) => `
              <tr>
                <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#64748b;">${i + 1}</td>
                <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-weight:bold;">${escapeHtml(p.name)}
                  <div style="font-weight:normal;color:#64748b;font-size:12px;">${escapeHtml(personLabel(p))}</div></td>
                <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">${escapeHtml(seatLabel(p))}</td>
                <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">${escapeHtml(p.berth ?? '—')}</td>
              </tr>`,
    )
    .join('')

  const detail = (label, value) =>
    value
      ? `
              <tr>
                <td style="padding:6px 0;color:#64748b;font-size:13px;">${label}</td>
                <td style="padding:6px 0;text-align:right;font-size:13px;font-weight:bold;">${escapeHtml(value)}</td>
              </tr>`
      : ''

  const distance = t.distanceKm ? `${t.distanceKm} km` : ''

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
      Booking ${escapeHtml(t.ref)} confirmed: ${escapeHtml(t.from.code)} to ${escapeHtml(t.to.code)}${t.journeyDate ? `, ${escapeHtml(t.journeyDate)}` : ''}.
    </div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellspacing="0" cellpadding="0"
                 style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;">

            <tr>
              <td style="background:#0a2a66;padding:22px 28px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    <td style="color:#ffffff;font-size:22px;font-weight:bold;">Yatrio</td>
                    <td align="right" style="color:#93c5fd;font-size:12px;font-weight:bold;letter-spacing:2px;">E-TICKET</td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="background:#ecfdf5;padding:12px 28px;color:#047857;font-size:14px;font-weight:bold;">
                &#10003;&nbsp; Booking confirmed
              </td>
            </tr>

            <tr>
              <td style="padding:26px 28px 8px;font-size:15px;line-height:1.6;">
                <p style="margin:0 0 10px;">Hi ${escapeHtml(lead)},</p>
                <p style="margin:0;">
                  Your payment was received and your seats are confirmed. Your ticket is below${t.hasPdf ? ', and a PDF copy is attached' : ''}.
                </p>
              </td>
            </tr>

            <tr>
              <td style="padding:12px 28px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
                       style="background:#eff6ff;border:1px dashed #93c5fd;border-radius:10px;">
                  <tr>
                    <td style="padding:14px 18px;">
                      <div style="font-size:11px;letter-spacing:2px;color:#64748b;font-weight:bold;">BOOKING REFERENCE</div>
                      <div style="font-size:26px;font-weight:bold;color:#0a2a66;letter-spacing:1px;font-family:'Courier New',monospace;">${escapeHtml(t.ref)}</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:8px 28px 0;">
                <div style="font-size:17px;font-weight:bold;">${escapeHtml(t.trainName)} <span style="color:#64748b;font-weight:normal;">#${escapeHtml(t.trainNumber)}</span></div>
                <div style="font-size:13px;color:#64748b;margin-top:2px;">${escapeHtml(t.className)}${t.classCode && t.className !== t.classCode ? ` (${escapeHtml(t.classCode)})` : ''}</div>
              </td>
            </tr>

            <tr>
              <td style="padding:16px 28px 4px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    <td width="38%" valign="top">
                      <div style="font-size:28px;font-weight:bold;color:#0a2a66;">${escapeHtml(t.from.code)}</div>
                      <div style="font-size:13px;color:#475569;">${escapeHtml(t.from.name)}</div>
                    </td>
                    <td width="24%" align="center" valign="middle" style="color:#94a3b8;font-size:12px;">
                      <div style="font-size:20px;color:#0a2a66;">&rarr;</div>
                      ${escapeHtml(distance)}
                    </td>
                    <td width="38%" valign="top" align="right">
                      <div style="font-size:28px;font-weight:bold;color:#0a2a66;">${escapeHtml(t.to.code)}</div>
                      <div style="font-size:13px;color:#475569;">${escapeHtml(t.to.name)}</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            ${
              t.journeyDate
                ? `<tr>
              <td style="padding:10px 28px 4px;">
                <div style="background:#f8fafc;border-radius:8px;padding:10px 14px;font-size:14px;">
                  <span style="color:#64748b;">Journey date</span>&nbsp;&nbsp;<strong>${escapeHtml(t.journeyDate)}</strong>
                </div>
              </td>
            </tr>`
                : ''
            }

            <tr>
              <td style="padding:18px 28px 4px;">
                <div style="font-size:12px;letter-spacing:2px;color:#64748b;font-weight:bold;margin-bottom:8px;">PASSENGERS</div>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
                       style="font-size:14px;border:1px solid #e2e8f0;border-radius:8px;border-collapse:separate;border-spacing:0;">
                  <tr style="background:#f8fafc;">
                    <td style="padding:9px 12px;font-size:11px;color:#64748b;font-weight:bold;">#</td>
                    <td style="padding:9px 12px;font-size:11px;color:#64748b;font-weight:bold;">PASSENGER</td>
                    <td style="padding:9px 12px;font-size:11px;color:#64748b;font-weight:bold;">COACH / SEAT</td>
                    <td style="padding:9px 12px;font-size:11px;color:#64748b;font-weight:bold;">BERTH</td>
                  </tr>${passengerRows}
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:18px 28px 6px;">
                <div style="font-size:12px;letter-spacing:2px;color:#64748b;font-weight:bold;margin-bottom:6px;">PAYMENT</div>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  ${amount ? detail('Amount paid', `₹${amount}`) : ''}
                  ${detail('Payment ID', t.paymentId)}
                  ${detail('Payment method', methodLabel(t.method))}
                  ${detail('Booked on', t.bookedAt)}
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:16px 28px 26px;color:#64748b;font-size:12px;line-height:1.7;">
                Please carry a valid photo ID during your journey. Show this email or the attached PDF with your booking reference.
                <br><br>
                This is an automated message from Yatrio. Please do not reply to this email.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

function buildTicketText(t) {
  const lines = [
    'YATRIO E-TICKET',
    'Booking confirmed',
    '',
    `Booking reference: ${t.ref}`,
    `Train: ${t.trainName} (#${t.trainNumber})`,
    `Class: ${t.className}`,
    `Journey: ${t.from.name} (${t.from.code}) to ${t.to.name} (${t.to.code})${t.distanceKm ? `, ${t.distanceKm} km` : ''}`,
  ]
  if (t.journeyDate) lines.push(`Journey date: ${t.journeyDate}`)

  lines.push('', 'Passengers:')
  t.passengers.forEach((p, i) => {
    lines.push(`  ${i + 1}. ${p.name} (${personLabel(p)}), coach/seat ${seatLabel(p)}, ${p.berth ?? ''}`.trimEnd())
  })

  const amount = rupees(t.amount)
  lines.push('')
  if (amount) lines.push(`Amount paid: Rs. ${amount}`)
  if (t.paymentId) lines.push(`Payment ID: ${t.paymentId}`)
  if (t.bookedAt) lines.push(`Booked on: ${t.bookedAt}`)
  lines.push('', 'Please carry a valid photo ID during your journey.', 'This is an automated message from Yatrio.')

  return lines.join('\n')
}

// ---------------------------------------------------------------- PDF

/** Standard PDF fonts only cover Latin text; anything else would print as junk. */
const pdfSafe = (s) => String(s ?? '').replace(/[^\x20-\x7E -ÿ]/g, '?')

/**
 * The same ticket as an A4 PDF.
 *
 * `pdfkit` is loaded here, not at the top of the file, so a machine that has not
 * run `npm install pdfkit` yet still starts the server and still sends the email
 * (without the attachment).
 */
function buildTicketPdf(t) {
  const PDFDocument = require('pdfkit')

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `Yatrio e-ticket ${t.ref}`, Author: 'Yatrio' } })
    const chunks = []
    doc.on('data', (c) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const NAVY = '#0a2a66'
    const MUTED = '#64748b'
    const INK = '#0f172a'
    const LINE = '#e2e8f0'
    const LEFT = 40
    const WIDTH = 515 // 595 - 2 * 40

    const text = (s, x, y, opts = {}) => doc.text(pdfSafe(s), x, y, { lineBreak: false, ...opts })

    // Header band
    doc.rect(0, 0, 595, 78).fill(NAVY)
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(26)
    text('Yatrio', LEFT, 24)
    doc.fillColor('#93c5fd').fontSize(11)
    text('E-TICKET', LEFT, 33, { width: WIDTH, align: 'right', characterSpacing: 2 })

    // Status
    doc.rect(0, 78, 595, 30).fill('#ecfdf5')
    doc.fillColor('#047857').font('Helvetica-Bold').fontSize(12)
    text('BOOKING CONFIRMED', LEFT, 88, { characterSpacing: 1 })

    // Reference
    let y = 130
    doc.roundedRect(LEFT, y, WIDTH, 62, 8).lineWidth(1).dash(4, { space: 3 }).fillAndStroke('#eff6ff', '#93c5fd')
    doc.undash()
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(9)
    text('BOOKING REFERENCE', LEFT + 16, y + 12, { characterSpacing: 2 })
    doc.fillColor(NAVY).font('Courier-Bold').fontSize(26)
    text(t.ref, LEFT + 16, y + 28)

    // Train
    y = 212
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(16)
    text(`${t.trainName}  #${t.trainNumber}`, LEFT, y)
    doc.fillColor(MUTED).font('Helvetica').fontSize(11)
    text(`${t.className}${t.classCode && t.className !== t.classCode ? ` (${t.classCode})` : ''}`, LEFT, y + 22)

    // Journey
    y = 262
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(32)
    text(t.from.code, LEFT, y)
    text(t.to.code, LEFT, y, { width: WIDTH, align: 'right' })
    doc.fillColor('#475569').font('Helvetica').fontSize(11)
    text(t.from.name, LEFT, y + 40, { width: 220 })
    text(t.to.name, LEFT + WIDTH - 220, y + 40, { width: 220, align: 'right' })

    doc.moveTo(LEFT + 150, y + 18).lineTo(LEFT + WIDTH - 150, y + 18).lineWidth(1.2).strokeColor('#93c5fd').stroke()
    if (t.distanceKm) {
      doc.fillColor(MUTED).fontSize(10)
      text(`${t.distanceKm} km`, LEFT, y + 24, { width: WIDTH, align: 'center' })
    }

    y += 72
    if (t.journeyDate) {
      doc.roundedRect(LEFT, y, WIDTH, 32, 6).fill('#f8fafc')
      doc.fillColor(MUTED).font('Helvetica').fontSize(11)
      text('Journey date', LEFT + 14, y + 10)
      doc.fillColor(INK).font('Helvetica-Bold')
      text(t.journeyDate, LEFT + 100, y + 10)
      y += 46
    } else {
      y += 8
    }

    // Passengers
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(9)
    text('PASSENGERS', LEFT, y, { characterSpacing: 2 })
    y += 18

    const cols = [
      { label: '#', x: LEFT + 10 },
      { label: 'PASSENGER', x: LEFT + 40 },
      { label: 'COACH / SEAT', x: LEFT + 300 },
      { label: 'BERTH', x: LEFT + 410 },
    ]
    doc.rect(LEFT, y, WIDTH, 24).fill('#f8fafc')
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8.5)
    cols.forEach((c) => text(c.label, c.x, y + 8, { characterSpacing: 1 }))
    y += 24

    t.passengers.forEach((p, i) => {
      doc.fillColor(MUTED).font('Helvetica').fontSize(11)
      text(String(i + 1), cols[0].x, y + 9)
      doc.fillColor(INK).font('Helvetica-Bold')
      text(p.name, cols[1].x, y + 6, { width: 250 })
      doc.fillColor(MUTED).font('Helvetica').fontSize(9)
      text(personLabel(p), cols[1].x, y + 22, { width: 250 })
      doc.fillColor(INK).font('Helvetica').fontSize(11)
      text(seatLabel(p), cols[2].x, y + 9)
      text(p.berth ?? '-', cols[3].x, y + 9, { width: 100 })
      doc.moveTo(LEFT, y + 38).lineTo(LEFT + WIDTH, y + 38).lineWidth(0.6).strokeColor(LINE).stroke()
      y += 38
    })

    // Payment
    y += 22
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(9)
    text('PAYMENT', LEFT, y, { characterSpacing: 2 })
    y += 18

    const amount = rupees(t.amount)
    const rows = [
      amount ? ['Amount paid', `Rs. ${amount}`] : null,
      t.paymentId ? ['Payment ID', t.paymentId] : null,
      t.method ? ['Payment method', methodLabel(t.method)] : null,
      t.bookedAt ? ['Booked on', t.bookedAt] : null,
    ].filter(Boolean)

    rows.forEach(([label, value]) => {
      doc.fillColor(MUTED).font('Helvetica').fontSize(11)
      text(label, LEFT, y)
      doc.fillColor(INK).font('Helvetica-Bold')
      text(value, LEFT, y, { width: WIDTH, align: 'right' })
      y += 22
    })

    // Footer
    y += 18
    doc.moveTo(LEFT, y).lineTo(LEFT + WIDTH, y).lineWidth(0.6).dash(3, { space: 3 }).strokeColor('#cbd5e1').stroke()
    doc.undash()
    y += 14
    doc.fillColor(MUTED).font('Helvetica').fontSize(9.5)
    doc.text(
      pdfSafe(
        'Please carry a valid photo ID during your journey and show this ticket with your booking reference. ' +
          'This is a computer-generated ticket from Yatrio and does not need a signature.',
      ),
      LEFT,
      y,
      { width: WIDTH, lineGap: 3 },
    )

    doc.end()
  })
}

// ---------------------------------------------------------------- entry point

/**
 * Email the e-ticket for a confirmed booking.
 *
 * @param {string} bookingRef
 * @param {{paymentId?: string, orderId?: string, method?: string}} [payment]
 * @returns {Promise<{sent: boolean, reason?: string}>} never rejects
 */
async function sendTicketForBooking(bookingRef, payment = {}) {
  try {
    const booking = await bookingStore.getBookingByRef(bookingRef)
    if (!booking) {
      console.warn(`[tickets] ${bookingRef}: booking not found, no ticket sent.`)
      return { sent: false, reason: 'BOOKING_NOT_FOUND' }
    }

    const to = booking.contact?.email
    if (!to) {
      console.warn(`[tickets] ${bookingRef}: no contact email on the booking, no ticket sent.`)
      return { sent: false, reason: 'NO_EMAIL' }
    }

    const journeyDate = booking.departureAt ?? (await findJourneyDate(bookingRef))
    const ticket = toTicket(booking, { journeyDate, payment })

    let pdf = null
    try {
      pdf = await buildTicketPdf(ticket)
    } catch (err) {
      console.warn(`[tickets] ${bookingRef}: PDF not attached (${err.message}).`)
    }
    ticket.hasPdf = Boolean(pdf)

    const result = await mailService.sendTicketEmail({
      to,
      subject: `Your Yatrio ticket ${ticket.ref}: ${ticket.from.code} to ${ticket.to.code}`,
      text: buildTicketText(ticket),
      html: buildTicketHtml(ticket),
      attachments: pdf
        ? [{ filename: `Yatrio-Ticket-${ticket.ref}.pdf`, content: pdf, contentType: 'application/pdf' }]
        : [],
    })

    if (result.delivered) {
      console.log(`[tickets] ${bookingRef}: ticket emailed to ${to}.`)
    }
    return { sent: Boolean(result.delivered), reason: result.delivered ? undefined : 'SMTP_NOT_CONFIGURED' }
  } catch (err) {
    console.error(`[tickets] ${bookingRef}: could not email the ticket: ${err.message}`)
    return { sent: false, reason: 'ERROR' }
  }
}

module.exports = { sendTicketForBooking, buildTicketHtml, buildTicketText, buildTicketPdf, toTicket, rupees, formatDate }
