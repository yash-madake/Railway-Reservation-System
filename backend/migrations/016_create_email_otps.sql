-- 016_create_email_otps.sql
-- Team 1: Email verification flags and OTP storage for passenger signup

SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'is_email_verified');
SET @alter_users = IF(@col_exists = 0, 'ALTER TABLE users ADD COLUMN is_email_verified TINYINT(1) NOT NULL DEFAULT 0 AFTER status, ADD COLUMN email_verified_at TIMESTAMP NULL DEFAULT NULL AFTER is_email_verified;', 'SELECT 1;');
PREPARE stmt_users FROM @alter_users;
EXECUTE stmt_users;
DEALLOCATE PREPARE stmt_users;

CREATE TABLE IF NOT EXISTS email_otps (
    user_id INT PRIMARY KEY,
    otp_hash VARCHAR(64) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    attempts INT NOT NULL DEFAULT 0,
    last_sent_at TIMESTAMP NULL DEFAULT NULL,
    resend_count INT NOT NULL DEFAULT 1,
    resend_window_start TIMESTAMP NULL DEFAULT NULL,
    CONSTRAINT fk_email_otps_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
