import { ShieldCheck } from 'lucide-react';
import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Train, MapPin, Calendar, Ticket, Users, IndianRupee, FileText, ShieldAlert, LogOut, Menu, ArrowLeft, CreditCard, Ban, Activity, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Logo } from '@/components/layout/Logo';
import { Dropdown } from '@/components/ui/Dropdown';
import { useAuth } from '@/context/AuthContext';
export function AdminLayout() {
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const handleLogout = () => {
        logout();
        navigate('/login');
    };
    const navItems = [
      { to: '/admin', icon: LayoutDashboard, label: 'Dashboard', end: true },
      { to: '/admin/trains', icon: Train, label: 'Trains' },
      { to: '/admin/stations', icon: MapPin, label: 'Stations' },
      { to: '/admin/schedules', icon: Calendar, label: 'Schedules' },
      { to: '/admin/bookings', icon: Ticket, label: 'Bookings' },
      { to: '/admin/users', icon: Users, label: 'Users' },

      // NEW: Defence Quota
      { to: '/admin/defence-quota', icon: ShieldCheck, label: 'Defence Quota' },

      { to: '/admin/fares', icon: IndianRupee, label: 'Fares' },
      { to: '/admin/reports', icon: FileText, label: 'Reports' },
      { to: '/admin/audit-logs', icon: ShieldAlert, label: 'Audit Logs' },
      { to: '/admin/payments', icon: CreditCard, label: 'Payments' },
      { to: '/admin/cancellations', icon: Ban, label: 'Cancellations' },
      { to: '/admin/analytics', icon: BarChart3, label: 'Analytics' },
      { to: '/admin/monitoring', icon: Activity, label: 'Monitoring' },
    ];
    const SidebarContent = () => (<div className="flex flex-col h-full bg-navy text-white border-r border-white/10">
      <div className={cn("h-16 flex items-center border-b border-white/10 px-5", isSidebarOpen ? "justify-between" : "justify-center")}>
        {isSidebarOpen ? (<Logo size="sm" variant="dark"/>) : (<div className="size-8 rounded-[22%] bg-gradient-to-br from-royal to-azure flex items-center justify-center font-bold text-white text-sm">
            Y
          </div>)}
      </div>
      
      <div className="flex-1 overflow-y-auto py-5 px-3">
        <div className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-on-dark-label px-3 mb-2">
          {isSidebarOpen ? 'Management' : '•••'}
        </div>
        <nav className="space-y-1">
          {navItems.map((item) => (<NavLink key={item.to} to={item.to} end={item.end} onClick={() => setIsMobileSidebarOpen(false)} className={({ isActive }) => cn("flex items-center gap-3 px-3 py-2.5 rounded-control text-sm font-medium transition-colors", isActive
                ? "bg-gradient-to-r from-royal to-azure text-white shadow-button"
                : "text-white/75 hover:bg-white/10 hover:text-white", !isSidebarOpen && "justify-center px-0")} title={!isSidebarOpen ? item.label : undefined}>
              <item.icon className="size-5 shrink-0"/>
              {isSidebarOpen && <span>{item.label}</span>}
            </NavLink>))}
        </nav>
      </div>

      <div className="p-4 border-t border-white/10 space-y-2">
        <button onClick={() => navigate('/')} className={cn("flex items-center gap-2.5 w-full px-3 py-2 text-caption font-semibold text-white/80 hover:text-white rounded-control hover:bg-white/5 transition-colors", !isSidebarOpen && "justify-center px-0")}>
          <ArrowLeft className="size-4 shrink-0"/>
          {isSidebarOpen && <span>Passenger Portal</span>}
        </button>

        <button onClick={handleLogout} className={cn("flex items-center gap-2.5 w-full px-3 py-2 text-caption font-semibold text-error-strong hover:bg-error-strong/10 rounded-control transition-colors", !isSidebarOpen && "justify-center px-0")}>
          <LogOut className="size-4 shrink-0"/>
          {isSidebarOpen && <span>Sign Out</span>}
        </button>
      </div>
    </div>);
    return (<div className="flex h-screen bg-paper overflow-hidden text-body">
      {/* Desktop Sidebar */}
      <aside className={cn("hidden md:block transition-all duration-200 z-20 shrink-0", isSidebarOpen ? "w-64" : "w-20")}>
        <SidebarContent />
      </aside>

      {/* Mobile Sidebar Overlay */}
      {isMobileSidebarOpen && (<div className="fixed inset-0 bg-ink/60 backdrop-blur-sm z-40 md:hidden" onClick={() => setIsMobileSidebarOpen(false)}/>)}
      
      {/* Mobile Drawer */}
      <aside className={cn("fixed inset-y-0 left-0 w-64 z-50 transform transition-transform duration-200 md:hidden", isMobileSidebarOpen ? "translate-x-0" : "-translate-x-full")}>
        <SidebarContent />
      </aside>

      {/* Main Admin Content Container */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Topbar */}
        <header className="h-16 bg-white border-b border-line-mid flex items-center justify-between px-6 shrink-0 z-10 shadow-sm">
          <div className="flex items-center gap-4">
            <button onClick={() => setIsMobileSidebarOpen(true)} className="md:hidden p-2 rounded-control text-ink hover:bg-fog" aria-label="Open sidebar menu">
              <Menu className="size-5"/>
            </button>
            <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="hidden md:block p-2 rounded-control text-ink-soft hover:text-ink hover:bg-fog transition-colors" aria-label="Toggle sidebar width">
              <Menu className="size-5"/>
            </button>
            <div className="flex items-center gap-2">
              <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-royal bg-blue-100 px-2.5 py-1 rounded-full">
                ADMIN CONSOLE
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <Dropdown trigger={<button className="flex items-center gap-2.5 focus:outline-none p-1.5 rounded-control hover:bg-fog transition-colors">
                  <div className="size-8 rounded-full bg-navy text-white flex items-center justify-center font-bold text-xs">
                    {user?.name?.charAt(0).toUpperCase() || 'A'}
                  </div>
                  <div className="hidden sm:block text-left leading-tight">
                    <div className="text-sm font-semibold text-ink">{user?.name || 'Administrator'}</div>
                    <div className="text-caption text-ink-soft">{user?.email || 'admin@yatrio.in'}</div>
                  </div>
                </button>} items={[
            { label: 'View Passenger Site', onClick: () => navigate('/') },
            { label: 'Sign Out', onClick: handleLogout, className: 'text-error-strong' },
        ]} align="end"/>
          </div>
        </header>

        {/* Page View Area */}
        <main className="flex-1 overflow-auto bg-paper p-6 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>);
}
