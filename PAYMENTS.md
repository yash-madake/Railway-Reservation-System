# Yatrio — Team 5 · Payment & Transactions

Razorpay test-mode payment lifecycle. Payment is a **stage inside the booking
flow**, not a standalone page: Team 4 owns the booking, Team 5 owns paying for
it, and a settled payment hands back to the booking record.

| | |
|---|---|
| Scope | Payment stage: summary → checkout → processing → result, plus history |
| Design system | [`brandkit.md`](../brandkit.md) — every colour, type step and component |
| Security notes | [`SECURITY.md`](SECURITY.md) — read before touching the env files |
| Tests | `backend/tests/payment.test.js` — 10 cases, offline · `backend/tests/db.test.js` — 21 cases, needs MySQL |
| Database | Shared MySQL 8.4 on Aiven, schema `defaultdb` — Team 5's four tables within it. See §12 and [`backend/database/README.md`](backend/database/README.md) |

---

## 1. Environment variable checklist

| Variable | File | Public? | Required | Notes |
|---|---|---|---|---|
| `VITE_API_URL` | `Frontend/.env` | yes | yes | API **origin only**, no path prefix: `http://localhost:5000`. There is no dev proxy, so this one value works in dev and in production |
| `VITE_USE_MOCK_DATA` | `Frontend/.env` | yes | no | `true` (default) — the services serve bundled demo data; their live branch is not implemented yet |
| `VITE_RAZORPAY_KEY_ID` | `Frontend/.env` | **yes — by design** | live | Razorpay's Checkout modal requires it in the browser. Not read yet: the payment frontend has not been merged |
| `PORT` | `backend/.env` | no | no | default `5000` |
| `RAZORPAY_KEY_ID` | `backend/.env` | no | **yes** | must be the **same key pair** as the frontend's, or checkout fails |
| `RAZORPAY_KEY_SECRET` | `backend/.env` | **never** | **yes** | HMAC verification only. Never in any `VITE_` variable |
| `CLIENT_ORIGIN` | `backend/.env` | no | no | comma-separated CORS allowlist |
| `MAX_PAYMENT_ATTEMPTS` | `backend/.env` | no | no | default `4`, matching Razorpay's guidance |
| `ORDER_TTL_MINUTES` | `backend/.env` | no | no | default `5`, mirrored by the review step's countdown |
| `SEAT_HOLD_TTL_MINUTES` | `backend/.env` | no | no | default: `ORDER_TTL_MINUTES`. How long a seat stays held while its booking pays. Must not be **below** the order window — §12.9 |
| `SEAT_SWEEP_INTERVAL_MS` | `backend/.env` | no | no | default `15000`. How often dead hold rows are collected. Correctness does not depend on it |
| `PAYMENT_LOG_FORMAT` | `backend/.env` | no | no | `pretty` (boxed) or `json` (one line per event) |

> **The one rule that matters:** only `VITE_RAZORPAY_KEY_ID` may appear in
> `Frontend/.env`. Vite inlines every `VITE_` variable into the bundle, so a
> secret there is public. See [`SECURITY.md`](SECURITY.md).

Check for a leak after any build:

```bash
cd Frontend && npm run build
grep -r "RAZORPAY_KEY_SECRET\|YOUR_KEY_SECRET" dist/ && echo "LEAK" || echo "clean"
```

---

## 2. Sequence

Payment is Team 5's stage inside Team 4's booking flow.

```mermaid
sequenceDiagram
    autonumber
    actor T as Traveller
    participant FE as Frontend<br/>/booking/:id/payment
    participant BE as Backend<br/>/payments
    participant B as bookingService<br/>(Team 4)
    participant F as fareService
    participant S as paymentStore
    participant R as Razorpay

    T->>FE: Proceed to Pay
    FE->>BE: POST /create-order { bookingRef, extras }
    Note over FE,BE: NO amount is sent — the client is not trusted

    BE->>B: resolveBooking(bookingRef)
    alt unknown booking
        B-->>BE: 404 NOT_FOUND
        BE-->>FE: 404
    end

    BE->>F: calculateFare(booking, extras)
    F-->>BE: amount + breakdown (server price list)
    BE->>R: orders.create({ amount, receipt, notes })
    R-->>BE: order_id
    BE->>S: create()  → logs ORDER_CREATED
    BE-->>FE: 201 { orderId, amount, keyId }

    FE->>R: Checkout.js open(order_id)<br/>config: UPI, Cards, Netbanking, Wallet<br/>(UPI first, zero PG charge)
    T->>R: pays with a test method
    alt payment succeeds
        R-->>FE: handler { payment_id, order_id, signature }
        FE->>FE: navigate /processing (attempt persisted to sessionStorage)
        FE->>BE: POST /verify { orderId, paymentId, orderId, signature }
        BE->>BE: HMAC(orderId WE stored, paymentId) vs signature
        alt signature invalid
            BE->>S: update(SIGNATURE_MISMATCH)  → logs PAYMENT_FAILED
            BE-->>FE: 409 SIGNATURE_MISMATCH
            FE->>T: /failure
        else signature valid
            BE->>R: payments.fetch(paymentId)
            R-->>BE: captured
            BE->>S: update(captured)  → logs PAYMENT_VERIFIED
            BE-->>FE: captured
            FE->>T: /success → hand-off to booking
        end
    else payment fails
        R-->>FE: payment.failed
        FE->>T: /failure → retry
    else pending
        R-->>FE: handler (authorised, not settled)
        FE->>FE: /pending, polls GET /status/:orderId
        BE->>R: payments.fetch on each poll
    end

    opt duplicate callback
        FE->>BE: POST /verify again
        BE-->>FE: duplicate:true — no rewrite, no double credit
    end

    opt refund
        T->>FE: Refund payment
        FE->>BE: POST /refund { orderId }
        BE->>R: payments.refund(paymentId)
        BE->>S: markRefunded()  → logs PAYMENT_REFUNDED
        BE-->>FE: refunded  (terminal)
    end
```

