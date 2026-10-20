-- ---------------------------------------------------------------------------
-- Booking routines.
--
-- The booking lifecycle is the one place in this schema where several rows must
-- change together or not at all, and where the database is the only thing that
-- can enforce the invariant. These four routines own it:
--
--   confirm_booking_segments  claim a run of segments for a berth, atomically
--   cancel_booking            terminal a booking and hand its berths back
--   sweep_expired_holds       release holds past their deadline
--   sweep_expired_bookings    age out bookings nobody paid for
--
-- ## Why the application cannot do this alone
--
-- `holdSeats` in src/services/seat/holdService.js performs the same
-- compare-and-swap, in JavaScript, across several round trips. Two of them can
-- interleave between the check and the write. The bitmask UPDATE here is a
-- single statement, so the database serialises it: `... WHERE (segment_mask &
-- :mask) = 0` is evaluated and applied under the row lock, which is what makes
-- "exactly one of two concurrent claims wins" a property of the statement rather
-- than of the timing of two queries.
--
-- The application still owns fare computation and the payment gateway. This file
-- owns the parts where a half-finished write is worse than a refusal.
--
-- ## Segment masks
--
-- Bit i is the segment between stop i and stop i+1, so a journey from stop
-- `from_seq` to `to_seq` occupies a run of `to_seq - from_seq` ones:
--
--     maskFor(1, 4) = 0b0111  = 7    -- stops 1..4
--     maskFor(4, 5) = 0b1000  = 8    -- the last leg alone
--
-- Two journeys may share a berth when their runs do not intersect, which is why
-- the test is an AND and not an equality.
-- ---------------------------------------------------------------------------

DROP PROCEDURE IF EXISTS `confirm_booking_segments`;
DROP PROCEDURE IF EXISTS `cancel_booking`;
DROP PROCEDURE IF EXISTS `sweep_expired_holds`;
DROP PROCEDURE IF EXISTS `sweep_expired_bookings`;

-- ---------------------------------------------------------------------------
-- confirm_booking_segments -- claim a berth for a run of segments.
--
-- The whole point is that the compare-and-swap is one statement. Everything
-- else here is bookkeeping that must happen in the same transaction as the
-- claim, or not at all.
--
-- Returns 1 when the berth was claimed, 0 when it was already taken for some
-- part of the requested run. It does not SIGNAL on a clash: a clash is a normal
-- outcome the caller reports, not an error, and raising would force every caller
-- into an exception path for the single most common result.
-- ---------------------------------------------------------------------------
CREATE PROCEDURE `confirm_booking_segments`(
    IN  p_booking_ref      VARCHAR(32),
    IN  p_seat_id          BIGINT UNSIGNED,
    IN  p_departure_date   DATE,
    IN  p_from_stop_seq    SMALLINT UNSIGNED,
    IN  p_to_stop_seq      SMALLINT UNSIGNED,
    IN  p_segment_mask     BIGINT UNSIGNED,
    IN  p_hold_ttl_minutes SMALLINT UNSIGNED,
    IN  p_supersedes_refs  VARCHAR(255)
)
    MODIFIES SQL DATA
