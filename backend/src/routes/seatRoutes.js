'use strict'

/**
 * Seat routes — availability for the seat map.
 *
 * Read-only. Holds are created as a side effect of confirming a booking, not by
 * a separate "hold this seat" call, because a seat the client is only *thinking
 * about* should not be taken off sale. The one moment a hold is created is the
 * moment the traveller commits by asking for a booking.
 *
 * No auth, matching the rest of the search and train routes: which berths are
 * free is public information, the same as which trains run.
 */

const express = require('express')
const ctrl = require('../controllers/seatController')
const { asyncHandler } = require('../utils/errors')

const router = express.Router()

//   GET /availability?trainNo=12951&class=3A&date=2026-10-15
router.get('/availability', asyncHandler(ctrl.getAvailability))

module.exports = router