---

## 3. Checkout payment methods

Yatrio does **not** render its own payment-method picker. The single
"Proceed to Pay" button opens Razorpay Checkout, and Razorpay owns method
selection. This keeps one source of truth for what is actually payable and
avoids offering a method the account cannot accept.

Which methods appear, and in what order, is set at runtime in
`lib/razorpay.js`:

```js
config: {
  display: {
    blocks: {
      yatrio: {
        name: 'Pay with',
        instruments: [
          { method: 'upi' },        // first — no PG charge, default for Indian rail
          { method: 'card' },
          { method: 'netbanking' },
          { method: 'wallet' },
        ],
      },
    },
    sequence: ['block.yatrio'],
    preferences: { show_default_blocks: false },
    language: 'en',                // also: ben, hi, mar, guj, tam, tel
  },
},
```

`show_default_blocks: false` makes this block authoritative, so the offered set
is exactly the list above rather than whatever the account happens to have on.

Instruments the account has not activated are dropped by Razorpay — see the UPI
note in §8.

---

## 4. API contract

Base URL: `/payments`. All amounts are **paise** — Razorpay's smallest
currency unit. Errors share one envelope.

### `POST /payments/create-order`

Mints a Razorpay order for a booking. **No amount in the body** — the server
resolves the booking and computes the fare.

**Request**
```json
{ "bookingRef": "YTR-12951-7QX2",
  "extras": { "insurance": false, "coupon": null } }
```

**Response `201`**
```json
{ "orderId": "order_TjT0SnCSZwaznu",
  "paymentId": null,
  "bookingRef": "YTR-12951-7QX2",
  "amount": 61860,
  "currency": "INR",
  "status": "created",
  "attempts": 1,
  "trainNo": "12951", "trainName": "Rajdhani",
  "fromStation": "NDLS", "toStation": "MTJ",
  "createdAt": "2026-10-03T14:22:47.812Z",
  "keyId": "rzp_test_TjR0GqymFoscLi",
  "fare": { "amount": 61860, "currency": "INR",
            "breakdown": [{ "key": "base", "label": "Base fare (3A)", "amount": 54000 }] } }
```

| Status | Code | When |
|---|---|---|
| `400` | `BAD_REQUEST` | `amount` supplied — **tampered amount**; or an invalid coupon |
| `404` | `NOT_FOUND` | unknown `bookingRef` |
| `409` | `ALREADY_PAID` | booking already captured |
| `409` | `MAX_ATTEMPTS` | more than `MAX_PAYMENT_ATTEMPTS` attempts |
| `200` | — | a live order was reused (`reused: true`) |

### `POST /payments/verify`

Server-side HMAC verification, then confirmation against Razorpay. Idempotent.

**Request**
```json
{ "orderId": "order_TjT0SnCSZwaznu",
  "razorpayPaymentId": "pay_XXXXXXXXXXXXXXXX",
  "razorpayOrderId": "order_TjT0SnCSZwaznu",
  "razorpaySignature": "<from the Checkout handler>" }
```

**Response `200`** — the payment record. A replayed verification adds
`"duplicate": true` and writes nothing.

| Status | Code | When |
|---|---|---|
| `400` | `BAD_REQUEST` | missing fields |
| `404` | `NOT_FOUND` | unknown order |
| `409` | `SIGNATURE_MISMATCH` | **tampered/forged signature — reject, never fulfil** |
| `409` | `ORDER_MISMATCH` | payment id belongs to a different order |
| `409` | `ORDER_EXPIRED` | past `ORDER_TTL_MINUTES` |
| `409` | `HOLDS_EXPIRED` | payment captured, but the seat hold lapsed first — **no ticket is issued**, refund the payment (§12.9) |
| `409` | `REFUNDED` | already refunded |
| `502` | `GATEWAY_ERROR` | Razorpay unreachable |

### `GET /payments/status/:orderId`

