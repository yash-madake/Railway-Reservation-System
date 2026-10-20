
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../config/db");
const otpService = require("../services/otpService");

// Shared by login and by OTP verification (which logs the user straight in).
const signToken = (user) =>
    jwt.sign(
        {
            id: user.id,
            email: user.email,
            role: user.role
        },
        process.env.JWT_SECRET,
        {
            expiresIn: "1d"
        }
    );

const isVerified = (user) => Number(user.is_email_verified) === 1;

// REGISTER USER
const registerUser = async (req, res) => {
    try {
        const { name, email, phone, password } = req.body;

        // 1. Validate required fields
        if (!name || !email || !phone || !password) {
            return res.status(400).json({
                message: "Registration failed: All fields are required."
            });
        }

        // 2. Normalize input
        const fullName = name.trim();
        const normalizedEmail = email.trim().toLowerCase();
        const normalizedPhone = phone.trim();

        // 3. Validate name
        if (fullName.length < 2) {
            return res.status(400).json({
                message: "Registration failed: Name must contain at least 2 characters."
            });
        }

        // 4. Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!emailRegex.test(normalizedEmail)) {
            return res.status(400).json({
                message: "Registration failed: Please enter a valid email address."
            });
        }

        // 5. Validate Indian mobile number
        if (!/^[0-9]{10}$/.test(normalizedPhone)) {
            return res.status(400).json({
                message: "Registration failed: Phone number must contain exactly 10 digits."
            });
        }

        // 6. Validate password length
        if (typeof password !== "string" || password.length < 8) {
            return res.status(400).json({
                message: "Registration failed: Password must contain at least 8 characters."
            });
        }

        // 7. Check whether email or phone already exists
        const [existingUsers] = await pool.query(
            `SELECT id, email, phone, is_email_verified
             FROM users
             WHERE email = ? OR phone = ?`,
            [normalizedEmail, normalizedPhone]
        );

        // 7a. A VERIFIED account owns its email and phone, so those are taken.
        const verifiedUsers = existingUsers.filter(isVerified);

        if (verifiedUsers.some((u) => u.email === normalizedEmail)) {
            return res.status(409).json({
                message: "Registration failed: This email address is already registered."
            });
        }

        if (verifiedUsers.some((u) => u.phone === normalizedPhone)) {
            return res.status(409).json({
                message: "Registration failed: This phone number is already registered."
            });
        }

        // 7b. An UNVERIFIED account is a sign-up nobody ever confirmed (for
        //     example a mistyped email). It has never been usable, so it must
        //     not block the email or phone forever: clear it and start again.
        const staleIds = existingUsers
            .filter((u) => !isVerified(u))
            .map((u) => u.id);

        if (staleIds.length > 0) {
            await pool.query(
                "DELETE FROM email_otps WHERE user_id IN (?)",
                [staleIds]
            );
            await pool.query(
                "DELETE FROM users WHERE id IN (?) AND is_email_verified = 0",
                [staleIds]
            );
        }

        // 8. Hash password before storing it
        const hashedPassword = await bcrypt.hash(password, 10);

        // 9. Insert user into database. Not verified until the emailed code
        //    has been entered.
        const [result] = await pool.query(
            `INSERT INTO users
                (full_name, email, phone, password, is_email_verified)
             VALUES (?, ?, ?, ?, 0)`,
            [
                fullName,
                normalizedEmail,
                normalizedPhone,
                hashedPassword
            ]
        );

        // 10. Email the verification code
        let emailSent = true;

        try {
            await otpService.issueAndSendOtp({
                userId: result.insertId,
                email: normalizedEmail,
                name: fullName
            });
        } catch (mailError) {
            emailSent = false;
            console.error("Verification email error:", mailError);
        }

        // 11. Return successful response
        return res.status(201).json({
            message: emailSent
                ? "Registration successful. We have sent a 6-digit verification code to your email."
                : "Your account was created, but we could not send the verification email. Please use Resend code.",
            requiresVerification: true,
            emailSent,
            data: {
                id: result.insertId,
                name: fullName,
                email: normalizedEmail,
                phone: normalizedPhone
            }
        });

    } catch (error) {
        // Log the detailed error on the backend
        console.error("Registration error:", error);

        // Handle duplicate-entry errors, including concurrent requests
        if (error.code === "ER_DUP_ENTRY") {
            const duplicateInfo =
                `${error.sqlMessage || ""} ${error.message || ""}`
                    .toLowerCase();

            if (duplicateInfo.includes("email")) {
                return res.status(409).json({
                    message: "Registration failed: This email address is already registered."
                });
            }

            if (duplicateInfo.includes("phone")) {
                return res.status(409).json({
                    message: "Registration failed: This phone number is already registered."
                });
            }

            return res.status(409).json({
                message: "Registration failed: An account with these details already exists."
            });
        }

        // Database connection or configuration errors
        if (
            error.code === "ECONNREFUSED" ||
            error.code === "ETIMEDOUT"
        ) {
            return res.status(503).json({
                message: "Registration is temporarily unavailable because the database cannot be reached. Please try again later."
            });
        }

        if (error.code === "ER_ACCESS_DENIED_ERROR") {
            return res.status(500).json({
                message: "Registration failed because the server cannot access the database. Please contact the administrator."
            });
        }

        if (error.code === "ER_BAD_DB_ERROR") {
            return res.status(500).json({
                message: "Registration failed because the application database is not configured correctly."
            });
        }

        if (error.code === "ER_NO_SUCH_TABLE") {
            return res.status(500).json({
                message: "Registration failed because a required database table is missing."
            });
        }

        // Generic fallback for unexpected errors
        return res.status(500).json({
            message: "Registration failed because of an unexpected server error. Please try again later."
        });
    }
};


