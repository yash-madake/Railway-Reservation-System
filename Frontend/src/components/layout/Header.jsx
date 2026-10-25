import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Menu, X, User, LogOut, Ticket, Shield } from 'lucide-react';
import { Logo } from './Logo';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';
import { Dropdown } from '@/components/ui/Dropdown';
export function Header() {
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const { isAuthenticated, user, logout } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const handleLogout = () => {
        logout();
        navigate('/');
    };
    const navLinks = [
        { label: 'Book Trains', href: '/search' },
        { label: 'PNR Status', href: '/pnr' },
        { label: 'Train Status', href: '/train-status' },
        { label: 'All Trains', href: '/trains' },
    ];
    return (<header className="sticky top-0 z-50 border-b border-white/10 bg-navy/95 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-content items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-8">
          <Logo size="md" variant="dark"/>

          <nav aria-label="Primary" className="hidden items-center gap-7 lg:flex">
            {navLinks.map((link) => {
            const isActive = location.pathname === link.href;
            return (<Link key={link.label} to={link.href} className={cn("text-sm font-medium transition-colors hover:text-white relative py-1", isActive
                    ? "text-white after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-azure"
                    : "text-white/75")}>
                  {link.label}
                </Link>);
        })}
          </nav>
        </div>

        <div className="hidden items-center gap-3 sm:flex">
          <Link to="/pnr" className="hidden h-9 items-center justify-center rounded-control border border-white/20 px-3.5 text-caption font-semibold text-white transition-colors hover:bg-white/10 sm:inline-flex">
            PNR Status
          </Link>

          <Link to="/search" className="inline-flex h-9 items-center justify-center rounded-control bg-gradient-to-r from-royal to-azure px-4 text-caption font-semibold text-white shadow-button transition-[filter] hover:brightness-110">
            Book a Train
          </Link>

          {isAuthenticated ? (<div className="ml-2 pl-2 border-l border-white/15">
              <Dropdown trigger={<button className="flex items-center gap-2 focus:outline-none rounded-control p-1 text-white hover:bg-white/10 transition-colors">
                    <div className="size-8 rounded-full bg-azure text-white flex items-center justify-center font-bold text-xs">
                      {user?.name?.charAt(0).toUpperCase() || 'U'}
                    </div>
                    <span className="text-sm font-medium text-white hidden md:block max-w-[120px] truncate">
                      {user?.name}
                    </span>
                  </button>} items={[
                ...(user?.role === 'admin'
                    ? [
                        {
                            label: 'Admin Portal',
                            icon: <Shield className="h-4 w-4 text-azure"/>,
                            onClick: () => navigate('/admin'),
                        },
                    ]
                    : []),
                {
                    label: 'My Bookings',
                    icon: <Ticket className="h-4 w-4"/>,
                    onClick: () => navigate('/bookings'),
                },
                {
                    label: 'Profile',
                    icon: <User className="h-4 w-4"/>,
                    onClick: () => navigate('/profile'),
                },
                {
                    label: 'Logout',
                    icon: <LogOut className="h-4 w-4"/>,
                    onClick: handleLogout,
                    className: 'text-error-strong hover:bg-error-strong/10',
                },
            ]} align="end"/>
            </div>) : (<div className="flex items-center gap-2 ml-2">
              <Link to="/login" className="h-9 px-3 flex items-center justify-center rounded-control text-caption font-semibold text-white/80 hover:text-white hover:bg-white/10 transition-colors">
                Sign In
              </Link>
            </div>)}
        </div>

        {/* Mobile Hamburger Toggle */}
        <button className="lg:hidden p-2 text-white/90 hover:text-white rounded-control focus:outline-none" onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} aria-label={isMobileMenuOpen ? "Close menu" : "Open menu"}>
          {isMobileMenuOpen ? <X className="size-6"/> : <Menu className="size-6"/>}
        </button>
      </div>

      {/* Mobile Drawer */}
      {isMobileMenuOpen && (<div className="lg:hidden border-t border-white/10 bg-navy px-4 py-6 space-y-4 animate-fade-up">
          <nav className="flex flex-col gap-2">
            {navLinks.map((link) => (<Link key={link.label} to={link.href} className="px-3 py-2.5 rounded-control text-lead font-medium text-white/90 hover:text-white hover:bg-white/10 transition-colors" onClick={() => setIsMobileMenuOpen(false)}>
                {link.label}
              </Link>))}
          </nav>

          <div className="border-t border-white/10 pt-4 flex flex-col gap-3">
            {isAuthenticated ? (<>
                <Link to="/bookings" className="flex items-center gap-2.5 px-3 py-2 text-body text-white/90 hover:text-white" onClick={() => setIsMobileMenuOpen(false)}>
                  <Ticket className="size-4 text-sky"/> My Bookings
                </Link>
                <Link to="/profile" className="flex items-center gap-2.5 px-3 py-2 text-body text-white/90 hover:text-white" onClick={() => setIsMobileMenuOpen(false)}>
                  <User className="size-4 text-sky"/> Profile
                </Link>
                {user?.role === 'admin' && (<Link to="/admin" className="flex items-center gap-2.5 px-3 py-2 text-body text-sky-bright hover:text-white" onClick={() => setIsMobileMenuOpen(false)}>
                    <Shield className="size-4"/> Admin Portal
                  </Link>)}
                <button onClick={() => { handleLogout(); setIsMobileMenuOpen(false); }} className="flex items-center gap-2.5 px-3 py-2 text-body text-error-strong hover:bg-white/5 text-left rounded-control">
                  <LogOut className="size-4"/> Sign Out
                </button>
              </>) : (<div className="flex flex-col gap-2 pt-2">
                <Link to="/login" className="h-11 flex items-center justify-center rounded-control border border-white/20 text-white font-semibold text-sm hover:bg-white/10" onClick={() => setIsMobileMenuOpen(false)}>
                  Sign In
                </Link>
                <Link to="/register" className="h-11 flex items-center justify-center rounded-control bg-gradient-to-r from-royal to-azure text-white font-semibold text-sm shadow-button" onClick={() => setIsMobileMenuOpen(false)}>
                  Register
                </Link>
              </div>)}
          </div>
        </div>)}
    </header>);
}