Poll target for the pending screen. Reconciles with Razorpay and expires stale
orders.

**Response `200`** — the payment record. `404` when unknown.

### `POST /payments/refund`

Terminal. Refunds a captured payment at Razorpay.

**Request** — `{ "orderId": "order_..." }` or `{ "paymentId": "pay_...", "amount": 61860 }`
Omit `amount` for a full refund.

**Response `200`** — the record with `status: "refunded"`, `refundId`,
`refundedAmount`.

| Status | Code | When |
|---|---|---|
| `400` | `BAD_REQUEST` | neither id supplied, or amount invalid/over the capture |
| `404` | `NOT_FOUND` | unknown order or payment id |
| `409` | `NOT_CAPTURED` | the payment is not `captured` |
| `409` | `ALREADY_REFUNDED` | **second refund — refused** |

### `GET /payments/history`

`?status=all|captured|pending|failed|refunded&page=1&pageSize=10`

```json
{ "items": [ /* payment records, newest first */ ],
  "total": 3, "page": 1, "pageSize": 10, "totalPages": 1 }
```

### `POST /bookings/confirm`

Team 4's stand-in, and the only endpoint that creates a seat hold. Everything
about it is in §12.9; the shape is:

```jsonc
// request
{ "train":  { "number": "12951", "class": "3A" },
  "route":  { "from": "NDLS", "to": "MMCT" },
  "passengers": [ { "name": "Arjun Mehta", "age": 34, "gender": "male" } ],
  "contact": { "email": "…" },
  "departureDate": "2026-10-15",              // part of a seat's identity
  "seats": [ { "coach": "B1", "number": "24", "type": "Lower" } ] }

// 201
{ "bookingRef": "YTR-12951-48EF",
  "train": { "number": "12951", "class": "3A", "coach": "B1", "seat": "24" },
  "seats": [ { "coach": "B1", "seatNumber": "24", "berthType": "Lower", "status": "held" } ],
  "holdExpiresAt": "2026-10-17T12:06:54.380Z", // MySQL's clock — count down to this
  "fare": { "amount": 61860, "currency": "INR", "breakdown": [ … ] } }
```

`409 SEATS_UNAVAILABLE` names the seats that were taken. `400 BAD_REQUEST` for a
duplicate seat in the request, a malformed `departureDate`, or more than six
seats.

### `GET /seats/availability`

`?trainNo=12951&class=3A&date=2026-10-15`

```json
{ "seats": [ { "coach": "B1", "seatNumber": "24", "berthType": "Lower",
               "status": "held", "expiresAt": "2026-10-17T12:06:54.380Z" } ],
  "summary": { "held": 1, "confirmed": 0, "nextReleaseAt": "2026-10-17T12:06:54.380Z" },
  "holdTtlMinutes": 5 }
```

Read-only. Claims nothing — a seat the traveller is only *looking* at must not
be taken off sale. `status` is `held` (someone is paying for it, frees at
`expiresAt`) or `confirmed` (sold). A lapsed hold is absent from `seats`
entirely, whether or not the sweeper has run.

### Error envelope

```json
{ "error": { "code": "SIGNATURE_MISMATCH",
             "message": "Payment signature verification failed. The payment was rejected.",
             "field": null, "details": null } }
```

`message` is safe to show a user. Internal detail never is — a 500 returns
*"An unexpected error occurred on the Yatrio server."*

---

## 5. Status model

Order lifecycle from Razorpay, mirrored onto our record:

| Status | Meaning | Terminal | Where the traveller lands |
|---|---|---|---|
| `created` | order minted, Checkout not opened | no | `/payment` |
| `attempted` | payment in flight | no | `/processing` |
| `authorized` | bank approved, not settled | no | `/pending` |
| `captured` | money moved | **yes** | `/success` |
| `failed` | declined or expired | **yes** | `/failure` |
| `refunded` | reversed | **yes** | `/success` (refunded) |

```mermaid
stateDiagram-v2
    [*] --> created : POST /create-order
    created --> attempted : Checkout.js opens
    attempted --> authorized : bank approves, not settled
    attempted --> captured : signature verifies + gateway confirms
    attempted --> failed : declined, or signature invalid
    authorized --> captured : gateway settles
    authorized --> failed : expires past ORDER_TTL_MINUTES
    created --> failed : expires past ORDER_TTL_MINUTES
    captured --> refunded : POST /refund

    failed --> [*]
    refunded --> [*]
    captured --> [*] : terminal for booking purposes

    note right of captured
        A captured payment is final.
        Only refund may follow, and only
        once — see ALREADY_REFUNDED.
    end note

    note right of failed
        A retry mints a NEW order rather
        than reopening this one, capped at
        MAX_PAYMENT_ATTEMPTS.
    end note
```

The two guards on this graph are not only in the controller:

- `trg_payments_status_guard` refuses any UPDATE that moves a payment out of a
  terminal state, except `captured → refunded`.
