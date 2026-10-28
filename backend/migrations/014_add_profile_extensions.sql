-- 014_add_profile_extensions.sql
-- Add emergency contact details and preferred coach class to user_profiles

ALTER TABLE user_profiles
    ADD COLUMN emergency_contact_name VARCHAR(100) NULL AFTER gender,
    ADD COLUMN emergency_contact_phone VARCHAR(20) NULL AFTER emergency_contact_name,
    ADD COLUMN preferred_class VARCHAR(50) NULL DEFAULT 'No Preference' AFTER berth_preference;