// LOGIN USER
const loginUser = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                message: "Email and password are required."
            });
        }

        const normalizedEmail = email.trim().toLowerCase();

        const [users] = await pool.query(
            "SELECT * FROM users WHERE email = ?",
            [normalizedEmail]
        );

        if (users.length === 0) {
            return res.status(401).json({
                message: "Invalid email or password."
            });
        }

        const user = users[0];

        const passwordMatch = await bcrypt.compare(
            password,
            user.password
        );

        if (!passwordMatch) {
            return res.status(401).json({
                message: "Invalid email or password."
            });
        }

        // The password is right, but the email has never been confirmed.
        // Checked only after the password so this response cannot be used to
        // find out which emails have accounts.
        if (Number(user.is_email_verified) === 0) {
            return res.status(403).json({
                message: "Please verify your email address before logging in.",
                code: "EMAIL_NOT_VERIFIED",
                email: user.email
            });
        }

        // Ensure JWT secret is configured
        if (!process.env.JWT_SECRET) {
            console.error("Login error: JWT_SECRET is not configured.");

            return res.status(500).json({
                message: "Login is temporarily unavailable because of a server configuration error."
            });
        }

        // Generate JWT
        const token = signToken(user);

        return res.status(200).json({
            message: "Login successful.",
            token,
            data: {
                id: user.id,
                name: user.full_name,
                email: user.email,
                phone: user.phone,
                role: user.role
            }
        });

    } catch (error) {
        console.error("Login error:", error);

        return res.status(500).json({
            message: "Login failed because of an unexpected server error. Please try again later."
        });
    }
};