- `confirm_payment()` never captures on a signature that did not verify — it
  records `SIGNATURE_MISMATCH` and fails the payment instead.

So the "a captured payment is final" rule holds even for a writer that is not
the payment service.

---

## 6. Frontend routes

Payment is addressed by booking reference, so a reload keeps the traveller on
the right booking and an unknown id is refused rather than half-rendered.

| Route | Stage |
|---|---|
| `/booking/passengers` | Team 4 stand-in — pick travellers |
| `/booking/contact` | Team 4 stand-in — mobile and email |
| `/booking/:bookingId/payment` | **the payment stage** |
| `/booking/:bookingId/payment/processing` | verify + poll |
| `/booking/:bookingId/payment/success` | settled → hand-off |
| `/booking/:bookingId/payment/failure` | decline → retry |
| `/booking/:bookingId/payment/pending` | polling, auto-routes on resolution |
| `/transactions` | history |

Known booking references in the demo: `YTR-12951-7QX2` (1 pax, 3A),
`YTR-12951-7QX3` (2 pax, 2A).

---

## 7. Console logging

The API still reads from the in-memory store, so a restart clears history —
`services/paymentStore.js` is a deliberate seam. What now sits behind that seam
is a real schema (§12): the models, migrations and procedures that write the
same records to MySQL.

```
──────────────────────────────────────────────────────────
[YATRIO PAYMENT] PAYMENT_VERIFIED
  order     order_TjT0SnCSZwaznu
  payment   pay_XXXXXXXXXXXXXXXX
  booking   YTR-12951-7QX2
  amount    ₹618.60
  method    upi
  attempts  1
  status    captured
  time      2026-10-03T14:23:10.004Z
──────────────────────────────────────────────────────────
```

Events: `ORDER_CREATED`, `ORDER_EXPIRED`, `PAYMENT_VERIFIED`, `PAYMENT_FAILED`,
`PAYMENT_REFUNDED`. The same five are the `event` column of
`payment_transactions`, so the console and the database tell the same story.

Set `PAYMENT_LOG_FORMAT=json` for one line per event, ready to pipe to a file.

> History clears when the backend restarts. That is the store, not the schema:
> §12's tables are the destination once the API reads through them.

---

## 8. Testing

```bash
cd Backend && node tests/payment.test.js
```

Runs offline — Razorpay is stubbed, so no network or keys needed.

| # | Case | Assertion |
|---|---|---|
| 1 | success | valid signature → `captured` |
| 2 | failure | bad signature → rejected, never captured |
| 3 | duplicate verification | replay is idempotent, no rewrite, no double credit |
| 4 | tampered amount | client price refused; server figure used |
| 5 | expired order | past TTL → `ORDER_EXPIRED`, verification refused |
| 6 | retry | new order id, attempts incremented, cap enforced |
| 7 | refund | captured refunds once, then terminal |
| 8 | history | reflects the flow, filters by status |
| 9 | unknown booking | `404` |
| 10 | coupon | applied server-side; invalid coupon refused |

### Razorpay test cards

Test mode shows a mock bank page with **Success** / **Failure** buttons — error
cards only fail if you tap *Failure*.

| Goal | Input |
|---|---|
| Success | Visa `4100 2800 0000 1007` — any CVV, any future expiry |
| Success (UPI) | Use the mock UPI page, **not** a typed VPA — see below |
| Declined | Visa `4100 2800 0006 0003` → tap **Failure** |
| Timed out | Visa `4100 2800 0009 0000` → tap **Failure** |
| Bad card number | Visa `4100 2800 0001 0008` |
| Gateway error | Visa `4100 2800 0002 0007` |
| Auth failed | Visa `4100 2800 0000 0009` |
| OTP step-up | success card + a 4–10 digit OTP; **fewer than 4 fails** |
| Failure (UPI) | use the mock UPI page's failure option |

Also: RuPay `6527 6589 0000 1005`, Diners `3608 280009 1007`, Amex `3402 560004 01007`.

### UPI needs activating on the account

UPI does **not** appear in Checkout until it is activated for the merchant
account. This is an account-side setting, not something the integration can
switch on — Razorpay filters out any instrument the account has not enabled,
and the Dashboard's Payment Methods tab is available in **Live mode only**.

The Checkout already requests UPI (see §2), so it appears as soon as the
account has it.

1. Log in to the Razorpay Dashboard.
2. **Settings → Payment Methods**.
3. Find **UPI** and request/enable it, including the apps you want
   (Google Pay, BHIM, PhonePe).
4. Confirm the order of methods matches the block configured in
   `lib/razorpay.js` — UPI, Cards, Netbanking, Wallet.

Until then the block still renders Cards, Netbanking and Wallet, so the flow
never breaks; UPI just is not offered.

### UPI Collect is deprecated

NPCI is deprecating the **UPI Collect** flow (the traveller typing a VPA by
hand) effective **28 February 2026**. Web integrations must use **UPI Intent**
or a **UPI QR code** instead.

