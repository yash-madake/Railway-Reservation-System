-- 008_create_stored_procedures.sql
-- Stored procedures for searching stations and searching trains between stations

DROP PROCEDURE IF EXISTS search_stations;
DELIMITER $$
CREATE PROCEDURE search_stations(
    IN p_search VARCHAR(100),
    IN p_limit INT,
    IN p_offset INT
)
BEGIN
    DECLARE v_limit INT DEFAULT 20;
    DECLARE v_offset INT DEFAULT 0;

    IF p_limit IS NOT NULL AND p_limit > 0 THEN
        SET v_limit = p_limit;
    END IF;
    IF p_offset IS NOT NULL AND p_offset >= 0 THEN
        SET v_offset = p_offset;
    END IF;

    -- `stations.state` became `state_id` when migration 011 normalised the
    -- schema, so the name comes from the `states` lookup. The output column is
    -- still called `state` because that is what the API and the admin screen
    -- read.
    SELECT 
        s.id,
        s.station_code,
        s.station_name,
        s.city,
        st.state_name AS state,
        s.timezone,
        s.status
    FROM stations s
    LEFT JOIN states st ON st.state_id = s.state_id
    WHERE s.status = 'active'
      AND (
          p_search IS NULL 
          OR p_search = '' 
          OR s.station_code LIKE CONCAT('%', p_search, '%')
          OR s.station_name LIKE CONCAT('%', p_search, '%')
          OR s.city LIKE CONCAT('%', p_search, '%')
      )
    ORDER BY 
        CASE 
            WHEN p_search IS NULL OR p_search = '' THEN 3
            WHEN s.station_code = UPPER(p_search) THEN 0
            WHEN s.station_code LIKE CONCAT(UPPER(p_search), '%') THEN 1
            WHEN s.station_name LIKE CONCAT(p_search, '%') THEN 2
            ELSE 3
        END,
        s.station_name ASC
    LIMIT v_limit OFFSET v_offset;
END$$
DELIMITER ;

DROP PROCEDURE IF EXISTS search_trains_between_stations;
DELIMITER $$
CREATE PROCEDURE search_trains_between_stations(
    IN p_from_code VARCHAR(10),
    IN p_to_code VARCHAR(10),
    IN p_journey_date DATE
)
BEGIN
    DECLARE v_day_of_week VARCHAR(3);

    -- Format journey date to 3-letter uppercase day ('MON', 'TUE', etc.)
    SET v_day_of_week = UPPER(DATE_FORMAT(p_journey_date, '%a'));

    SELECT 
        t.id AS train_id,
        t.train_number,
        t.train_name,
        t.train_type,
        t.status AS train_status,
        t.pantry_available,
        s_from.station_code AS from_station_code,
        s_from.station_name AS from_station_name,
        TIME_FORMAT(r_from.departure_time, '%H:%i') AS departure_time,
        r_from.platform AS departure_platform,
        s_to.station_code AS to_station_code,
        s_to.station_name AS to_station_name,
        TIME_FORMAT(r_to.arrival_time, '%H:%i') AS arrival_time,
        r_to.platform AS arrival_platform,
        (r_to.distance_km - r_from.distance_km) AS travel_distance_km,
        (r_to.day_offset - r_from.day_offset) AS day_difference,
        -- Duration calculation formatted as Xh Ym
        CONCAT(
            FLOOR(
                TIMESTAMPDIFF(
                    MINUTE, 
                    TIMESTAMP(p_journey_date, r_from.departure_time),
                    TIMESTAMP(DATE_ADD(p_journey_date, INTERVAL (r_to.day_offset - r_from.day_offset) DAY), r_to.arrival_time)
                ) / 60
            ),
            'h ',
            LPAD(
                MOD(
                    TIMESTAMPDIFF(
                        MINUTE, 
                        TIMESTAMP(p_journey_date, r_from.departure_time),
                        TIMESTAMP(DATE_ADD(p_journey_date, INTERVAL (r_to.day_offset - r_from.day_offset) DAY), r_to.arrival_time)
                    ),
                    60
                ),
                2,
                '0'
            ),
            'm'
        ) AS duration,
        (r_to.stop_sequence - r_from.stop_sequence) AS intermediate_stops_count,
        -- Group concatenated running days
        (
            SELECT GROUP_CONCAT(trd.day_of_week ORDER BY FIELD(trd.day_of_week, 'MON','TUE','WED','THU','FRI','SAT','SUN') SEPARATOR ',')
            FROM train_running_days trd
            WHERE trd.train_id = t.id
        ) AS running_days,
        -- JSON array of available classes
        (
            SELECT JSON_ARRAYAGG(
                JSON_OBJECT(
                    'classCode', tc.class_code,
                    -- From the `classes` lookup, not `train_classes`: migration 011
                    -- dropped `train_classes.class_name` because class_code ->
                    -- class_name is a transitive dependency, not per-train data.
                    'className', cl.class_name,
                    'bayWidth', cl.berth_bay_width,
                    'fare', tc.base_fare,
                    'availableSeats', tc.available_seats,
                    'totalSeats', tc.total_seats,
                    'status', CASE WHEN tc.available_seats > 10 THEN 'AVAILABLE' WHEN tc.available_seats > 0 THEN 'RAC' ELSE 'WAITING' END
                )
            )
            FROM train_classes tc
            JOIN classes cl ON cl.class_code = tc.class_code
            WHERE tc.train_id = t.id
        ) AS classes_json
    FROM trains t
    INNER JOIN stations s_from ON s_from.station_code = UPPER(p_from_code)
    INNER JOIN stations s_to ON s_to.station_code = UPPER(p_to_code)
    INNER JOIN train_routes r_from ON r_from.train_id = t.id AND r_from.station_id = s_from.id
    INNER JOIN train_routes r_to ON r_to.train_id = t.id AND r_to.station_id = s_to.id
    WHERE t.status = 'active'
      -- Source station must be before destination station on route
      AND r_from.stop_sequence < r_to.stop_sequence
      -- Train must run on the selected journey day of week
      AND EXISTS (
          SELECT 1 
          FROM train_running_days rd 
          WHERE rd.train_id = t.id 
            AND rd.day_of_week = v_day_of_week
      )
    ORDER BY r_from.departure_time ASC;
END$$
DELIMITER ;
