import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
export function AdminRoute() {
    const { isAuthenticated, isAdmin, loading } = useAuth();
    const location = useLocation();
    if (loading) {
        return <div className="flex h-screen items-center justify-center bg-background">Loading...</div>;
    }
    if (!isAuthenticated) {
        return <Navigate to="/admin/login" state={{ from: location }} replace/>;
    }
    if (!isAdmin) {
        // Could also show a 403 Forbidden page here
        return <Navigate to="/" replace/>;
    }
    return <Outlet />;
}