This matters for testing: the commonly cited `success@razorpay` / `failure@razorpay`
test UPI IDs belong to the Collect flow and may not behave as they used to on
web. Use the mock UPI page that Razorpay serves after choosing UPI, and pick
success or failure there. Confirm the current behaviour against Razorpay's
migration notes before relying on any UPI test ID.

---

## 9. Postman

`backend/Yatrio-Payment.postman_collection.json`

Run in order: Create Order → the negative cases → Verify → Status → History →
Refund → Health. `orderId` and `paymentId` are captured automatically.
`Create Order — tampered amount` and `Verify — bad signature` assert the
failures, so the suite fails loudly if a guard is removed.

---

## 10. Team 4 integration guide

Team 4 owns `bookings`, `booking_passengers`, `booking_segments`,
`seat_allocations`, `booking_status`. Team 5 owns payment only.

### What Team 5 needs from Team 4

1. **A booking identified by `bookingRef`** in the form `YTR-12951-7QX2`.
2. **A booking lookup endpoint.** Until it exists, `services/bookingService.js`
   serves two seeded bookings from memory. Replace `resolveBooking()` with a
   call to the real service — nothing else in the payment flow changes.
3. **Fare authority.** `services/fareService.js` holds the price list. When
   Team 4's fare engine lands, call it instead. **The amount must stay
   server-side**; never accept one from the browser.
4. **Passenger count and class**, which drive the fare.

### The boundary

```
Team 4                              Team 5
────────                            ──────
booking confirmed ──bookingRef──►   create-order
                                    (resolves booking, computes fare)
payment captured ─────────────────► hand-off: issue the ticket
refunded ──────────────────────────► release the reservation
```

### Rules for both teams

- **Booking state changes only through a service boundary.** Team 5 never writes
  a booking table; it returns a result and Team 4 acts on it.
- **Reservation timeout must exceed `ORDER_TTL_MINUTES`.** A seat held for less
  than the payment window would let a booking expire after the traveller paid.
  Default is 5 minutes; Team 4 should hold seats for longer than that.
- **A captured payment is final.** Team 4 must not treat a booking as unpaid
  because a webhook has not arrived.
- **Refunds release the seat.** Team 4 handles the refund event.
- **Never trust amount or status from the client.** The client's copy is display
  only; the server figure is the charge.

### Endpoints Team 5 exposes to Team 4

`GET /payments/status/:orderId` — poll a booking's payment state.

### Known dependency

Team 5's booking seed (`YTR-12951-7QX2`, `YTR-12951-7QX3`) must be replaced by
Team 4's real data before the stages can be merged without manual changes.

---

## 11. What is not done

- **The API does not read from MySQL yet.** The schema, procedures and seeders
  are done and tested (§12); `services/paymentStore.js` is still the in-memory
  store the endpoints use. Swapping it is one adapter behind the existing seam.
- **Payment expiry is Yatrio's rule, not Razorpay's.** `ORDER_TTL_MINUTES`
  marks an order stale for us; Razorpay would still accept it. Needs agreeing
  with Team 4. The TTL is stored as `payments.expires_at`, so the rule is
  already queryable when the API moves over.
- **No webhook handler.** Verification is user-initiated. A production build
  needs `order.paid` / `payment.failed` webhooks so a payment that settles
  out of band still updates the booking.
- **No auth on the payment endpoints.** Team 1 owns authentication; these routes
  are currently open. `refunds.initiated_by` is free text until then.
- **UPI needs account activation.** It is requested in the Checkout config but
  will not render until enabled on the Razorpay account (§8). Not a code change.
- **UPI Collect is deprecated** (NPCI, 28 Feb 2026); web must use UPI Intent
  or QR. The old `success@razorpay` test ID may not apply.
- **No method picker in our UI by design.** One "Proceed to Pay" button; Razorpay
  owns method selection so we never offer something the account cannot accept.

---

## 12. Database

The Database column of the task sheet: schema, constraints, procedures,
migration files and seed data. MySQL 8.4, reached over TLS.

> `defaultdb` is **the project's database, shared by all seven teams**. These
> four tables are Team 5's slice of it. Connection details, who owns what, and
> the rules for adding your own tables live in
> [`backend/database/README.md`](backend/database/README.md) — use that for
> anything beyond Team 5's own schema.

| | |
|---|---|
| Host | Aiven · `mysql-yatrio-kharadeprathamesh7` · `defaultdb` |
| ORM | Sequelize 6 + mysql2 (`backend/src/models`, `backend/src/config/database.js`) |
| Migrations | `backend/database/migrations` — 7, all reversible |
| SQL objects | `backend/database/sql` — 3 procedures, 2 triggers, 1 view |
| Seeders | `backend/database/seeders` — methods + four demo payments |
| Tests | `backend/tests/db.test.js` — 21 cases against the live database |
| Browsing it | [`backend/database/README.md`](backend/database/README.md) — MySQL Workbench, the MySQL client, `npm run db:shell`, and the TLS setup |

