import React, { createContext, useContext, useState, useEffect, } from "react";
import authFetch from "../utils/authFetch";
const API_URL = "http://localhost:5000/api/v1/auth";
const PROFILE_URL = "http://localhost:5000/api/v1/users/profile";
const AuthContext = createContext(undefined);
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
    // LOGIN
    const login = async (email, password) => {
        let response;
        try {
            response = await fetch(`${API_URL}/login`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    email: email.trim(),
                    password,
                }),
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
        if (!response.ok) {
            throw new Error(result.message || "Login failed.");
        }
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
    // REGISTER
    const register = async (data) => {
        let response;
        try {
            response = await fetch(`${API_URL}/register`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    name: data.name,
                    email: data.email,
                    phone: data.phone,
                    password: data.password,
                }),
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
        if (!response.ok) {
            throw new Error(result.message ||
                `Registration failed with HTTP ${response.status}.`);
        }
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
        getProfile,
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
