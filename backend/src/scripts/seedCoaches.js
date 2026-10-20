'use strict'

/**
 * Coach and berth seed — the tables that make "seat B1-24" mean something.
 *
 * Before this, the seat map invented its own inventory: `SeatSelection.jsx`
 * hardcoded four coaches of 64 seats and marked some occupied on the fly. That
 * worked for a picture and nothing else — there was no way to ask which berths
 * were free, because the database had never heard of any of them.
 *
 * ## Sizing
 *
 * Coaches are built to match each class's existing `total_seats`, distributed as
 * evenly as possible across a realistic number of coaches. That sum is exact, so
 * availability can be *derived* by counting inventory rows with a non-zero mask
 * rather than read off a static `available_seats` column that has never tracked
 * a booking (PAYMENTS.md §14).
 *
 * Berth layouts follow the real Indian Railways conventions — 80 in a 3AC coach,
 * 72 in 2AC, 30 in a sleeper — because the seat map draws a bay per row of three
 * and the numbers need to line up. This is demo data, not a survey of any
 * particular rake, but it is generated deterministically so every environment
 * gets identical seat codes.
 *
 * ## Idempotency
 *
 * Re-running replaces the coaches and seats of a train rather than duplicating
 * them. `ON DELETE CASCADE` takes the old seats — and any holds against them —
 * with it, which is why this is a seed script and not something to run against
 * a database with live bookings in it.
 *
 *   node src/scripts/seedCoaches.js          every train
 *   node src/scripts/seedCoaches.js 12002    one train
 */

require('dotenv').config()

const { close } = require('../config/database')
const { Coach, CoachSeat, sequelize } = require('../models')

/**
 * Berths per coach, and how they are laid out.
 *
 * `seats` is the target capacity. `berths` is the repeating tier pattern for the
 * main rows; `sides` berths are appended after them. Seat codes run 1..n in
 * layout order, so they are stable across runs.
 */
const COACH_SPECS = {
  AC_3_TIER: { seats: 80, berths: ['LOWER', 'MIDDLE', 'UPPER'], sides: 8 },
  AC_2_TIER: { seats: 72, berths: ['LOWER', 'UPPER'], sides: 8 },
  AC_FIRST: { seats: 24, berths: ['LOWER', 'UPPER', 'SIDE_LOWER', 'SIDE_UPPER'], sides: 0 },
  SLEEPER: { seats: 30, berths: ['SIDE_LOWER', 'LOWER', 'MIDDLE', 'UPPER', 'SIDE_UPPER'], sides: 0 },
  CHAIR_CAR: { seats: 90, berths: ['CHAIR'], sides: 0 },
  EXECUTIVE: { seats: 46, berths: ['CHAIR'], sides: 0 },
  GENERAL: { seats: 90, berths: ['SEAT'], sides: 0 },
}

/** Travel class code -> carriage layout. */
const CLASS_TO_COACH_TYPE = {
  '1A': 'AC_FIRST',
  '2A': 'AC_2_TIER',
  '3A': 'AC_3_TIER',
  SL: 'SLEEPER',
  CC: 'CHAIR_CAR',
  EC: 'EXECUTIVE',
  '2S': 'GENERAL',
}

/** Coach code prefix by layout, so B1..Bn are 3AC and S1..Sn are sleeper. */
const COACH_PREFIX = {
  AC_3_TIER: 'B',
  AC_2_TIER: 'A',
  AC_FIRST: 'H',
  SLEEPER: 'S',
  CHAIR_CAR: 'C',
  EXECUTIVE: 'E',
  GENERAL: 'G',
}

/**
 * The berth types for one coach, in seat order.
 *
 * Main rows cycle through `berths`; side berths follow. The ordering matters
 * because the seat map groups into rows, and the repeating tier is what gives a
 * coach its bay structure.
 */
function berthLayout(spec) {
  const out = [];
  const mainCount = spec.seats - spec.sides;

  for (let i = 0; i < mainCount; i += 1) out.push(spec.berths[i % spec.berths.length]);

  const lower = Math.floor(spec.sides / 2);
  for (let i = 0; i < lower; i += 1) out.push('SIDE_LOWER');
  for (let i = 0; i < spec.sides - lower; i += 1) out.push('SIDE_UPPER');

  return out;
}

/**
 * Split `totalSeats` across `count` coaches as evenly as possible.
 *
 * The sum is exact, so derived availability matches `total_seats` instead of
 * exceeding it by the remainder of a division.
 */
function distribute(totalSeats, count) {
  const base = Math.floor(totalSeats / count);
  const remainder = totalSeats % count;
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
}