### 12.1 Environment

| Variable | File | Required | Notes |
|---|---|---|---|
| `DB_HOST` | `backend/.env` | yes | `mysql-yatrio-kharadeprathamesh7.b.aivencloud.com` |
| `DB_PORT` | `backend/.env` | yes | **11499** — Aiven assigns a port per service, not 3306 |
| `DB_NAME` | `backend/.env` | yes | `defaultdb` |
| `DB_USER` | `backend/.env` | yes | `avnadmin` |
| `DB_PASSWORD` | `backend/.env` | yes | never in a `VITE_*` variable |
| `DB_SSL_CA` | `backend/.env` | yes | `database/certs/aiven-ca.pem` — Aiven's root CA |
| `DB_SSL` | `backend/.env` | no | TLS on by default; `false` turns it off |
| `DB_SSL_REJECT_UNAUTHORIZED` | `backend/.env` | no | defaults to **true** when `DB_SSL_CA` is set |
| `DB_DIALECT` | `backend/.env` | no | `mysql` |
| `DB_LOGGING` | `backend/.env` | no | `true` prints every statement; off by default |
| `DB_POOL_MAX` | `backend/.env` | no | default `5` |

> These are discrete variables on purpose, so each is greppable and overridable
> on its own. Aiven hands out a **Service URI**, which is the same five values
> in one string:
>
> ```
> mysql://avnadmin:***@mysql-yatrio-kharadeprathamesh7.b.aivencloud.com:11499/defaultdb?ssl-mode=REQUIRED
> ```
>
> Split it, and **drop the `?ssl-mode=REQUIRED`** — mysql2 does not understand
> that parameter. `DB_SSL` and `DB_SSL_CA` do the same job, and do it properly:
> the CA is what makes the server's identity verified rather than merely
> encrypted. `config/database.js` warns if it finds a leftover `DATABASE_URL`.

### 12.2 Commands

```bash
cd Backend
npm run db:migrate        # create the schema
npm run db:seed           # methods + demo payments
npm run db:migrate:status # what has run
npm run test:db           # 21 cases against the live database
npm run db:reset          # undo everything, re-apply, re-seed
```

### 12.3 Tables

```mermaid
erDiagram
    BOOKINGS ||--o{ PAYMENTS : "booking_id"
    PAYMENTS }o--o| PAYMENT_METHODS : "method_code"
    PAYMENTS ||--o{ PAYMENT_TRANSACTIONS : "attempts"
    PAYMENTS ||--o{ REFUNDS : "reversals"

    BOOKINGS {
        BIGINT booking_id PK "Team 4. Not in this schema yet."
    }

    PAYMENT_METHODS {
        INT     payment_method_id PK
        VARCHAR code                UK
        VARCHAR display_name
        VARCHAR gateway             "razorpay"
        SMALLINT sort_order         "UPI first"
        BOOLEAN is_active
        DATETIME created_at
        DATETIME updated_at
    }

    PAYMENTS {
        BIGINT   payment_id             PK
        BIGINT   booking_id             "indexed, no FK yet"
        VARCHAR  booking_ref
        VARCHAR  gateway                "razorpay"
        VARCHAR  gateway_order_id       UK
        VARCHAR  gateway_payment_id     UK
        BIGINT   amount                 "paise"
        BIGINT   refunded_amount        "paise"
        VARCHAR  currency               "INR"
        ENUM     status                 "created attempted authorized captured failed refunded"
        SMALLINT attempt_number
        VARCHAR  method_code            "to payment_methods.code"
        VARCHAR  failure_code
        VARCHAR  failure_reason
        CHAR     signature_fingerprint  "sha256, never the signature"
        DATETIME expires_at             "ORDER_TTL_MINUTES"
        VARCHAR  train_no
        VARCHAR  train_name
        VARCHAR  from_station
        VARCHAR  to_station
        VARCHAR  passenger_name
        VARCHAR  passenger_email
        VARCHAR  passenger_contact
        DATETIME captured_at
        DATETIME failed_at
        DATETIME refunded_at
        DATETIME created_at
        DATETIME updated_at
    }

    PAYMENT_TRANSACTIONS {
        BIGINT   transaction_id        PK
        BIGINT   payment_id            FK
        SMALLINT attempt_number
        ENUM     event                 "ORDER_CREATED PAYMENT_VERIFIED PAYMENT_FAILED PAYMENT_REFUNDED ORDER_EXPIRED"
        VARCHAR  status
        VARCHAR  gateway_order_id      UK
        VARCHAR  gateway_payment_id    UK
        VARCHAR  gateway_refund_id     UK
        BOOLEAN  signature_valid
        CHAR     signature_fingerprint
        DATETIME verified_at
        BIGINT   amount                "paise"
        VARCHAR  currency
        VARCHAR  method_code
        VARCHAR  failure_code
        VARCHAR  failure_reason
        INT      latency_ms
        JSON     gateway_response      "redacted"
        DATETIME created_at
        DATETIME updated_at
    }

    REFUNDS {
        BIGINT   refund_id         PK
        BIGINT   payment_id        FK
        VARCHAR  gateway_refund_id UK
        BIGINT   amount            "paise"
        VARCHAR  currency
        ENUM     status            "pending processed failed"
        VARCHAR  reason
        VARCHAR  failure_code
        VARCHAR  failure_reason
        VARCHAR  initiated_by      "auth is Team 1's"
        JSON     gateway_response  "redacted"
        DATETIME processed_at
        DATETIME created_at
        DATETIME updated_at
    }
```

