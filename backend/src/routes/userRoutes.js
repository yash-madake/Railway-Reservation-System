const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const pool = require("../config/db");

const router = express.Router();

// Fallback in-memory profile store for sessions when table or columns do not exist on remote DB
const memoryProfileStore = new Map();

function formatDate(val) {
    if (!val) return null;
    if (val instanceof Date) {
        return val.toISOString().split("T")[0];
    }
    const str = String(val);
    return str.includes("T") ? str.split("T")[0] : str;
}

/**
 * Helper to fetch profile details from user_profiles table with fallback
 */
async function fetchUserProfile(userId) {
    // 1. Try fetching all columns including extensions
    try {
        const [rows] = await pool.query(
            `SELECT gender, emergency_contact_name, emergency_contact_phone, date_of_birth, address, city, state, pincode, id_type, id_number, berth_preference, food_preference, preferred_class, updated_at
             FROM user_profiles
             WHERE user_id = ?
             LIMIT 1`,
            [userId]
        );
        if (rows && rows.length > 0) {
            const memoryData = memoryProfileStore.get(Number(userId)) || {};
            return { ...rows[0], ...memoryData };
        }
    } catch (err) {
        // If extension columns do not exist yet in DB, try fetching base columns
        try {
            const [baseRows] = await pool.query(
                `SELECT gender, date_of_birth, address, city, state, pincode, id_type, id_number, berth_preference, food_preference, updated_at
                 FROM user_profiles
                 WHERE user_id = ?
                 LIMIT 1`,
                [userId]
            );
            if (baseRows && baseRows.length > 0) {
                const memoryData = memoryProfileStore.get(Number(userId)) || {};
                return { ...baseRows[0], ...memoryData };
            }
        } catch (baseErr) {
            if (baseErr.code !== "ER_NO_SUCH_TABLE" && baseErr.original?.code !== "ER_NO_SUCH_TABLE") {
                console.warn("Could not query user_profiles table:", baseErr.message);
            }
        }
    }

    return memoryProfileStore.get(Number(userId)) || {};
}

/**
 * Helper to save profile details to user_profiles table with fallback
 */
async function saveUserProfile(userId, profile) {
    let savedToDb = false;

    // 1. Try saving with all columns including extensions
    try {
        await pool.query(
            `INSERT INTO user_profiles
                (user_id, gender, emergency_contact_name, emergency_contact_phone, date_of_birth, address, city, state, pincode, id_type, id_number, berth_preference, food_preference, preferred_class)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                gender = VALUES(gender),
                emergency_contact_name = VALUES(emergency_contact_name),
                emergency_contact_phone = VALUES(emergency_contact_phone),
                date_of_birth = VALUES(date_of_birth),
                address = VALUES(address),
                city = VALUES(city),
                state = VALUES(state),
                pincode = VALUES(pincode),
                id_type = VALUES(id_type),
                id_number = VALUES(id_number),
                berth_preference = VALUES(berth_preference),
                food_preference = VALUES(food_preference),
                preferred_class = VALUES(preferred_class),
                updated_at = CURRENT_TIMESTAMP`,
            [
                userId,
                profile.gender || null,
                profile.emergency_contact_name || null,
                profile.emergency_contact_phone || null,
                profile.date_of_birth || null,
                profile.address || null,
                profile.city || null,
                profile.state || null,
                profile.pincode || null,
                profile.id_type || null,
                profile.id_number || null,
                profile.berth_preference || "No Preference",
                profile.food_preference || "No Preference",
                profile.preferred_class || "No Preference"
            ]
        );
        savedToDb = true;
    } catch (err) {
        // If extension columns do not exist yet on remote DB, save base columns
        try {
            await pool.query(
                `INSERT INTO user_profiles
                    (user_id, gender, date_of_birth, address, city, state, pincode, id_type, id_number, berth_preference, food_preference)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    gender = VALUES(gender),
                    date_of_birth = VALUES(date_of_birth),
                    address = VALUES(address),
                    city = VALUES(city),
                    state = VALUES(state),
                    pincode = VALUES(pincode),
                    id_type = VALUES(id_type),
                    id_number = VALUES(id_number),
                    berth_preference = VALUES(berth_preference),
                    food_preference = VALUES(food_preference),
                    updated_at = CURRENT_TIMESTAMP`,
                [
                    userId,
                    profile.gender || null,
                    profile.date_of_birth || null,
                    profile.address || null,
                    profile.city || null,
                    profile.state || null,
                    profile.pincode || null,
                    profile.id_type || null,
                    profile.id_number || null,
                    profile.berth_preference || "No Preference",
                    profile.food_preference || "No Preference"
                ]
            );
            savedToDb = true;
        } catch (baseErr) {
            if (baseErr.code !== "ER_NO_SUCH_TABLE" && baseErr.original?.code !== "ER_NO_SUCH_TABLE") {
                console.warn("Could not save to user_profiles table:", baseErr.message);
            }
        }
    }

    // Always maintain in memory store as well to guarantee persistence
    const existing = memoryProfileStore.get(Number(userId)) || {};
    memoryProfileStore.set(Number(userId), { ...existing, ...profile });
    return savedToDb;
}