/** Coaches needed for a class, and how many berths each carries. */
function coachPlan(totalSeats, classCode) {
  const type = CLASS_TO_COACH_TYPE[classCode] ?? 'GENERAL';
  const spec = COACH_SPECS[type];

  // One coach when the class is smaller than a full one — a 46-seat EC rake is
  // a single carriage, not two of 23.
  const count = totalSeats <= spec.seats ? 1 : Math.ceil(totalSeats / spec.seats);

  return { type, spec, count, sizes: distribute(totalSeats, count) };
}

/** Build one train's coaches and their seats. */
async function seedTrain(train) {
  const [trainClasses] = await sequelize.query(
    'SELECT class_code, total_seats FROM train_classes WHERE train_id = :id ORDER BY class_code',
    { replacements: { id: train.id } },
  );
  if (trainClasses.length === 0) return { coaches: 0, seats: 0 };

  const coachRows = [];
  const seatRows = [];

  for (const { class_code: classCode, total_seats: totalSeats } of trainClasses) {
    const { type, spec, sizes } = coachPlan(Number(totalSeats), classCode);
    const prefix = COACH_PREFIX[type] ?? 'G';

    sizes.forEach((size, index) => {
      coachRows.push({
        trainId: train.id,
        classCode,
        coachCode: `${prefix}${index + 1}`,
        // `type` is the layout this coach is built to, and it stays in the plan
        // because the berth layout and the code prefix both read it. It is not
        // written to the row: migration 011 moved `coach_type` to the `classes`
        // lookup, where it belongs -- a coach's carriage is a property of the
        // class it runs in, not of each of its carriages.
        position: index + 1,
      });

      // A short remainder coach takes the first `size` berths of the layout, so
      // seat code 7 is the same berth position in every coach.
      berthLayout(spec)
        .slice(0, size)
        .forEach((berthType, seatIndex) => {
          seatRows.push({
            // Placeholder, rewritten to the real id once the coaches exist.
            coachIndex: coachRows.length - 1,
            seatCode: String(seatIndex + 1),
            berthType,
            position: seatIndex + 1,
          });
        });
    });
  }

  // Remove first so a re-run is a no-op instead of a duplicate-key failure.
  // CASCADE takes the old seats, and any holds against them, with it.
  await Coach.destroy({ where: { trainId: train.id } });

  /**
   * One INSERT per coach rather than a bulkCreate.
   *
   * Sequelize's MySQL dialect does not reliably populate generated primary keys
   * from a multi-row INSERT, and the seats need those ids. There are a few dozen
   * coaches in total, so the extra round-trips are not worth optimising away —
   * and doing this explicitly means the seat rows can be bulk-created afterwards
   * with ids that are known to be right.
   */
  const created = [];
  for (const row of coachRows) {
    const coach = await Coach.create(row);
    created.push(coach);
  }

  await CoachSeat.bulkCreate(
    seatRows.map((row) => ({
      coachId: created[row.coachIndex].coachId,
      seatCode: row.seatCode,
      berthType: row.berthType,
      position: row.position,
    })),
    { validate: false, hooks: false },
  );

  return { coaches: coachRows.length, seats: seatRows.length };
}

/** Seed every train, or one named by number. */
async function seedCoaches(trainNumber) {
  const [trains] = trainNumber
    ? await sequelize.query('SELECT id, train_number FROM trains WHERE train_number = :n', {
        replacements: { n: String(trainNumber) },
      })
    : await sequelize.query('SELECT id, train_number FROM trains ORDER BY train_number');

  if (trains.length === 0) {
    console.log('No trains found — run the railway seed first.');
    return { trains: 0, coaches: 0, seats: 0 };
  }

  let totalCoaches = 0;
  let totalSeats = 0;

  for (const train of trains) {
    const result = await seedTrain(train);
    totalCoaches += result.coaches;
    totalSeats += result.seats;
    console.log(
      `  ${String(train.train_number).padEnd(7)} ${String(result.coaches).padStart(3)} coaches  ` +
        `${String(result.seats).padStart(5)} berths`,
    );
  }

  console.log(
    `\n${trains.length} trains · ${totalCoaches} coaches · ${totalSeats} berths per journey`,
  );

  return { trains: trains.length, coaches: totalCoaches, seats: totalSeats };
}

if (require.main === module) {
  seedCoaches(process.argv[2])
    .then(async () => {
      await close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('Coach seed failed:', err);
      await close();
      process.exit(1);
    });
}

module.exports = {
  seedCoaches,
  COACH_SPECS,
  CLASS_TO_COACH_TYPE,
  berthLayout,
  distribute,
  coachPlan,
};