Reading the relationships:

| Line | Means |
|---|---|
| `BOOKINGS \|\|--o{ PAYMENTS` | one booking has many payment attempts. **Drawn for the plan, not the schema** — there is no foreign key yet, see §12.8 |
| `PAYMENTS }o--o\| PAYMENT_METHODS` | many payments to zero-or-one method. A *soft* reference: `method_code` holds an instrument code, not a row id, so a payment keeps the method it was taken with even if that method is later deactivated |
| `PAYMENTS \|\|--o{ PAYMENT_TRANSACTIONS` | one payment, many attempts. Deleting a payment cascades |
| `PAYMENTS \|\|--o{ REFUNDS` | one payment, many reversals, so a partial refund is representable |

`UK` marks a unique index — the "constraints preventing duplicate transaction
IDs" from the assignment. Two of them are **composite**, which a diagram cannot
show as a per-column marker and which are therefore absent from the picture
above: `payments (booking_ref, attempt_number)` and
`payment_transactions (payment_id, attempt_number, event)`. The second is what
makes `confirm_payment()` idempotent — a replayed confirmation rewrites the row
it finds instead of adding one. §12.4 lists every constraint and what it stops.

`v_payment_history` is a read-only view over these four tables and so does not
appear above.

Amounts are `BIGINT` **paise** everywhere — 3A × 1 = `61860`, never `618.60`.

| Table | Key | Design note |
|---|---|---|
| `payments` | `payment_id`; `booking_id` | One row per booking **attempt**. `booking_id` is indexed but has **no foreign key** — Team 4's `bookings` is not in this schema yet; add the FK in the migration that ships with it. |
| `payment_transactions` | `transaction_id`; `payment_id` | One row per `(attempt, event)`. The audit trail: which gateway id was presented, whether the HMAC verified, latency, and the redacted gateway response. |
| `refunds` | `refund_id`; `payment_id` | One-to-many, so a partial refund is representable. `CHECK (amount > 0)`. |
| `payment_methods` | `payment_method_id`; `code` UNIQUE | The instruments requested in Checkout, in order. |

Amounts are `BIGINT` **paise** everywhere — 3A × 1 = `61860`, never `618.60`.

### 12.4 Constraints preventing duplicate transaction IDs

The assignment's headline requirement, enforced in three layers:

| Constraint | Stops |
|---|---|
| `payments.gateway_order_id` UNIQUE | one order recorded twice |
| `payments.gateway_payment_id` UNIQUE | one payment captured twice |
| `payments (booking_ref, attempt_number)` UNIQUE | a retry loop double-charging a booking |
| `payment_transactions.gateway_order_id` / `_payment_id` / `_refund_id` UNIQUE | a replayed webhook writing a second transaction |
| `refunds.gateway_refund_id` UNIQUE | a second reversal of one refund |

`confirm_payment()` is idempotent on top of that: replaying it rewrites the rows
it finds, adds nothing, and leaves `captured_at` where it was. That is what
`"duplicate": true` means in §4.

### 12.5 Procedures

`create_payment_record()`, `confirm_payment()`, `process_refund()` —
`backend/database/sql/procedures.sql`, applied by migration 5.

| Routine | Refuses |
|---|---|
| `create_payment_record` | a duplicate gateway order (`DUPLICATE_GATEWAY_ORDER_ID`), a repeated attempt number (`DUPLICATE_BOOKING_ATTEMPT`), a zero amount |
| `confirm_payment` | capturing on a signature that did not verify — the payment is failed as `SIGNATURE_MISMATCH`, never captured; a payment id bound to another order (`ORDER_MISMATCH`); capturing a failed payment; anything on a refunded payment. Idempotent otherwise. |
| `process_refund` | a payment that is not captured (`NOT_CAPTURED`), a second refund (`ALREADY_REFUNDED`), an amount over what is left of the capture |

### 12.6 Triggers

Guards, not business logic — the procedures decide, the schema refuses.

| Trigger | Enforces |
|---|---|
| `trg_payments_status_guard` | a terminal status is final: `failed` and `refunded` are frozen, and `captured` may only become `refunded` |
| `trg_refunds_payment_guard` | the refund rules above, for any writer — not just the API — so a hand-run INSERT cannot double-reverse a capture |

### 12.7 Seeded data

