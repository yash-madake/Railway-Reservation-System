-- 013_create_user_profiles.sql
-- Passenger profile details, address, government ID verification links, and travel preferences

CREATE TABLE IF NOT EXISTS user_profiles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL UNIQUE,
    gender ENUM('Male', 'Female', 'Transgender', 'Other') NULL,
    date_of_birth DATE NULL,
    address VARCHAR(255) NULL,
    city VARCHAR(100) NULL,
    state VARCHAR(100) NULL,
    pincode VARCHAR(10) NULL,
    id_type VARCHAR(50) NULL,
    id_number VARCHAR(100) NULL,
    berth_preference VARCHAR(50) NULL DEFAULT 'No Preference',
    food_preference VARCHAR(50) NULL DEFAULT 'Veg',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_user_profiles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