// VERIFY EMAIL WITH OTP  (POST /auth/verify-otp  { email, otp })
const verifyOtp = async (req, res) => {
    try {
        const { email, otp } = req.body;

        if (typeof email !== "string" || !email.trim() || otp === undefined || otp === null) {
            return res.status(400).json({
                message: "Email and verification code are required."
            });
        }

        const normalizedEmail = email.trim().toLowerCase();
        const code = String(otp).trim();

        if (!/^[0-9]{6}$/.test(code)) {
            return res.status(400).json({
                message: "The verification code must be exactly 6 digits.",
                code: "OTP_INVALID_FORMAT"
            });
        }

        if (!process.env.JWT_SECRET) {
            console.error("Verify error: JWT_SECRET is not configured.");

            return res.status(500).json({
                message: "Verification is temporarily unavailable because of a server configuration error."
            });
        }

        const [users] = await pool.query(
            "SELECT * FROM users WHERE email = ? LIMIT 1",
            [normalizedEmail]
        );

        if (users.length === 0) {
            return res.status(400).json({
                message: "Invalid or expired verification code.",
                code: "OTP_INVALID"
            });
        }

        const user = users[0];

        if (isVerified(user)) {
            return res.status(200).json({
                message: "This email is already verified. Please log in.",
                alreadyVerified: true
            });
        }

        const outcome = await otpService.verifyOtp(user.id, code);

        if (!outcome.ok) {
            switch (outcome.reason) {
                case "EXPIRED":
                    return res.status(400).json({
                        message: "This code has expired. Please request a new one.",
                        code: "OTP_EXPIRED"
                    });

                case "NO_OTP":
                    return res.status(400).json({
                        message: "No active verification code. Please request a new one.",
                        code: "OTP_NOT_FOUND"
                    });

                case "LOCKED":
                    return res.status(429).json({
                        message: "Too many incorrect attempts. Please request a new code.",
                        code: "OTP_TOO_MANY_ATTEMPTS"
                    });

                default:
                    return res.status(400).json({
                        message: `Incorrect verification code. ${outcome.attemptsLeft} attempt(s) left.`,
                        code: "OTP_INCORRECT",
                        attemptsLeft: outcome.attemptsLeft
                    });
            }
        }

        await pool.query(
            `UPDATE users
                SET is_email_verified = 1, email_verified_at = NOW()
              WHERE id = ?`,
            [user.id]
        );

        // Verified: log the user straight in.
        const token = signToken(user);

        return res.status(200).json({
            message: "Email verified successfully.",
            token,
            data: {
                id: user.id,
                name: user.full_name,
                email: user.email,
                phone: user.phone,
                role: user.role
            }
        });

    } catch (error) {
        console.error("Verify OTP error:", error);

        return res.status(500).json({
            message: "Verification failed because of an unexpected server error. Please try again later."
        });
    }
};


// RESEND VERIFICATION CODE  (POST /auth/resend-otp  { email })
const resendOtp = async (req, res) => {
    try {
        const { email } = req.body;

        if (typeof email !== "string" || !email.trim()) {
            return res.status(400).json({
                message: "Email is required."
            });
        }

        const normalizedEmail = email.trim().toLowerCase();

        // Same answer whether or not the email has an account, so this
        // endpoint cannot be used to discover who is registered.
        const genericReply = {
            message: "If this email is registered and not yet verified, a new code has been sent.",
            retryAfterSeconds: otpService.COOLDOWN_SECONDS
        };

        const [users] = await pool.query(
            "SELECT id, email, full_name, is_email_verified FROM users WHERE email = ? LIMIT 1",
            [normalizedEmail]
        );

        if (users.length === 0 || isVerified(users[0])) {
            return res.status(200).json(genericReply);
        }

        const user = users[0];

        const allowed = await otpService.checkSendAllowed(user.id);

        if (!allowed.allowed) {
            return res.status(429).json({
                message:
                    allowed.reason === "RESEND_COOLDOWN"
                        ? `Please wait ${allowed.retryAfterSeconds} seconds before requesting another code.`
                        : "Too many codes requested. Please try again later.",
                code: allowed.reason,
                retryAfterSeconds: allowed.retryAfterSeconds
            });
        }

        try {
            await otpService.issueAndSendOtp({
                userId: user.id,
                email: user.email,
                name: user.full_name
            });
        } catch (mailError) {
            console.error("Resend OTP email error:", mailError);

            return res.status(503).json({
                message: "We could not send the email right now. Please try again in a moment.",
                code: "EMAIL_SEND_FAILED"
            });
        }

        return res.status(200).json(genericReply);

    } catch (error) {
        console.error("Resend OTP error:", error);

        return res.status(500).json({
            message: "Could not resend the code because of an unexpected server error. Please try again later."
        });
    }
};


module.exports = {
    registerUser,
    loginUser,
    verifyOtp,
    resendOtp
};