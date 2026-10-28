-- ---------------------------------------------------------------------------
-- Yatrio . Team 5 . Payment views
--
-- v_payment_history is the shape GET /api/payment/history returns, flattened
-- into one row per payment so the transactions screen needs a single read.
-- Team 7's reporting can build revenue views on top of it without reaching
-- into Team 5's tables (integration contract: T7 reads through approved views).
--
-- Applied by database/migrations/*-create-payment-views.js.
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS `v_payment_history`;

CREATE OR REPLACE VIEW `v_payment_history` AS
SELECT
    p.`payment_id`,
    p.`booking_ref`,
    p.`booking_id`,
    p.`gateway`,
    p.`gateway_order_id`,
    p.`gateway_payment_id`,
    p.`amount`,
    -- Derived, not stored: `payments.refunded_amount` was dropped in migration
    -- 011. It duplicated SUM(refunds.amount) and had no trigger keeping the two
    -- in step, so it was a second place for the same fact to disagree with
    -- itself. COALESCE matters -- a payment with no refunds has no row to sum.
    COALESCE((SELECT SUM(r2.`amount`) FROM `refunds` r2 WHERE r2.`payment_id` = p.`payment_id`), 0) AS `refunded_amount`,
    p.`currency`,
    p.`status`,
    p.`attempt_number`,
    p.`method_code`,
    pm.`display_name`                                AS `method_display_name`,
    p.`failure_code`,
    p.`failure_reason`,
    p.`expires_at`,
    -- Joined in rather than copied onto `payments`, so a booking whose train is
    -- renamed shows the new name here immediately. The audit found 2 bookings
    -- whose stored copy already disagreed with `trains`.
    tr.`train_number`                                  AS `train_no`,
    tr.`train_name`,
    os.`station_code`                                  AS `from_station`,
    ds.`station_code`                                  AS `to_station`,
    bp.`full_name`                                     AS `passenger_name`,
    b.`contact_email`                                  AS `passenger_email`,
    b.`contact_phone`                                  AS `passenger_contact`,
    p.`captured_at`,
    p.`failed_at`,
    p.`refunded_at`,
    p.`created_at`,
    p.`updated_at`,

    -- The attempt that produced this payment.
    t.`transaction_id`,
    t.`event`                                        AS `last_event`,
    t.`status`                                       AS `transaction_status`,
    t.`gateway_refund_id`,
    t.`signature_valid`,
    t.`signature_fingerprint`,
    t.`verified_at`,
    t.`latency_ms`,

    -- The reversal, when there is one.
    r.`refund_id`,
    r.`gateway_refund_id`                            AS `refund_gateway_id`,
    r.`status`                                       AS `refund_status`,
    r.`amount`                                       AS `refund_amount`,
    r.`reason`                                       AS `refund_reason`,
    r.`processed_at`                                 AS `refund_processed_at`,

    -- Settled and not yet given back, in paise. T7's daily revenue view.
    CASE WHEN p.`status` = 'captured' THEN p.`amount` ELSE 0 END AS `settled_amount`
FROM `payments` p
LEFT JOIN `payment_transactions` t
       ON t.`payment_id` = p.`payment_id`
LEFT JOIN `refunds` r
       ON r.`payment_id` = p.`payment_id`
LEFT JOIN `payment_methods` pm
       ON pm.`code` = p.`method_code`
-- The journey, reached through the booking rather than copied onto the payment.
LEFT JOIN `bookings` b
       ON b.`booking_id` = p.`booking_id`
-- Aliased `tr`, not `t`: `payment_transactions` is already joined above as
-- `t`, and MySQL rejects a second join reusing the same alias.
LEFT JOIN `trains` tr
       ON tr.`id` = b.`train_id`
LEFT JOIN `stations` os
       ON os.`id` = b.`origin_station_id`
LEFT JOIN `stations` ds
       ON ds.`id` = b.`destination_station_id`
-- First passenger of the booking, for the "who paid" column.
LEFT JOIN `booking_passengers` bp
       ON bp.`booking_id` = b.`booking_id` AND bp.`position` = 1;