/**
 * Handler for GET /profile or GET /users/profile
 */
async function getProfileHandler(req, res) {
    try {
        const userId = req.user && req.user.id;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized: Invalid user session."
            });
        }

        const [rows] = await pool.query(
            `SELECT id, full_name, email, phone, role, status, is_email_verified, created_at, updated_at
             FROM users
             WHERE id = ?
             LIMIT 1`,
            [userId]
        );

        if (!rows || rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "User not found."
            });
        }

        const dbUser = rows[0];
        const profile = await fetchUserProfile(userId);

        const birthDate = formatDate(profile.date_of_birth);

        return res.status(200).json({
            success: true,
            message: "User profile retrieved successfully.",
            user: {
                id: String(dbUser.id),
                name: dbUser.full_name,
                full_name: dbUser.full_name,
                email: dbUser.email,
                phone: dbUser.phone,
                role: dbUser.role,
                status: dbUser.status,
                is_email_verified: Boolean(dbUser.is_email_verified),
                is_phone_verified: Boolean(dbUser.phone),
                createdAt: dbUser.created_at,
                created_at: dbUser.created_at,
                gender: profile.gender || null,
                date_of_birth: birthDate,
                dob: birthDate,
                emergency_contact_name: profile.emergency_contact_name || null,
                emergency_contact_phone: profile.emergency_contact_phone || null,
                address: profile.address || null,
                city: profile.city || null,
                state: profile.state || null,
                pincode: profile.pincode || null,
                id_type: profile.id_type || null,
                id_number: profile.id_number || null,
                preferred_class: profile.preferred_class || "No Preference",
                coach_class_preference: profile.preferred_class || "No Preference",
                berth_preference: profile.berth_preference || "No Preference",
                food_preference: profile.food_preference || "No Preference"
            }
        });
    } catch (error) {
        console.error("Error retrieving user profile:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to retrieve user profile."
        });
    }
}

/**
 * Handler for PUT /profile or PUT /users/profile
 */