BEGIN
    DECLARE v_mask     BIGINT UNSIGNED   DEFAULT 0;
    DECLARE v_expires  DATETIME(3)       DEFAULT NULL;
    DECLARE v_booked   INT               DEFAULT 0;
    DECLARE v_affected BIGINT UNSIGNED   DEFAULT 0;
    DECLARE v_cursor   VARCHAR(255)      DEFAULT NULL;
    DECLARE v_token    VARCHAR(64)       DEFAULT NULL;
    DECLARE v_claimed  TINYINT           DEFAULT 0;

    IF p_booking_ref IS NULL OR p_booking_ref = '' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'BOOKING_REF_REQUIRED';
    END IF;

    -- The booking must already exist: `seat_holds.booking_ref` references it, so
    -- this is the foreign key restated as a readable error rather than a 1452.
    SELECT COUNT(*) INTO v_booked FROM `bookings` WHERE `booking_ref` = p_booking_ref;
    IF v_booked = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'BOOKING_NOT_FOUND';
    END IF;

    IF p_to_stop_seq <= p_from_stop_seq THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_SEGMENT_RANGE';
    END IF;

    -- The mask is supplied by the caller (it already computed it for the fare),
    -- but it has to agree with the stop range or the two would describe
    -- different journeys. Checked rather than trusted: a mismatch here would
    -- quietly claim the wrong berths.
    --
    -- The shift by `from_stop_seq - 1` is load-bearing and was missing.
    --
    -- `journeyService.maskFor` computes `((1 << span) - 1) << (from - 1)`: bit i
    -- is the leg from stop i to stop i+1, and stops are numbered from 1. Without
    -- the shift this routine agreed with that only when the journey started at
    -- stop 1, which is why every test passed -- they all booked from the first
    -- station. A caller asking for stops 4..5 sent mask 8 (leg 4, correct) and
    -- got told it disagreed, because this computed 1 (leg 1). The refusal was
    -- safe; the claim, for a caller that recomputed to match, would have taken
    -- the wrong berths for the whole route.
    SET v_mask = ((1 << (p_to_stop_seq - p_from_stop_seq)) - 1) << (p_from_stop_seq - 1);
    IF p_segment_mask <> v_mask THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SEGMENT_MASK_MISMATCH';
    END IF;

    SET v_expires = DATE_ADD(NOW(3), INTERVAL COALESCE(p_hold_ttl_minutes, 5) MINUTE);

    START TRANSACTION;

        -- Superseding first, in the same transaction as the new claim.
        --
        -- A retry releases what it is replacing *before* claiming, so a failure
        -- part-way cannot leave the traveller holding both. `v_cursor` walks the
        -- comma-separated list so this stays a statement rather than a loop that
        -- cannot run inside a procedure.
        --
        -- The cursor must step *past* the token and its comma. `SUBSTRING(v_cursor,
        -- LENGTH(v_token) + 1)` pointed at the comma itself, so an empty token --
        -- which the trailing comma always produces on the last pass -- resubmitted
        -- the same remainder and the loop spun forever. The session never came
        -- back: the CALL held its transaction open inside MySQL (trx_state RUNNING,
        -- no lock wait, no error), the client eventually read ECONNRESET, and every
        -- later test in the suite blocked behind the locks it never released. A
        -- supersedes list of any length hit it; only NULL, the no-retry path, was
        -- safe.
        SET v_cursor = NULLIF(TRIM(p_supersedes_refs), '');
        WHILE v_cursor IS NOT NULL DO
            SET v_token = SUBSTRING_INDEX(v_cursor, ',', 1);
            -- CHAR_LENGTH, not LENGTH: SUBSTRING counts characters, so a byte
            -- count would land inside a multi-byte reference.
            SET v_cursor = NULLIF(SUBSTRING(v_cursor, CHAR_LENGTH(v_token) + 2), '');

            IF v_token <> '' THEN
                    -- Give the superseded booking's berths back, which is the
                    -- whole point of superseding.
                    --
                    -- This block did the opposite. It promoted *expired* holds to
                    -- `status = 'confirmed'`, so a retry that replaced its own
                    -- earlier attempt took the berths off sale permanently --
                    -- marked sold to a booking nobody had paid for -- and left the
                    -- bits set with nothing able to release them.
                    --
                    -- The masks are copied into a temporary table first. Writing
                    -- this as `UPDATE seat_inventory JOIN seat_holds ... SET
                    -- segment_mask = segment_mask & ~h.segment_mask` is the
                    -- obvious spelling and it hangs: the join *reads*
                    -- `seat_holds`, so it takes locks there before it takes them
                    -- in `seat_inventory`, and every other release path in this
                    -- system takes them in the opposite order. Two of those
                    -- crossing is a deadlock, and under a queue it is not a
                    -- clean error -- InnoDB rolls one back, the survivor keeps
                    -- its locks, and everything behind it waits on a session
                    -- that has already gone.
                    --
                    -- Copying first decouples the two: only `seat_inventory` is
                    -- locked before the holds, which is the order the rest of
                    -- the system uses, and the masks are the ones that were
                    -- actually held rather than whatever they are by the time the
                    -- write runs.
                    --
                    -- Joined on `departure_date`, never `seat_id` alone:
                    -- clearing bits on every date that berth has ever run frees
                    -- a seat another booking sold on a different day. That bug
                    -- was live in holdService.js and is a regression test now.
                    DROP TEMPORARY TABLE IF EXISTS `tmp_yatrio_superseded`;
                    -- `sql_require_primary_key` is on this server, so the
                    -- surrogate key is not optional: without it the CREATE is
                    -- refused and the whole routine fails. The natural key is
                    -- kept as a non-unique index because the join drives on it.
                    CREATE TEMPORARY TABLE `tmp_yatrio_superseded` (
                        `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                        `seat_id`        BIGINT UNSIGNED NOT NULL,
                        `departure_date` DATE          NOT NULL,
                        `segment_mask`   BIGINT UNSIGNED NOT NULL,
                        PRIMARY KEY (`id`),
                        KEY `ix_tmp_seat` (`seat_id`, `departure_date`)
                    ) ENGINE = InnoDB;

                    INSERT INTO `tmp_yatrio_superseded` (`seat_id`, `departure_date`, `segment_mask`)
                    SELECT h.`seat_id`, h.`departure_date`, h.`segment_mask`
                      FROM `seat_holds` h
                     WHERE h.`booking_ref` = v_token
                       AND h.`status` = 'held';

                    UPDATE `seat_inventory` i
                      JOIN `tmp_yatrio_superseded` t
                        ON t.`seat_id`         = i.`seat_id`
                       AND t.`departure_date` = i.`departure_date`
                       SET i.`segment_mask` = i.`segment_mask` & ~t.`segment_mask`,
                           i.`updated_at`   = NOW(3);

                    DELETE FROM `seat_holds` WHERE `booking_ref` = v_token AND `status` = 'held';

                    DROP TEMPORARY TABLE `tmp_yatrio_superseded`;
                END IF;
            END WHILE;

        -- The claim itself. Materialise the journey first: a berth that has never
        -- been offered for this date has no inventory row to update, and an
        -- UPDATE that matches nothing would look exactly like "taken".
        INSERT IGNORE INTO `seat_inventory` (`seat_id`, `departure_date`, `segment_mask`, `created_at`, `updated_at`)
        VALUES (p_seat_id, p_departure_date, 0, NOW(3), NOW(3));

        -- One statement, so the evaluate-and-set is atomic under the row lock.
        -- `& 0` finds any overlap; a berth free for the whole run falls through
        -- to the WHERE and is claimed.
        UPDATE `seat_inventory`
           SET `segment_mask` = `segment_mask` | p_segment_mask,
               `updated_at`   = NOW(3)
         WHERE `seat_id`        = p_seat_id
           AND `departure_date` = p_departure_date
           AND (`segment_mask` & p_segment_mask) = 0;

        SET v_affected = ROW_COUNT();

        SET v_claimed = 0;

        IF v_affected = 1 THEN
            INSERT INTO `seat_holds` (
                `booking_ref`, `seat_id`, `departure_date`,
                `from_stop_seq`, `to_stop_seq`, `segment_mask`,
                `status`, `expires_at`, `created_at`, `updated_at`
            )
            VALUES (
                p_booking_ref, p_seat_id, p_departure_date,
                p_from_stop_seq, p_to_stop_seq, p_segment_mask,
                'held', v_expires, NOW(3), NOW(3)
            );

            SET v_claimed = 1;
        END IF;

        -- Returned here, inside the transaction.
        --
        -- An OUT parameter is not reliable across COMMIT: MySQL restores the
        -- caller's variable frames when the transaction ends, so a routine that
        -- commits before returning through an OUT parameter reports the value it
        -- had at the start. An earlier version of this routine always answered 0
        -- while the berth was genuinely claimed -- the caller saw a refusal and
        -- the inventory said sold. A result set cannot be rolled back this way.
        SELECT v_claimed AS claimed;

    COMMIT;
END;

-- ---------------------------------------------------------------------------
-- cancel_booking -- terminal a booking and give its berths back.
--
-- A booking's CANCELLED and EXPIRED states are terminal: a cancelled booking
-- that came back to HELD would let stale berths be reclaimed while the berths
-- themselves have been resold. That rule is enforced by the routine rather than
-- left to callers, because the sweeper and the controller both move bookings
-- and only one of them would remember.
--
-- Returns 1 when the booking moved, 0 when it was already settled.
-- ---------------------------------------------------------------------------
CREATE PROCEDURE `cancel_booking`(
    IN  p_booking_ref VARCHAR(32),
    IN  p_reason      VARCHAR(255),
    IN  p_changed_by  VARCHAR(64)
)
    MODIFIES SQL DATA
BEGIN
    DECLARE v_booking_id BIGINT UNSIGNED DEFAULT NULL;
    DECLARE v_status     VARCHAR(32)    DEFAULT NULL;
    DECLARE v_target     VARCHAR(32)    DEFAULT NULL;

    START TRANSACTION;

        SELECT `booking_id`, `status`
          INTO v_booking_id, v_status
          FROM `bookings`
         WHERE `booking_ref` = p_booking_ref
         FOR UPDATE;

        IF v_booking_id IS NULL THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'BOOKING_NOT_FOUND';
        END IF;

        -- Already cancelled: idempotent, because a double-clicked Cancel should
        -- not produce an error. Already expired: also settled, but a different
        -- way, so it is reported as 0 rather than being rewritten.
        IF v_status = 'CANCELLED' OR v_status = 'EXPIRED' THEN
            -- Already settled: idempotent, because a double-clicked Cancel should
            -- not produce an error. Reported as 0 rather than rewritten.
            SELECT 0 AS cancelled;
            COMMIT;
        ELSE
            SET v_target = IF(p_reason IS NULL OR p_reason = '', 'cancelled_by_user', p_reason);

            -- Published for trg_bookings_status_log_upd, which is the only writer
            -- of `booking_status`. All three are assigned, including to NULL: a
            -- session variable outlives the statement on a pooled connection, so
            -- an unset one is inherited from whatever ran on it last.
            SET @booking_reason = v_target, @booking_note = NULL, @booking_changed_by = p_changed_by;

            UPDATE `bookings`
               SET `status`             = 'CANCELLED',
                   `cancelled_at`       = NOW(3),
                   `cancellation_reason`= v_target,
                   `updated_at`         = NOW(3)
             WHERE `booking_id` = v_booking_id;

            -- Hand the berths back. Cleared rather than confirmed: a cancelled
            -- booking owns nothing, so the bits go to zero and the berth is on
            -- sale again. (A hold that had already been confirmed by a capture
            -- belongs to a paid ticket and is left alone.)
            UPDATE `seat_inventory` i
              JOIN `seat_holds` h
                ON h.`seat_id` = i.`seat_id`
               AND h.`departure_date` = i.`departure_date`
               SET i.`segment_mask` = i.`segment_mask` & ~h.`segment_mask`,
                   i.`updated_at`   = NOW(3)
             WHERE h.`booking_ref` = p_booking_ref
               AND h.`status` = 'held';

            DELETE FROM `seat_holds` WHERE `booking_ref` = p_booking_ref AND `status` = 'held';

            SELECT 1 AS cancelled;
        END IF;

    COMMIT;
END;

-- ---------------------------------------------------------------------------
-- sweep_expired_holds -- release holds past their deadline.
--
-- Run on a timer by the seat-hold sweeper. One UPDATE for the inventory and one
-- DELETE for the rows, inside one transaction, so the berths are never free
-- while a hold row still claims them.
--
-- Refuses to touch confirmed holds: those belong to paid tickets and the berths
-- are permanently sold.
--
-- Returns the number released.
-- ---------------------------------------------------------------------------
CREATE PROCEDURE `sweep_expired_holds`()
    MODIFIES SQL DATA
BEGIN
    DECLARE v_count INT DEFAULT 0;

    START TRANSACTION;

        -- Clear the bits the lapsed holds were responsible for. The AND-NOT is
        -- the exact inverse of the OR that claimed them, so a berth shared with
        -- another traveller's live hold keeps that traveller's bits.
        UPDATE `seat_inventory` i
          JOIN `seat_holds` h
            ON h.`seat_id` = i.`seat_id`
           AND h.`departure_date` = i.`departure_date`
          SET i.`segment_mask` = i.`segment_mask` & ~h.`segment_mask`,
              i.`updated_at`   = NOW(3)
         WHERE h.`status` = 'held'
           AND h.`expires_at` <= NOW(3);

        DELETE FROM `seat_holds` WHERE `status` = 'held' AND `expires_at` <= NOW(3);

        SET v_count = ROW_COUNT();

        -- Inside the transaction, for the same reason confirm_booking_segments
        -- does it there: an OUT parameter does not survive COMMIT.
        SELECT v_count AS released;

    COMMIT;
END;

-- ---------------------------------------------------------------------------
-- sweep_expired_bookings -- age out bookings nobody paid for.
--
-- Only HELD is touched. A confirmed booking's seats are sold however long ago it
-- was made, and a cancelled one is already settled.
--
-- The history rows are written by the trg_bookings_status_log trigger, so this
-- routine does not insert them itself and cannot forget to.
--
-- Returns the number aged out.
-- ---------------------------------------------------------------------------
CREATE PROCEDURE `sweep_expired_bookings`()
    MODIFIES SQL DATA
BEGIN
    DECLARE v_count INT DEFAULT 0;

    START TRANSACTION;

        -- The holds first: a booking that stops existing while its berths are
        -- still held would leave the bits set with nothing to release them, and
        -- the berth would be unsellable for ever.
        UPDATE `seat_inventory` i
          JOIN `seat_holds` h
            ON h.`seat_id` = i.`seat_id`
           AND h.`departure_date` = i.`departure_date`
          SET i.`segment_mask` = i.`segment_mask` & ~h.`segment_mask`,
              i.`updated_at`   = NOW(3)
         WHERE h.`status` = 'held'
           AND h.`expires_at` <= NOW(3);

        DELETE FROM `seat_holds` WHERE `status` = 'held' AND `expires_at` <= NOW(3);

        -- Same reason as cancel_booking: this routine moves a booking's status,
        -- so it owes the trigger an explicit context. Without it the sweeper
        -- logged whatever `@booking_reason` the last caller on this pooled
        -- connection happened to leave behind -- an expiry attributed to a user,
        -- or to a cancellation reason, at three in the morning.
        SET @booking_reason = 'hold_expired', @booking_note = NULL, @booking_changed_by = 'system';

        UPDATE `bookings`
           SET `status` = 'EXPIRED', `updated_at` = NOW(3)
         WHERE `status` = 'HELD'
           AND `hold_expires_at` IS NOT NULL
           AND `hold_expires_at` <= NOW(3);

        SET v_count = ROW_COUNT();

        SELECT v_count AS expired;

    COMMIT;
END;
