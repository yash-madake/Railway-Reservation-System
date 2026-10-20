'use strict'

const express = require('express')
const ctrl = require('../controllers/bookingController')
const { asyncHandler } = require('../utils/errors')

const router = express.Router()

/**
 * Bookings — the durable record, and the seat holds that go with it.
 *
 *   POST   /confirm                    record a booking, hold its berths
 *   GET    /                           list, filtered and paginated
 *   GET    /:bookingRef                one booking, with its status history
 *   POST   /:bookingRef/cancel         withdraw it and give the berths back
 *   POST   /expire                     age out unpaid bookings (scheduler)
 *
 * No ordering hazard between `/expire` and `/:bookingRef`: the only POST under a
 * parameter is `/:bookingRef/cancel`, which is two segments long and so cannot
 * be shadowed by a one-segment `/expire`.
 *
 * ## Auth
 *
 * These are mounted without auth. `listBookings` scopes to the caller when the
 * request is authenticated and falls back to "everything" when it is not, and
 * `assertOwnership` lets an unowned (guest) booking through for the same reason
 * — the flow does not insist on an account.
 *
 * That combination is fine for the demo and wrong for production: an
 * unauthenticated `GET /bookings` returns every booking in the table, and
 * `GET /bookings/:ref` will disclose any reference that is guessed or leaked.
 * Putting these behind auth is the remaining work, not a detail — the scoping
 * logic is already in place for it.
 */
router.post('/confirm', asyncHandler(ctrl.confirmBooking))
router.get('/', asyncHandler(ctrl.listBookings))
router.post('/expire', asyncHandler(ctrl.expireBookings))
router.get('/:bookingRef', asyncHandler(ctrl.getBooking))
router.post('/:bookingRef/cancel', asyncHandler(ctrl.cancelBooking))

module.exports = router