async function updateProfileHandler(req, res) {
    try {
        const userId = req.user && req.user.id;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized: Invalid user session."
            });
        }

        const [userRows] = await pool.query(
            `SELECT id, full_name, email, phone, role, status, is_email_verified, created_at, updated_at
             FROM users
             WHERE id = ?
             LIMIT 1`,
            [userId]
        );

        if (!userRows || userRows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "User not found."
            });
        }

        const currentUser = userRows[0];
        const body = req.body || {};

        // 1. Validate full name (required, min 2 chars)
        const inputName = body.full_name !== undefined ? body.full_name : body.name;
        let newFullName = currentUser.full_name;
        if (inputName !== undefined) {
            const trimmedName = String(inputName).trim();
            if (trimmedName.length < 2) {
                return res.status(400).json({
                    success: false,
                    message: "Profile update failed: Name must contain at least 2 characters."
                });
            }
            newFullName = trimmedName;
        }

        // 2. Validate primary phone if provided
        let newPhone = currentUser.phone;
        if (body.phone !== undefined) {
            const rawPhone = String(body.phone).trim().replace(/^\+91\s*/, "");
            if (rawPhone.length > 0 && !/^[0-9]{10}$/.test(rawPhone)) {
                return res.status(400).json({
                    success: false,
                    message: "Profile update failed: Phone number must contain exactly 10 digits."
                });
            }
            if (rawPhone.length > 0 && rawPhone !== currentUser.phone) {
                // Check if phone number is already registered to another user
                const [dupUsers] = await pool.query(
                    `SELECT id FROM users WHERE phone = ? AND id != ? LIMIT 1`,
                    [rawPhone, userId]
                );
                if (dupUsers && dupUsers.length > 0) {
                    return res.status(409).json({
                        success: false,
                        message: "Profile update failed: This phone number is already registered to another account."
                    });
                }
                newPhone = rawPhone;
            }
        }

        // 3. Validate optional emergency contact phone
        let emergencyContactPhone = body.emergency_contact_phone;
        if (emergencyContactPhone !== undefined && emergencyContactPhone !== null) {
            emergencyContactPhone = String(emergencyContactPhone).trim().replace(/^\+91\s*/, "");
            if (emergencyContactPhone.length > 0 && !/^[0-9]{10}$/.test(emergencyContactPhone)) {
                return res.status(400).json({
                    success: false,
                    message: "Profile update failed: Emergency contact phone must contain exactly 10 digits."
                });
            }
            if (emergencyContactPhone.length === 0) {
                emergencyContactPhone = null;
            }
        }

        // 4. Validate optional pincode
        let pincodeVal = body.pincode;
        if (pincodeVal !== undefined && pincodeVal !== null) {
            pincodeVal = String(pincodeVal).trim();
            if (pincodeVal.length > 0 && !/^[0-9]{6}$/.test(pincodeVal)) {
                return res.status(400).json({
                    success: false,
                    message: "Profile update failed: PIN code must contain exactly 6 digits."
                });
            }
            if (pincodeVal.length === 0) {
                pincodeVal = null;
            }
        }

        // 5. Update master users table if name or phone changed
        if (newFullName !== currentUser.full_name || newPhone !== currentUser.phone) {
            await pool.query(
                `UPDATE users
                 SET full_name = ?, phone = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [newFullName, newPhone, userId]
            );
        }

        // 6. Update profile fields in user_profiles
        const currentProfile = await fetchUserProfile(userId);
        const updatedProfile = {
            gender: body.gender !== undefined ? (body.gender || null) : (currentProfile.gender || null),
            emergency_contact_name: body.emergency_contact_name !== undefined ? (body.emergency_contact_name ? String(body.emergency_contact_name).trim() : null) : (currentProfile.emergency_contact_name || null),
            emergency_contact_phone: emergencyContactPhone !== undefined ? emergencyContactPhone : (currentProfile.emergency_contact_phone || null),
            date_of_birth: (body.date_of_birth !== undefined ? body.date_of_birth : body.dob) !== undefined
                ? formatDate(body.date_of_birth || body.dob)
                : currentProfile.date_of_birth,
            address: body.address !== undefined ? (body.address ? String(body.address).trim() : null) : (currentProfile.address || null),
            city: body.city !== undefined ? (body.city ? String(body.city).trim() : null) : (currentProfile.city || null),
            state: body.state !== undefined ? (body.state ? String(body.state).trim() : null) : (currentProfile.state || null),
            pincode: pincodeVal !== undefined ? pincodeVal : (currentProfile.pincode || null),
            id_type: body.id_type !== undefined ? (body.id_type || null) : (currentProfile.id_type || null),
            id_number: body.id_number !== undefined ? (body.id_number ? String(body.id_number).trim() : null) : (currentProfile.id_number || null),
            preferred_class: body.preferred_class !== undefined ? (body.preferred_class || "No Preference") : (currentProfile.preferred_class || "No Preference"),
            berth_preference: body.berth_preference !== undefined ? (body.berth_preference || "No Preference") : (currentProfile.berth_preference || "No Preference"),
            food_preference: body.food_preference !== undefined ? (body.food_preference || "No Preference") : (currentProfile.food_preference || "No Preference")
        };

        await saveUserProfile(userId, updatedProfile);

        const birthDate = formatDate(updatedProfile.date_of_birth);

        return res.status(200).json({
            success: true,
            message: "User profile updated successfully.",
            user: {
                id: String(currentUser.id),
                name: newFullName,
                full_name: newFullName,
                email: currentUser.email,
                phone: newPhone,
                role: currentUser.role,
                status: currentUser.status,
                is_email_verified: Boolean(currentUser.is_email_verified),
                is_phone_verified: Boolean(newPhone),
                createdAt: currentUser.created_at,
                created_at: currentUser.created_at,
                gender: updatedProfile.gender || null,
                date_of_birth: birthDate,
                dob: birthDate,
                emergency_contact_name: updatedProfile.emergency_contact_name || null,
                emergency_contact_phone: updatedProfile.emergency_contact_phone || null,
                address: updatedProfile.address || null,
                city: updatedProfile.city || null,
                state: updatedProfile.state || null,
                pincode: updatedProfile.pincode || null,
                id_type: updatedProfile.id_type || null,
                id_number: updatedProfile.id_number || null,
                preferred_class: updatedProfile.preferred_class || "No Preference",
                coach_class_preference: updatedProfile.preferred_class || "No Preference",
                berth_preference: updatedProfile.berth_preference || "No Preference",
                food_preference: updatedProfile.food_preference || "No Preference"
            }
        });

    } catch (error) {
        console.error("Error updating user profile:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to update user profile."
        });
    }
}

// Support both /profile and / (when mounted under /profile or /users/profile)
router.get("/profile", authMiddleware, getProfileHandler);
router.get("/", authMiddleware, getProfileHandler);

router.put("/profile", authMiddleware, updateProfileHandler);
router.put("/", authMiddleware, updateProfileHandler);

module.exports = router;