-- ---------------------------------------------------------------------------
-- Yatrio . Team 5 . Payment triggers
--
-- Guards, not business logic. The procedures in procedures.sql decide what
-- happens; these stop the database itself from being walked into a state the
-- payment flow can never be in, whoever writes to it (Team 4's booking flow, a
-- future admin tool, a hand-run query in a console).
--
-- Applied by database/migrations/*-create-payment-triggers.js.
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS `trg_payments_status_guard`;
DROP TRIGGER IF EXISTS `trg_refunds_payment_guard`;

-- ---------------------------------------------------------------------------
-- trg_payments_status_guard -- a terminal payment stays terminal.
--
-- captured -> refunded is the one legal move out of a terminal state, because
-- that is the assignment's refund hand-off. failed and refunded are frozen, and
-- captured can never go back to created/attempted/authorized/failed.
-- ---------------------------------------------------------------------------
CREATE TRIGGER `trg_payments_status_guard`
    BEFORE UPDATE ON `payments`
    FOR EACH ROW
BEGIN
    IF OLD.`status` <> NEW.`status` THEN
        IF OLD.`status` = 'refunded' OR OLD.`status` = 'failed' THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'TERMINAL_STATUS_IS_FINAL';
        END IF;

        IF OLD.`status` = 'captured' AND NEW.`status` <> 'refunded' THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'CAPTURED_PAYMENT_ONLY_REFUNDS';
        END IF;
    END IF;
END;

-- ---------------------------------------------------------------------------
-- trg_refunds_payment_guard -- independent backstop on "refund once".
--
-- procedures.sql process_refund() already refuses a second refund. This is the
-- same rule enforced at the table, so a refund inserted by any other route
-- cannot double-reverse a capture either.
-- ---------------------------------------------------------------------------
CREATE TRIGGER `trg_refunds_payment_guard`
    BEFORE INSERT ON `refunds`
    FOR EACH ROW
BEGIN
    DECLARE v_status   VARCHAR(32)     DEFAULT NULL;
    DECLARE v_amount   BIGINT UNSIGNED DEFAULT NULL;
    DECLARE v_refunded BIGINT UNSIGNED DEFAULT NULL;

    -- Plain read, never a locking one: MySQL refuses a SELECT ... FOR UPDATE
    -- inside a trigger when the invoking statement already touches payments
    -- (an INSERT ... SELECT from payments is the common case here).
    SELECT `status`, `amount`
      INTO v_status, v_amount
      FROM `payments`
     WHERE `payment_id` = NEW.`payment_id`;

    -- Already refunded so far, summed from `refunds` rather than read from
    -- `payments.refunded_amount`. That column is gone as of migration 011: it
    -- duplicated this sum with no trigger keeping the two in step, so a second
    -- partial refund was checked against a stale figure. `refunds` is the table
    -- that records reversals, so it is the only honest source here.
    SELECT COALESCE(SUM(`amount`), 0)
      INTO v_refunded
      FROM `refunds`
     WHERE `payment_id` = NEW.`payment_id`;

    IF v_status IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PAYMENT_NOT_FOUND';
    END IF;

    IF NEW.`amount` IS NULL OR NEW.`amount` = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AMOUNT_MUST_BE_POSITIVE';
    END IF;

    -- A refunded payment carries status 'refunded', so this one condition
    -- covers both NOT_CAPTURED and ALREADY_REFUNDED.
    IF v_status <> 'captured' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_CAPTURED';
    END IF;

    IF NEW.`amount` > (v_amount - v_refunded) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'REFUND_EXCEEDS_CAPTURE';
    END IF;
END;
-- ---------------------------------------------------------------------------
-- trg_bookings_status_log_ins / _upd
--
-- Append to `booking_status` whenever a booking is created or changes status.
--
-- This history used to be written by hand: `recordStatus()` in bookingService
-- inserted a row from three separate places -- creation, `transition()`, and the
-- expiry sweeper. Three paths, and they disagreed. The sweeper's bulk UPDATE
-- called `recordStatus` once per booking in a loop *after* the rows were
-- already committed, so an expiry could land in `bookings` with nothing beside
-- it in the log if the process died in between -- an audit trail with a hole
-- exactly where nobody was watching. Worse, `recordStatus` swallowed its own
-- errors, so a failed insert was indistinguishable from success.
--
-- A trigger closes this because there is no longer a way to change a booking's
-- status without the history changing with it. Single writer, same statement,
-- cannot be skipped, cannot half-fail.
--
-- Two triggers rather than one `AFTER INSERT OR UPDATE`, because MySQL offers no
-- way to ask inside a combined trigger whether the row arrived by INSERT or by
-- UPDATE, and the guard conditions differ: the UPDATE must ignore a no-op that
-- leaves status alone, the INSERT must always write.
--
-- ## Why `reason` and `changed_by` are session variables
--
-- A trigger cannot take parameters, so the caller publishes the context in
-- `@booking_reason`, `@booking_note` and `@booking_changed_by` before the write.
-- These are per-connection, which is why bookingService pins the SET and the
-- UPDATE to one connection inside a transaction rather than issuing them as two
-- pooled round trips.
--
-- NULL means "the caller did not supply this" and the column falls back -- to
-- `cancellation_reason` for a cancellation, to the status itself otherwise,
-- and to `system` for the actor. The reason a cancel was cancelled is already on
-- the booking row, so the most important case needs no session variable at all.
-- ---------------------------------------------------------------------------
-- The single `trg_bookings_status_log` trigger this replaced is dropped too.
--
-- Not tidiness: two AFTER UPDATE triggers on `bookings` that both append to
-- `booking_status` write every transition twice, and the second row is a
-- perfect copy -- same status, same reason, same timestamp -- so nothing about
-- the data reveals the duplication. It has to be named here rather than left to
-- `db:migrate:undo`, because a script that is re-runnable has to clean up after
-- the version it supersedes.
DROP TRIGGER IF EXISTS `trg_bookings_status_log`;
DROP TRIGGER IF EXISTS `trg_bookings_status_log_ins`;
DROP TRIGGER IF EXISTS `trg_bookings_status_log_upd`;

CREATE TRIGGER `trg_bookings_status_log_ins`
    AFTER INSERT ON `bookings`
    FOR EACH ROW
BEGIN
    INSERT INTO `booking_status` (`booking_id`, `status`, `reason`, `note`, `changed_by`, `changed_at`)
    VALUES (
        NEW.`booking_id`,
        NEW.`status`,
        COALESCE(@booking_reason, NEW.`status`),
        @booking_note,
        COALESCE(@booking_changed_by, 'system'),
        NOW(3)
    );
END;

CREATE TRIGGER `trg_bookings_status_log_upd`
    AFTER UPDATE ON `bookings`
    FOR EACH ROW
BEGIN
    IF NOT (OLD.`status` <=> NEW.`status`) THEN
        INSERT INTO `booking_status` (`booking_id`, `status`, `reason`, `note`, `changed_by`, `changed_at`)
        VALUES (
            NEW.`booking_id`,
            NEW.`status`,
            COALESCE(@booking_reason, NEW.`cancellation_reason`, NEW.`status`),
            @booking_note,
            COALESCE(@booking_changed_by, 'system'),
            NOW(3)
        );
    END IF;
END;
