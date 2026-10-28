-- 007_create_audit_trigger.sql
-- Audit table and triggers for tracking railway master data changes

CREATE TABLE IF NOT EXISTS railway_audit_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    operation VARCHAR(10) NOT NULL,
    table_name VARCHAR(50) NOT NULL,
    record_identifier VARCHAR(100) NOT NULL,
    details JSON NULL,
    performed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Station triggers
DROP TRIGGER IF EXISTS trg_stations_audit_insert;
DELIMITER $$
CREATE TRIGGER trg_stations_audit_insert
AFTER INSERT ON stations
FOR EACH ROW
BEGIN
    INSERT INTO railway_audit_logs (operation, table_name, record_identifier, details)
    VALUES ('INSERT', 'stations', NEW.station_code, JSON_OBJECT('id', NEW.id, 'code', NEW.station_code, 'name', NEW.station_name, 'city', NEW.city));
END$$
DELIMITER ;

DROP TRIGGER IF EXISTS trg_stations_audit_update;
DELIMITER $$
CREATE TRIGGER trg_stations_audit_update
AFTER UPDATE ON stations
FOR EACH ROW
BEGIN
    INSERT INTO railway_audit_logs (operation, table_name, record_identifier, details)
    VALUES ('UPDATE', 'stations', NEW.station_code, JSON_OBJECT('old_name', OLD.station_name, 'new_name', NEW.station_name, 'status', NEW.status));
END$$
DELIMITER ;

DROP TRIGGER IF EXISTS trg_stations_audit_delete;
DELIMITER $$
CREATE TRIGGER trg_stations_audit_delete
AFTER DELETE ON stations
FOR EACH ROW
BEGIN
    INSERT INTO railway_audit_logs (operation, table_name, record_identifier, details)
    VALUES ('DELETE', 'stations', OLD.station_code, JSON_OBJECT('id', OLD.id, 'name', OLD.station_name));
END$$
DELIMITER ;

-- Train triggers
DROP TRIGGER IF EXISTS trg_trains_audit_insert;
DELIMITER $$
CREATE TRIGGER trg_trains_audit_insert
AFTER INSERT ON trains
FOR EACH ROW
BEGIN
    INSERT INTO railway_audit_logs (operation, table_name, record_identifier, details)
    VALUES ('INSERT', 'trains', NEW.train_number, JSON_OBJECT('id', NEW.id, 'number', NEW.train_number, 'name', NEW.train_name, 'type', NEW.train_type));
END$$
DELIMITER ;

DROP TRIGGER IF EXISTS trg_trains_audit_update;
DELIMITER $$
CREATE TRIGGER trg_trains_audit_update
AFTER UPDATE ON trains
FOR EACH ROW
BEGIN
    INSERT INTO railway_audit_logs (operation, table_name, record_identifier, details)
    VALUES ('UPDATE', 'trains', NEW.train_number, JSON_OBJECT('old_name', OLD.train_name, 'new_name', NEW.train_name, 'status', NEW.status));
END$$
DELIMITER ;

DROP TRIGGER IF EXISTS trg_trains_audit_delete;
DELIMITER $$
CREATE TRIGGER trg_trains_audit_delete
AFTER DELETE ON trains
FOR EACH ROW
BEGIN
    INSERT INTO railway_audit_logs (operation, table_name, record_identifier, details)
    VALUES ('DELETE', 'trains', OLD.train_number, JSON_OBJECT('id', OLD.id, 'name', OLD.train_name));
END$$
DELIMITER ;

-- Train Routes triggers
DROP TRIGGER IF EXISTS trg_routes_audit_insert;
DELIMITER $$
CREATE TRIGGER trg_routes_audit_insert
AFTER INSERT ON train_routes
FOR EACH ROW
BEGIN
    INSERT INTO railway_audit_logs (operation, table_name, record_identifier, details)
    VALUES ('INSERT', 'train_routes', CONCAT('train_', NEW.train_id, '_stop_', NEW.stop_sequence), JSON_OBJECT('train_id', NEW.train_id, 'station_id', NEW.station_id, 'sequence', NEW.stop_sequence));
END$$
DELIMITER ;

DROP TRIGGER IF EXISTS trg_routes_audit_update;
DELIMITER $$
CREATE TRIGGER trg_routes_audit_update
AFTER UPDATE ON train_routes
FOR EACH ROW
BEGIN
    INSERT INTO railway_audit_logs (operation, table_name, record_identifier, details)
    VALUES ('UPDATE', 'train_routes', CONCAT('train_', NEW.train_id, '_stop_', NEW.stop_sequence), JSON_OBJECT('arrival', NEW.arrival_time, 'departure', NEW.departure_time));
END$$
DELIMITER ;

DROP TRIGGER IF EXISTS trg_routes_audit_delete;
DELIMITER $$
CREATE TRIGGER trg_routes_audit_delete
AFTER DELETE ON train_routes
FOR EACH ROW
BEGIN
    INSERT INTO railway_audit_logs (operation, table_name, record_identifier, details)
    VALUES ('DELETE', 'train_routes', CONCAT('train_', OLD.train_id, '_stop_', OLD.stop_sequence), JSON_OBJECT('train_id', OLD.train_id, 'station_id', OLD.station_id));
END$$
DELIMITER ;
