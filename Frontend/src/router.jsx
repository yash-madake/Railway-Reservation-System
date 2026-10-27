// Defence page
import DefenceQuota from '@/pages/admin/DefenceQuota';
import { createBrowserRouter } from 'react-router-dom';
// Layouts
import { PublicLayout } from '@/layouts/PublicLayout';
import { PassengerLayout } from '@/layouts/PassengerLayout';
import { AdminLayout } from '@/layouts/AdminLayout';
// Route Guards
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { AdminRoute } from '@/components/auth/AdminRoute';
// Public Pages
import { Landing } from '@/pages/public/Landing';
import { Login } from '@/pages/public/Login';
import { Register } from '@/pages/public/Register';
import { ForgotPassword } from '@/pages/public/ForgotPassword';
import AdminLogin from '@/pages/public/AdminLogin';
// Passenger Pages
import { Search } from '@/pages/passenger/Search';
import { TrainDetails } from '@/pages/passenger/TrainDetails';
import { PassengerDetails } from '@/pages/passenger/PassengerDetails';
import { SeatSelection } from '@/pages/passenger/SeatSelection';
import { BookingReview } from '@/pages/passenger/BookingReview';
import { Payment } from '@/pages/passenger/Payment';
import { BookingSuccess } from '@/pages/passenger/BookingSuccess';
import { MyBookings } from '@/pages/passenger/MyBookings';
import { BookingDetails } from '@/pages/passenger/BookingDetails';
import { PnrStatus } from '@/pages/passenger/PnrStatus';
import { Profile } from '@/pages/passenger/Profile';
// Admin Pages
import Dashboard from '@/pages/admin/Dashboard';
import TrainManagement from '@/pages/admin/TrainManagement';
import CreateTrain from '@/pages/admin/CreateTrain';
import TrainDetail from '@/pages/admin/TrainDetail';
import StationManagement from '@/pages/admin/StationManagement';
import ScheduleManagement from '@/pages/admin/ScheduleManagement';
import BookingManagement from '@/pages/admin/BookingManagement';
import UserManagement from '@/pages/admin/UserManagement';
import FareManagement from '@/pages/admin/FareManagement';
import Reports from '@/pages/admin/Reports';
import AuditLogs from '@/pages/admin/AuditLogs';
import AdminDataTable from '@/pages/admin/AdminDataTable';
import Monitoring from '@/pages/admin/Monitoring';
import Analytics from '@/pages/admin/Analytics';
export const router = createBrowserRouter([
    // ==========================================
    // PUBLIC ROUTES
    // ==========================================
    {
        element: <PublicLayout />,
        children: [
            {
                path: '/',
                element: <Landing />,
            },
            {
                path: '/login',
                element: <Login />,
            },
            {
                path: '/register',
                element: <Register />,
            },
            {
                path: '/forgot-password',
                element: <ForgotPassword />,
            },
            {
                path: '/admin/login',
                element: <AdminLogin />,
            },
            {
                path: '/pnr',
                element: <PnrStatus />,
            },
        ],
    },
    // ==========================================
    // PASSENGER ROUTES (Protected)
    // ==========================================
    {
        element: <PassengerLayout />,
        children: [
            // Search & Train browsing (accessible without auth for browsing)
            {
                path: '/search',
                element: <Search />,
            },
            {
                path: '/trains',
                element: <Search />,
            },
            {
                path: '/trains/:id',
                element: <TrainDetails />,
            },
            // Booking flow (protected)
            {
                element: <ProtectedRoute />,
                children: [
                    {
                        path: '/booking/passenger-details',
                        element: <PassengerDetails />,
                    },
                    {
                        path: '/booking/seat-selection',
                        element: <SeatSelection />,
                    },
                    {
                        path: '/booking/review',
                        element: <BookingReview />,
                    },
                    {
                        path: '/booking/payment',
                        element: <Payment />,
                    },
                    {
                        path: '/booking/success',
                        element: <BookingSuccess />,
                    },
                    // My Bookings
                    {
                        path: '/bookings',
                        element: <MyBookings />,
                    },
                    {
                        path: '/bookings/:id',
                        element: <BookingDetails />,
                    },
                    // Profile
                    {
                        path: '/profile',
                        element: <Profile />,
                    },
                ],
            },
        ],
    },
    // ==========================================
    // ADMIN ROUTES (Protected + Admin Role)
    // ==========================================
    {
        element: <AdminRoute />,
        children: [
            {
                element: <AdminLayout />,
                children: [
                    {
                    path: '/admin/defence-quota',
                    element: <DefenceQuota />,
                    },
                    {
                        path: '/admin',
                        element: <Dashboard />,
                    },
                    {
                        path: '/admin/trains',
                        element: <TrainManagement />,
                    },
                    {
                        path: '/admin/trains/create',
                        element: <CreateTrain />,
                    },
                    {
                        path: '/admin/trains/:id',
                        element: <TrainDetail />,
                    },
                    {
                        path: '/admin/stations',
                        element: <StationManagement />,
                    },
                    {
                        path: '/admin/schedules',
                        element: <ScheduleManagement />,
                    },
                    {
                        path: '/admin/bookings',
                        element: <AdminDataTable type="bookings" />,
                    },
                    {
                        path: '/admin/users',
                        element: <AdminDataTable type="users" />,
                    },
                    {
                        path: '/admin/fares',
                        element: <FareManagement />,
                    },
                    {
                        path: '/admin/reports',
                        element: <Analytics />,
                    },
                    {
                        path: '/admin/audit-logs',
                        element: <AdminDataTable type="audit" />
                    },
                    { path: '/admin/payments', element: <AdminDataTable type="payments" /> },
                    { path: '/admin/cancellations', element: <AdminDataTable type="cancellations" /> },
                    { path: '/admin/monitoring', element: <Monitoring /> },
                    { path: '/admin/analytics', element: <Analytics />,
                    },
                ],
            },
        ],
    },
]);
