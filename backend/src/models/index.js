'use strict'

/**
 * Model registry — Team 5's slice of the schema.
 *
 * Importing this file registers the payment, seat and booking models on the
 * shared Sequelize instance and wires their associations. It connects to
 * nothing; the first query opens the pool.
 *
 *   const db = require('./models')
 *   const payment = await db.Payment.findOne({ where: { gatewayOrderId } })
 *
 * `models/User.js` is Team 1's and is still a placeholder, so nothing here
 * references a user — `bookings.user_id` is left unconstrained for that reason,
 * and a guest booking is a first-class case rather than a missing one.
 */

const { sequelize } = require('../config/database')

const Payment = require('./Payment')(sequelize)
const PaymentTransaction = require('./PaymentTransaction')(sequelize)
const Refund = require('./Refund')(sequelize)
const PaymentMethod = require('./PaymentMethod')(sequelize)
const Coach = require('./Coach')(sequelize)
const CoachSeat = require('./CoachSeat')(sequelize)
const SeatInventory = require('./SeatInventory')(sequelize)
const SeatHold = require('./SeatHold')(sequelize)
const Booking = require('./Booking')(sequelize)
const BookingPassenger = require('./BookingPassenger')(sequelize)
const BookingStatus = require('./BookingStatus')(sequelize)

/* --------------------------------------------------------------- associations */

// A payment is made of attempts, and can be reversed at most once in full.
Payment.hasMany(PaymentTransaction, {
  foreignKey: 'payment_id',
  as: 'transactions',
  onDelete: 'CASCADE',
})
PaymentTransaction.belongsTo(Payment, { foreignKey: 'payment_id', as: 'payment' })

Payment.hasMany(Refund, { foreignKey: 'payment_id', as: 'refunds', onDelete: 'CASCADE' })
Refund.belongsTo(Payment, { foreignKey: 'payment_id', as: 'payment' })

// method_code is a soft reference on purpose: a payment keeps the method it
// was actually taken with even if the method is later deactivated in the master.
// `targetKey` matters here — method_code holds an instrument code, not a row id.
Payment.belongsTo(PaymentMethod, {
  foreignKey: 'method_code',
  targetKey: 'code',
  as: 'method',
  constraints: false,
})

// A booking owns its manifest and its status history. Both cascade, which is the
// point: a booking deleted without its history is a booking whose audit trail has
// a hole in it.
Booking.hasMany(BookingPassenger, { foreignKey: 'booking_id', sourceKey: 'bookingId', as: 'passengers', onDelete: 'CASCADE' })
BookingPassenger.belongsTo(Booking, { foreignKey: 'booking_id', targetKey: 'bookingId', as: 'booking' })

Booking.hasMany(BookingStatus, { foreignKey: 'booking_id', sourceKey: 'bookingId', as: 'history', onDelete: 'CASCADE' })
BookingStatus.belongsTo(Booking, { foreignKey: 'booking_id', targetKey: 'bookingId', as: 'booking' })

// A payment and a seat hold both hang off the booking reference. Migration 010
// made that a real foreign key in both directions, so these are declared as real
// associations — no `constraints: false`, and no soft-reference workaround.
//
// The keys are the *attribute* names, not the column names: every model sets
// `underscored: true`, so `bookingRef` is the attribute Sequelize knows and
// `booking_ref` is only the column it maps to. Naming the column here throws
// "Unknown attribute ... passed as targetKey".
SeatHold.belongsTo(Booking, {
  foreignKey: 'bookingRef',
  targetKey: 'bookingRef',
  as: 'booking',
})
Booking.hasMany(SeatHold, {
  foreignKey: 'bookingRef',
  sourceKey: 'bookingRef',
  as: 'seatHolds',
})

Payment.belongsTo(Booking, {
  foreignKey: 'bookingRef',
  targetKey: 'bookingRef',
  as: 'booking',
})
Booking.hasMany(Payment, {
  foreignKey: 'bookingRef',
  sourceKey: 'bookingRef',
  as: 'payments',
})

// The seat side, which is properly keyed — unlike booking_ref, these are real
// foreign keys the migration created.
Coach.hasMany(CoachSeat, { foreignKey: 'coach_id', sourceKey: 'coachId', as: 'seats' });
CoachSeat.belongsTo(Coach, { foreignKey: 'coach_id', targetKey: 'coachId', as: 'coach' });

CoachSeat.hasMany(SeatInventory, { foreignKey: 'seat_id', sourceKey: 'seatId', as: 'inventory' });
SeatInventory.belongsTo(CoachSeat, { foreignKey: 'seat_id', targetKey: 'seatId', as: 'seat' });

CoachSeat.hasMany(SeatHold, { foreignKey: 'seat_id', sourceKey: 'seatId', as: 'holds' });
SeatHold.belongsTo(CoachSeat, { foreignKey: 'seat_id', targetKey: 'seatId', as: 'seat' });

// Train / train_class associations are declared with raw queries in the railway
// service rather than here: `trains` and `train_classes` are Team 2's tables and
// have no Sequelize models, so there is nothing to hang a `belongsTo` off
// without inventing models this team does not own.

module.exports = {
  sequelize,
  Sequelize: require('sequelize').Sequelize,
  Payment,
  PaymentTransaction,
  Refund,
  PaymentMethod,
  Coach,
  CoachSeat,
  SeatInventory,
  SeatHold,
  Booking,
  BookingPassenger,
  BookingStatus,
}