-- ---------------------------------------------------------------------------
-- Yatrio train-status read model
--
-- This projection reuses the existing railway master data. It deliberately
-- does not copy timetable rows into a second table: train_routes remains the
-- source of truth for sequence, times, day offsets and cumulative distance.
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS `v_train_status_timetable`;

CREATE OR REPLACE VIEW `v_train_status_timetable` AS
SELECT
    t.`id`              AS `train_id`,
    t.`train_number`,
    t.`train_name`,
    t.`train_type`,
    t.`status`          AS `train_status`,
    t.`pantry_available`,
    r.`stop_sequence`,
    r.`arrival_time`,
    r.`departure_time`,
    r.`distance_km`,
    r.`day_offset`,
    r.`halt_minutes`,
    r.`platform`,
    s.`id`              AS `station_id`,
    s.`station_code`,
    s.`station_name`,
    s.`city`,
    st.`state_name`     AS `state`
FROM `trains` t
INNER JOIN `train_routes` r ON r.`train_id` = t.`id`
INNER JOIN `stations` s ON s.`id` = r.`station_id`
LEFT JOIN `states` st ON st.`state_id` = s.`state_id`
WHERE t.`status` = 'active'
  AND s.`status` = 'active';

