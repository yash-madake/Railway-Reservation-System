import React from 'react';
import { NavLink } from 'react-router-dom';
import { Activity, Search, Ticket, User, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
export function MobileNav() {
    const { isAuthenticated, user } = useAuth();
    const links = [
        { to: '/search', icon: Search, label: 'Search' },
        { to: '/train-status', icon: Activity, label: 'Status' },
        { to: '/bookings', icon: Ticket, label: 'Trips' },
        { to: isAuthenticated ? '/profile' : '/login', icon: User, label: isAuthenticated ? 'Profile' : 'Sign In' },
        ...(user?.role === 'admin' ? [{ to: '/admin', icon: Shield, label: 'Admin' }] : []),
    ];
    return (<nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-line-mid flex items-center justify-around h-16 px-2 shadow-raised">
      {links.map((link) => (<NavLink key={link.to} to={link.to} className={({ isActive }) => cn("flex flex-col items-center justify-center gap-1 w-full h-full text-caption transition-colors", isActive ? "text-royal font-semibold" : "text-ink-soft hover:text-ink")}>
          <link.icon className="size-5 shrink-0"/>
          <span>{link.label}</span>
        </NavLink>))}
    </nav>);
}
