
CREATE TABLE IF NOT EXISTS defence_candidates (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    first_name VARCHAR(80) NOT NULL,
    last_name VARCHAR(80) NOT NULL,
    defence_id CHAR(12)
        CHARACTER SET ascii
        COLLATE ascii_bin NOT NULL,

    verification_status ENUM(
        'pending',
        'verified',
        'rejected'
    ) NOT NULL DEFAULT 'pending',

    verified_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_defence_id (defence_id),

    CONSTRAINT chk_defence_id_format
        CHECK (defence_id REGEXP '^[0-9]{12}$')
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;