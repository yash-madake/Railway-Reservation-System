-- Team 7: Admin, analytics, audit and reporting foundation.
CREATE TABLE IF NOT EXISTS bookings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  pnr VARCHAR(20) NOT NULL UNIQUE,
  user_id INT NULL,
  train_id INT NULL,
  origin_code VARCHAR(10) NOT NULL,
  destination_code VARCHAR(10) NOT NULL,
  journey_date DATE NOT NULL,
  travel_class VARCHAR(10) NOT NULL DEFAULT 'SL',
  passengers INT NOT NULL DEFAULT 1,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  status ENUM('CONFIRMED','RAC','WAITLISTED','CANCELLED') NOT NULL DEFAULT 'CONFIRMED',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_booking_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_booking_train FOREIGN KEY (train_id) REFERENCES trains(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  booking_id INT NULL,
  transaction_id VARCHAR(60) NOT NULL UNIQUE,
  amount DECIMAL(12,2) NOT NULL,
  status ENUM('SUCCESS','FAILED','REFUNDED','PENDING') NOT NULL DEFAULT 'SUCCESS',
  method VARCHAR(30) NOT NULL DEFAULT 'UPI',
  paid_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_payment_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cancellations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  booking_id INT NULL,
  reason VARCHAR(255) NULL,
  refund_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  status ENUM('REQUESTED','PROCESSED','REJECTED') NOT NULL DEFAULT 'PROCESSED',
  cancelled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cancel_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  actor_user_id INT NULL,
  action VARCHAR(40) NOT NULL,
  module VARCHAR(60) NOT NULL,
  record_id VARCHAR(100) NULL,
  status ENUM('SUCCESS','FAILED') NOT NULL DEFAULT 'SUCCESS',
  ip_address VARCHAR(45) NULL,
  details JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_created (created_at),
  INDEX idx_audit_module_action (module, action),
  INDEX idx_audit_actor (actor_user_id),
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS api_request_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  method VARCHAR(10) NOT NULL,
  path VARCHAR(255) NOT NULL,
  status_code INT NOT NULL,
  duration_ms INT NOT NULL,
  user_id INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_api_created (created_at),
  INDEX idx_api_status (status_code),
  INDEX idx_api_duration (duration_ms)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_bookings_journey_status ON bookings(journey_date, status);
CREATE INDEX idx_bookings_user_created ON bookings(user_id, created_at);
CREATE INDEX idx_bookings_route_date ON bookings(origin_code, destination_code, journey_date);
CREATE INDEX idx_payments_status_date ON payments(status, created_at);
CREATE INDEX idx_cancellations_date_status ON cancellations(cancelled_at, status);

CREATE OR REPLACE VIEW v_booking_summary AS
SELECT b.id, b.pnr, b.journey_date, b.origin_code, b.destination_code, b.travel_class,
       b.passengers, b.amount, b.status, b.created_at,
       u.full_name AS passenger_name, u.email AS passenger_email,
       t.train_number, t.train_name
FROM bookings b
LEFT JOIN users u ON u.id = b.user_id
LEFT JOIN trains t ON t.id = b.train_id;

CREATE OR REPLACE VIEW v_revenue_daily AS
SELECT DATE(COALESCE(p.paid_at, p.created_at)) AS revenue_date,
       SUM(CASE WHEN p.status = 'SUCCESS' THEN p.amount ELSE 0 END) AS revenue,
       COUNT(CASE WHEN p.status = 'SUCCESS' THEN 1 END) AS successful_payments
FROM payments p
GROUP BY DATE(COALESCE(p.paid_at, p.created_at));

CREATE OR REPLACE VIEW v_train_occupancy AS
SELECT t.id AS train_id, t.train_number, t.train_name,
       COALESCE(SUM(CASE WHEN b.status <> 'CANCELLED' THEN b.passengers ELSE 0 END), 0) AS booked_passengers,
       COALESCE(SUM(tc.total_seats), 0) AS total_seats,
       CASE WHEN COALESCE(SUM(tc.total_seats), 0) = 0 THEN 0
            ELSE ROUND(100 * SUM(CASE WHEN b.status <> 'CANCELLED' THEN b.passengers ELSE 0 END) / SUM(tc.total_seats), 2) END AS occupancy_pct
FROM trains t
LEFT JOIN train_classes tc ON tc.train_id = t.id
LEFT JOIN bookings b ON b.train_id = t.id AND b.journey_date >= CURRENT_DATE()
GROUP BY t.id, t.train_number, t.train_name;

CREATE OR REPLACE VIEW v_user_activity AS
SELECT u.id AS user_id, u.full_name, u.email, u.role, u.status,
       COUNT(b.id) AS booking_count,
       COALESCE(SUM(CASE WHEN b.status <> 'CANCELLED' THEN b.amount ELSE 0 END),0) AS booking_value,
       MAX(b.created_at) AS last_booking_at
FROM users u LEFT JOIN bookings b ON b.user_id = u.id
GROUP BY u.id, u.full_name, u.email, u.role, u.status;

DROP FUNCTION IF EXISTS get_dashboard_statistics;
DROP FUNCTION IF EXISTS get_daily_revenue;
DROP FUNCTION IF EXISTS get_popular_routes;
DROP FUNCTION IF EXISTS get_train_occupancy;

DELIMITER $$
CREATE FUNCTION get_dashboard_statistics()
RETURNS JSON
READS SQL DATA
BEGIN
  DECLARE result JSON;
  SELECT JSON_OBJECT(
    'users', (SELECT COUNT(*) FROM users),
    'active_trains', (SELECT COUNT(*) FROM trains WHERE status='active'),
    'today_bookings', (SELECT COUNT(*) FROM bookings WHERE DATE(created_at)=CURRENT_DATE()),
    'today_revenue', (SELECT COALESCE(SUM(amount),0) FROM payments WHERE status='SUCCESS' AND DATE(COALESCE(paid_at,created_at))=CURRENT_DATE()),
    'today_cancellations', (SELECT COUNT(*) FROM cancellations WHERE DATE(cancelled_at)=CURRENT_DATE()),
    'api_errors_24h', (SELECT COUNT(*) FROM api_request_logs WHERE created_at >= NOW() - INTERVAL 1 DAY AND status_code >= 500)
  ) INTO result;
  RETURN result;
END$$

CREATE FUNCTION get_daily_revenue(p_days INT)
RETURNS JSON
READS SQL DATA
BEGIN
  DECLARE result JSON;
  SELECT JSON_ARRAYAGG(JSON_OBJECT('date', revenue_date, 'revenue', revenue, 'payments', successful_payments)) INTO result
  FROM (SELECT revenue_date, revenue, successful_payments FROM v_revenue_daily WHERE revenue_date >= CURRENT_DATE() - INTERVAL p_days DAY ORDER BY revenue_date) x;
  RETURN COALESCE(result, JSON_ARRAY());
END$$

CREATE FUNCTION get_popular_routes(p_limit INT)
RETURNS JSON
READS SQL DATA
BEGIN
  DECLARE result JSON;
  SELECT JSON_ARRAYAGG(JSON_OBJECT('origin', origin_code, 'destination', destination_code, 'bookings', bookings, 'revenue', revenue)) INTO result
  FROM (SELECT origin_code, destination_code, COUNT(*) bookings, SUM(amount) revenue FROM bookings WHERE status <> 'CANCELLED' GROUP BY origin_code, destination_code ORDER BY bookings DESC LIMIT p_limit) x;
  RETURN COALESCE(result, JSON_ARRAY());
END$$

CREATE FUNCTION get_train_occupancy(p_limit INT)
RETURNS JSON
READS SQL DATA
BEGIN
  DECLARE result JSON;
  SELECT JSON_ARRAYAGG(JSON_OBJECT('trainNumber', train_number, 'trainName', train_name, 'bookedPassengers', booked_passengers, 'totalSeats', total_seats, 'occupancyPct', occupancy_pct)) INTO result
  FROM (SELECT train_number, train_name, booked_passengers, total_seats, occupancy_pct FROM v_train_occupancy ORDER BY occupancy_pct DESC LIMIT p_limit) x;
  RETURN COALESCE(result, JSON_ARRAY());
END$$
DELIMITER ;