Both demo bookings, covering every status the transactions screen filters on:

| Booking | Attempt | Status | Why |
|---|---|---|---|
| `YTR-12951-7QX2` | 1 | `failed` | a declined card |
| `YTR-12951-7QX2` | 2 | `captured` | UPI, settled — ₹618.60 |
| `YTR-12951-7QX3` | 1 | `refunded` | captured, then reversed in full |
| `YTR-12951-7QX3` | 2 | `authorized` | bank approved, not yet settled — the pending screen |

Amounts match `services/fareService.js` exactly, because the fare engine is the
only thing that decides what is charged.

### 12.8 Team 4 dependency

`payments.booking_id` is a plain `BIGINT` for `bookings.booking_id` with an
index but no foreign key. When Team 4's `bookings` table lands, add the
constraint in a new migration rather than editing an applied one:

```sql
ALTER TABLE `payments`
  ADD CONSTRAINT `fk_payments_booking` FOREIGN KEY (`booking_id`)
  REFERENCES `bookings` (`booking_id`) ON DELETE SET NULL;
```

`ON DELETE SET NULL`, not CASCADE: deleting a booking must not delete the
record that money moved against it. `booking_ref` is stored alongside
`booking_id` so history still renders if the row is ever gone.
### 12.9 Seat inventory, segment booking and the bitmask

A berth is not booked for a whole journey. It is booked for a **run of adjacent
segments**, and it can be sold again from the next station along. The 12002 has
four segments; a berth sold NDLS→JHS occupies three of them and stays empty for
exactly those three, so a traveller boarding at JHS may take the same berth.

Occupancy is therefore a bitmask, one bit per segment:

```
bit 0        bit 1        bit 2        bit 3
NDLS-AGC     AGC-GWL      GWL-JHS      JHS-BPL
```

```
Rahul  NDLS->JHS  stops 1-4  mask 0111 = 7
Priya  AGC->BPL   stops 2-5  mask 1110 = 14    7 & 14 = 0110  conflict
Same berth, JHS->BPL  stops 4-5  mask 1000 = 8   7 & 8 = 0000  free
```

`BIGINT UNSIGNED` is 64 bits. The longest route in the schema is nine stops, so
there are fifty-six spare bits and a `CHECK` constraint enforces the ceiling
rather than trusting callers.

#### Four tables

| Table | Grain | Notes |
| --- | --- | --- |
| `coaches` | one carriage per (train, class) | composite FK to `train_classes (train_id, class_code)` |
| `coach_seats` | one berth per coach | the thing a hold points at |
| `seat_inventory` | one row per **seat per journey date** | holds `segment_mask`; **this is the lock** |
| `seat_holds` | one row per booking per seat | `from_stop_seq`, `to_stop_seq`, `segment_mask` |

#### The claim is a compare-and-swap, not a lock table

```sql
UPDATE seat_inventory
   SET segment_mask = segment_mask | :mask
 WHERE seat_id = ? AND departure_date = ?
   AND (segment_mask & :mask) = 0     -- affectedRows 1 = won, 0 = lost
```

MySQL evaluates that predicate under the row lock, so there is no read-then-write
window and no dependency on the application being the only writer — which
matters, because the payment store and the booking registry are both
process-local.

This **replaces** the `UNIQUE (train, class, date, coach, seat)` index the
first version of this table used. That index cannot work here: a seat
legitimately has several concurrent rows whenever their segments are disjoint.

#### Release clears only its own bits

`segment_mask & ~(:mask)`. Safe against neighbours — if A holds `0111` and B
holds `1000`, A expiring leaves B untouched. Nor can a lapsed hold clear a bit
since re-claimed, because its bits were held continuously for its whole life.

> The inner parentheses are load-bearing. Sequelize's replacement scanner only
> recognises `:name` directly after `(`, a word boundary or a comma; written as
> `~:mask` the placeholder reaches MySQL unsubstituted.

#### Expiry does not depend on the sweeper

`holdSeats` retires lapsed holds on the journey *before* claiming, so a berth is
free the moment its window closes. `holdSweeper.js` only collects dead rows.
Disabling it costs untidy rows, never correctness.

#### Pro-rata pricing

`rate_per_km = base_fare / full_route_km`, then `fare = round(segment_km x rate)`.
A whole-route booking costs exactly the advertised `base_fare`; a sub-route is a
pro-rata share. The rate must be per *(train, class)* — implied per-km rates
across the seeded data span Rs 0.24 (2S on the 11077) to Rs 3.50 (1A on the
12951).

Known limitation, documented rather than hidden: **no minimum fare**, so a 48 km
hop prices at about Rs 70 in 2S. Real railways floor this; `fares` is Team 3's
table and does not exist yet.

#### Availability is derived, not stored

`train_classes.available_seats` is a static seed number that never tracked a
booking. Availability is now counted from the masks, and `takenSeats` counts
*berths* rather than bookings — one physical seat sold to three passengers over
three legs is one taken berth.

