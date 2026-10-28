-- 015_create_team3_schema.sql
-- Team 3: Train Details, Route Schedules, Quotas, Fares & Seat Availability

-- 1. Extend master tables with railway zone attributes (idempotent)
SET @zone_exists_s = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stations' AND COLUMN_NAME = 'railway_zone');
SET @alter_s = IF(@zone_exists_s = 0, 'ALTER TABLE stations ADD COLUMN railway_zone VARCHAR(10) NULL;', 'SELECT 1;');
PREPARE stmt_s FROM @alter_s;
EXECUTE stmt_s;
DEALLOCATE PREPARE stmt_s;

SET @zone_exists_t = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'trains' AND COLUMN_NAME = 'railway_zone');
SET @alter_t = IF(@zone_exists_t = 0, 'ALTER TABLE trains ADD COLUMN railway_zone VARCHAR(10) NULL AFTER train_type;', 'SELECT 1;');
PREPARE stmt_t FROM @alter_t;
EXECUTE stmt_t;
DEALLOCATE PREPARE stmt_t;

-- 2. Quotas Table (GN, TQ, LD, PT, etc.)
CREATE TABLE IF NOT EXISTS quotas (
    quota_code VARCHAR(5) PRIMARY KEY,
    quota_name VARCHAR(50) NOT NULL,
    description VARCHAR(255) NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Fares Matrix Table (Distance slab pricing with taxes)
CREATE TABLE IF NOT EXISTS fares (
    id INT AUTO_INCREMENT PRIMARY KEY,
    class_code VARCHAR(10) NOT NULL,
    min_distance_km INT NOT NULL,
    max_distance_km INT NOT NULL,
    base_fare DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    reservation_fee DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    superfast_charge DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    gst_percent DECIMAL(4, 2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT uq_class_slab UNIQUE (class_code, min_distance_km, max_distance_km)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Availability Snapshots Table (Date, Class, Quota specific seat counts)
CREATE TABLE IF NOT EXISTS availability_snapshots (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    train_id INT NOT NULL,
    journey_date DATE NOT NULL,
    class_code VARCHAR(10) NOT NULL,
    quota_code VARCHAR(5) NOT NULL,
    total_seats INT NOT NULL DEFAULT 0,
    available_seats INT NOT NULL DEFAULT 0,
    rac_seats INT NOT NULL DEFAULT 0,
    waiting_seats INT NOT NULL DEFAULT 0,
    status ENUM('AVAILABLE', 'RAC', 'WL', 'REGRET') NOT NULL DEFAULT 'AVAILABLE',
    confirmation_probability INT NOT NULL DEFAULT 100,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_as_train FOREIGN KEY (train_id) REFERENCES trains(id) ON DELETE CASCADE,
    CONSTRAINT fk_as_quota FOREIGN KEY (quota_code) REFERENCES quotas(quota_code) ON DELETE CASCADE,
    CONSTRAINT uq_train_date_class_quota UNIQUE (train_id, journey_date, class_code, quota_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Availability History Table (Audit logging for seat transactions)
CREATE TABLE IF NOT EXISTS availability_history (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    snapshot_id BIGINT NOT NULL,
    old_available_seats INT NOT NULL,
    new_available_seats INT NOT NULL,
    change_type VARCHAR(50) NOT NULL,
    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_ah_snapshot FOREIGN KEY (snapshot_id) REFERENCES availability_snapshots(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Stored Procedure 1: get_train_schedule
DROP PROCEDURE IF EXISTS get_train_schedule;
DELIMITER $$
CREATE PROCEDURE get_train_schedule(IN p_train_no VARCHAR(10))
BEGIN
    SELECT 
        tr.stop_sequence,
        s.station_code,
        s.station_name,
        s.city,
        COALESCE(st.state_name, 'India') AS state,
        COALESCE(s.railway_zone, 'IR') AS railway_zone,
        TIME_FORMAT(tr.arrival_time, '%H:%i') AS arrival_time,
        TIME_FORMAT(tr.departure_time, '%H:%i') AS departure_time,
        CAST(tr.distance_km AS SIGNED) AS distance_km,
        tr.day_offset,
        tr.halt_minutes,
        tr.platform
    FROM train_routes tr
    JOIN trains t ON t.id = tr.train_id
    JOIN stations s ON s.id = tr.station_id
    LEFT JOIN states st ON st.state_id = s.state_id
    WHERE t.train_number = p_train_no OR t.id = p_train_no
    ORDER BY tr.stop_sequence ASC;
END$$
DELIMITER ;

-- 7. Stored Procedure 2: calculate_fare
DROP PROCEDURE IF EXISTS calculate_fare;
DELIMITER $$
CREATE PROCEDURE calculate_fare(
    IN p_distance_km INT,
    IN p_class_code VARCHAR(10),
    OUT p_base_fare DECIMAL(10,2),
    OUT p_total_fare DECIMAL(10,2)
)
BEGIN
    DECLARE v_base DECIMAL(10,2) DEFAULT 0.00;
    DECLARE v_res_fee DECIMAL(10,2) DEFAULT 0.00;
    DECLARE v_sf_fee DECIMAL(10,2) DEFAULT 0.00;
    DECLARE v_gst_pct DECIMAL(4,2) DEFAULT 0.00;
    DECLARE v_subtotal DECIMAL(10,2) DEFAULT 0.00;

    SELECT base_fare, reservation_fee, superfast_charge, gst_percent
      INTO v_base, v_res_fee, v_sf_fee, v_gst_pct
      FROM fares
     WHERE class_code = UPPER(p_class_code)
       AND p_distance_km >= min_distance_km
       AND (p_distance_km <= max_distance_km OR max_distance_km = 9999)
     LIMIT 1;

    -- If no slab matched, calculate fallback proportional rate
    IF v_base = 0.00 THEN
        SET v_base = CASE 
            WHEN UPPER(p_class_code) = '1A' THEN p_distance_km * 3.50
            WHEN UPPER(p_class_code) = '2A' THEN p_distance_km * 2.20
            WHEN UPPER(p_class_code) = '3A' THEN p_distance_km * 1.50
            WHEN UPPER(p_class_code) = 'CC' THEN p_distance_km * 1.20
            WHEN UPPER(p_class_code) = 'SL' THEN p_distance_km * 0.50
            ELSE p_distance_km * 0.35
        END;
        SET v_res_fee = 40.00;
        SET v_sf_fee = 30.00;
        SET v_gst_pct = CASE WHEN UPPER(p_class_code) IN ('SL', '2S') THEN 0.00 ELSE 5.00 END;
    END IF;

    SET v_subtotal = v_base + v_res_fee + v_sf_fee;
    SET p_base_fare = ROUND(v_base, 2);
    SET p_total_fare = ROUND(v_subtotal * (1 + (v_gst_pct / 100.0)), 0);
END$$
DELIMITER ;

-- 8. Stored Procedure 3: get_train_availability
DROP PROCEDURE IF EXISTS get_train_availability;
DELIMITER $$
CREATE PROCEDURE get_train_availability(
    IN p_train_no VARCHAR(10),
    IN p_date DATE,
    IN p_class VARCHAR(10),
    IN p_quota VARCHAR(5)
)
BEGIN
    SELECT 
        t.train_number,
        t.train_name,
        a.journey_date,
        a.class_code,
        a.quota_code,
        a.available_seats,
        a.rac_seats,
        a.waiting_seats,
        a.status,
        a.confirmation_probability,
        CASE 
            WHEN a.status = 'AVAILABLE' THEN CONCAT('AVAILABLE-', a.available_seats)
            WHEN a.status = 'RAC' THEN CONCAT('RAC-', a.rac_seats)
            WHEN a.status = 'WL' THEN CONCAT(a.quota_code, 'WL-', a.waiting_seats)
            ELSE 'REGRET'
        END AS formatted_status,
        a.updated_at
    FROM availability_snapshots a
    JOIN trains t ON t.id = a.train_id
    WHERE (t.train_number = p_train_no OR t.id = p_train_no)
      AND a.journey_date = p_date
      AND a.class_code = UPPER(p_class)
      AND a.quota_code = UPPER(p_quota)
    LIMIT 1;
END$$
DELIMITER ;

-- 9. Stored Procedure 4: get_available_seats
DROP PROCEDURE IF EXISTS get_available_seats;
DELIMITER $$
CREATE PROCEDURE get_available_seats(
    IN p_train_no VARCHAR(10),
    IN p_date DATE,
    IN p_quota VARCHAR(5)
)
BEGIN
    SELECT 
        tc.class_code,
        COALESCE(c.class_name, tc.class_code) AS class_name,
        tc.base_fare,
        COALESCE(a.available_seats, tc.available_seats) AS available_seats,
        COALESCE(a.rac_seats, 0) AS rac_seats,
        COALESCE(a.waiting_seats, 0) AS waiting_seats,
        COALESCE(a.status, CASE WHEN tc.available_seats > 0 THEN 'AVAILABLE' ELSE 'WL' END) AS status,
        COALESCE(a.confirmation_probability, 100) AS confirmation_probability,
        CASE 
            WHEN a.status = 'AVAILABLE' THEN CONCAT('AVAILABLE-', a.available_seats)
            WHEN a.status = 'RAC' THEN CONCAT('RAC-', a.rac_seats)
            WHEN a.status = 'WL' THEN CONCAT(UPPER(p_quota), 'WL-', a.waiting_seats)
            WHEN a.status IS NULL AND tc.available_seats > 0 THEN CONCAT('AVAILABLE-', tc.available_seats)
            ELSE 'WL-10'
        END AS formatted_status
    FROM train_classes tc
    JOIN trains t ON t.id = tc.train_id
    LEFT JOIN classes c ON c.class_code = tc.class_code
    LEFT JOIN availability_snapshots a ON a.train_id = t.id 
        AND a.class_code = tc.class_code 
        AND a.journey_date = p_date 
        AND a.quota_code = UPPER(p_quota)
    WHERE t.train_number = p_train_no OR t.id = p_train_no;
END$$
DELIMITER ;

-- 10. Triggers: Safety & Audit
DROP TRIGGER IF EXISTS trg_prevent_negative_seats;
DELIMITER $$
CREATE TRIGGER trg_prevent_negative_seats
BEFORE UPDATE ON availability_snapshots
FOR EACH ROW
BEGIN
    IF NEW.available_seats < 0 OR NEW.rac_seats < 0 OR NEW.waiting_seats < 0 THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Seat availability counts cannot be negative';
    END IF;
END$$
DELIMITER ;

DROP TRIGGER IF EXISTS trg_log_availability_changes;
DELIMITER $$
CREATE TRIGGER trg_log_availability_changes
AFTER UPDATE ON availability_snapshots
FOR EACH ROW
BEGIN
    IF NEW.available_seats <> OLD.available_seats THEN
        INSERT INTO availability_history (
            snapshot_id, 
            old_available_seats, 
            new_available_seats, 
            change_type, 
            changed_at
        ) VALUES (
            OLD.id, 
            OLD.available_seats, 
            NEW.available_seats, 
            'AVAILABILITY_UPDATE', 
            CURRENT_TIMESTAMP
        );
    END IF;
END$$
DELIMITER ;
