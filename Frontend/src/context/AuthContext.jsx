import React, { createContext, useContext, useState, useEffect, } from "react";
import authFetch from "../utils/authFetch";
const API_URL = "http://localhost:5000/api/v1/auth";
const PROFILE_URL = "http://localhost:5000/api/v1/users/profile";
const AuthContext = createContext(undefined);

// POST a JSON body to /auth/<path> and read the JSON reply. Throws a readable
// Error when the server cannot be reached or answers with something that is
// not JSON; the caller decides what a non-2xx reply means.
const postAuth = async (path, body) => {
    let response;
    try {
        response = await fetch(`${API_URL}${path}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
        });
    }
    catch {
        throw new Error("Cannot connect to the server. Check that the backend is running.");
    }
    let result;
    try {
        result = await response.json();
    }
    catch {
        throw new Error(`The server returned an unreadable response (HTTP ${response.status}).`);
    }
    return { response, result };
};

// An Error that also carries the machine-readable fields the backend sends,
// so a page can react to e.g. EMAIL_NOT_VERIFIED instead of matching text.
const apiError = (response, result, fallback) => {
    const error = new Error(result.message || fallback);
    error.status = response.status;
    error.code = result.code;
    error.email = result.email;
    error.attemptsLeft = result.attemptsLeft;
    error.retryAfterSeconds = result.retryAfterSeconds;
    return error;
};

export function AuthProvider({ children, }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    // Restore the saved user when the application starts
    useEffect(() => {
        const storedUser = localStorage.getItem("railconnect_user");
        const storedToken = localStorage.getItem("railsetu_token");
        if (storedUser && storedToken) {
            try {
                setUser(JSON.parse(storedUser));
            }
            catch {
                localStorage.removeItem("railconnect_user");
                localStorage.removeItem("railsetu_token");
            }
        }
        else {
            // A user without a token is not considered logged in
            localStorage.removeItem("railconnect_user");
            localStorage.removeItem("railsetu_token");
        }
        setLoading(false);
    }, []);

    // Save the token and user the backend returned, and mark the user as
    // logged in. Shared by login and by email verification (which logs the
    // user straight in).
    const startSession = (result) => {
        if (!result.token || !result.data) {
            throw new Error("Login failed: The server returned an invalid response.");
        }
        const loggedInUser = {
            id: String(result.data.id),
            name: result.data.name,
            email: result.data.email,
            role: result.data.role || "passenger",
            phone: result.data.phone || "",
            createdAt: result.data.createdAt || result.data.created_at || "",
            created_at: result.data.created_at || result.data.createdAt || "",
        };
        // Store the JWT and user information
        localStorage.setItem("railsetu_token", result.token);
        localStorage.setItem("railconnect_user", JSON.stringify(loggedInUser));
        setUser(loggedInUser);
        return loggedInUser;
    };

    // LOGIN
    // Throws an Error whose `code` is "EMAIL_NOT_VERIFIED" (and whose `email`
    // is the account's address) when the password is right but the email has
    // not been confirmed yet.
    const login = async (email, password) => {
        const { response, result } = await postAuth("/login", {
            email: email.trim(),
            password,
        });
        if (!response.ok) {
            throw apiError(response, result, "Login failed.");
        }
        startSession(result);
    };

    // REGISTER
    // Creates the account and emails a 6-digit code. Resolves with
    //   { requiresVerification, emailSent, email, message }
    // The user is NOT logged in until verifyEmail() succeeds.
    const register = async (data) => {
        const { response, result } = await postAuth("/register", {
            name: data.name,
            email: data.email,
            phone: data.phone,
            password: data.password,
        });
        if (!response.ok) {
            throw apiError(response, result, `Registration failed with HTTP ${response.status}.`);
        }
        return {
            requiresVerification: result.requiresVerification === true,
            emailSent: result.emailSent !== false,
            email: result.data?.email || data.email.trim().toLowerCase(),
            message: result.message || "",
        };
    };

    // VERIFY EMAIL
    // Checks the 6-digit code. On success the user is logged in. Errors carry
    // `code` (OTP_INCORRECT, OTP_EXPIRED, OTP_TOO_MANY_ATTEMPTS, ...) and
    // `attemptsLeft`.
    const verifyEmail = async (email, otp) => {
        const { response, result } = await postAuth("/verify-otp", {
            email: email.trim(),
            otp,
        });
        if (!response.ok) {
            throw apiError(response, result, "Verification failed.");
        }
        if (result.alreadyVerified) {
            return { alreadyVerified: true };
        }
        startSession(result);
        return { alreadyVerified: false };
    };

    // RESEND VERIFICATION CODE
    // Resolves with { retryAfterSeconds }. A 429 error carries
    // `retryAfterSeconds` so the page can show the wait.
    const resendOtp = async (email) => {
        const { response, result } = await postAuth("/resend-otp", {
            email: email.trim(),
        });
        if (!response.ok) {
            throw apiError(response, result, "Could not resend the code.");
        }
        return {
            retryAfterSeconds: result.retryAfterSeconds ?? 60,
            message: result.message || "",
        };
    };

    // GET PROTECTED PROFILE
    const getProfile = async () => {
        let response;
        try {
            response = await authFetch(PROFILE_URL);
        }
        catch {
            throw new Error("Cannot connect to the server while retrieving your profile.");
        }
        let result;
        try {
            result = await response.json();
        }
        catch {
            throw new Error(`The server returned an unreadable response (HTTP ${response.status}).`);
        }
        if (!response.ok) {
            throw new Error(result.message || "Failed to retrieve your profile.");
        }
        if (result.user) {
            const updatedUser = {
                ...result.user,
                id: String(result.user.id),
                name: result.user.name || result.user.full_name,
                email: result.user.email,
                role: result.user.role || "passenger",
                phone: result.user.phone || "",
                createdAt: result.user.createdAt || result.user.created_at || "",
                created_at: result.user.created_at || result.user.createdAt || "",
            };
            localStorage.setItem("railconnect_user", JSON.stringify(updatedUser));
            setUser(updatedUser);
        }
        return result;
    };
    // UPDATE PROTECTED PROFILE
    const updateProfile = async (profileData) => {
        let response;
        try {
            response = await authFetch(PROFILE_URL, {
                method: "PUT",
                body: JSON.stringify(profileData),
            });
        }
        catch {
            throw new Error("Cannot connect to the server while updating your profile.");
        }
        let result;
        try {
            result = await response.json();
        }
        catch {
            throw new Error(`The server returned an unreadable response (HTTP ${response.status}).`);
        }
        if (!response.ok) {
            throw new Error(result.message || "Failed to update your profile.");
        }
        if (result.user) {
            const updatedUser = {
                ...result.user,
                id: String(result.user.id),
                name: result.user.name || result.user.full_name,
                email: result.user.email,
                role: result.user.role || "passenger",
                phone: result.user.phone || "",
                createdAt: result.user.createdAt || result.user.created_at || "",
                created_at: result.user.created_at || result.user.createdAt || "",
            };
            localStorage.setItem("railconnect_user", JSON.stringify(updatedUser));
            setUser(updatedUser);
        }
        return result;
    };
    // LOGOUT
    const logout = () => {
        setUser(null);
        localStorage.removeItem("railconnect_user");
        localStorage.removeItem("railsetu_token");
    };
    // Context value
    const value = {
        user,
        isAuthenticated: !!user,
        isAdmin: user?.role === "admin",
        login,
        register,
        verifyEmail,
        resendOtp,
        getProfile,
        updateProfile,
        logout,
        loading,
    };
    return (<AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>);
}
// Custom hook
export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error("useAuth must be used within an AuthProvider");
    }
    return context;
};