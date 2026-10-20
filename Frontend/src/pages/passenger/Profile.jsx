import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, LogOut, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useAuth } from '@/context/AuthContext';
export function Profile() {
    const { user: authUser, getProfile, logout } = useAuth();
    const navigate = useNavigate();
    const [profileData, setProfileData] = useState(authUser);
    const [isLoading, setIsLoading] = useState(false);
    useEffect(() => {
        let isMounted = true;
        async function loadFreshProfile() {
            try {
                setIsLoading(true);
                const res = await getProfile();
                if (isMounted && res && res.user) {
                    setProfileData(res.user);
                }
            }
            catch (err) {
                console.warn('Could not fetch fresh profile from server, using session data:', err);
            }
            finally {
                if (isMounted) {
                    setIsLoading(false);
                }
            }
        }
        loadFreshProfile();
        return () => { isMounted = false; };
    }, []);
    const currentUser = profileData || authUser;
    const displayName = currentUser?.name || currentUser?.full_name || 'Passenger';

    /**
     * Shown as "not recorded" rather than filled in.
     *
     * These used to fall back to `user@yatrio.com` and `+91 98765 43210`. Both
     * columns are NOT NULL in `users` and are returned by `GET /users/profile`,
     * so those branches only fire when the fetch failed — at which point showing
     * a plausible-looking address and phone number is exactly the wrong answer.
     */
    const displayEmail = currentUser?.email || 'Not recorded';
    const rawPhone = currentUser?.phone || '';
    const displayPhone = rawPhone
        ? (rawPhone.startsWith('+91') ? rawPhone : `+91 ${rawPhone}`)
        : 'Not recorded';

    /**
     * The account's real creation date.
     *
     * Was a literal "Member since Oct 2026" on every profile, including accounts
     * created years apart. `AuthContext` already normalises this into
     * `user.createdAt` from the profile response, so the data was in hand and
     * being ignored.
     */
    const memberSince = (() => {
        const raw = currentUser?.createdAt ?? currentUser?.created_at ?? profileData?.createdAt;
        if (!raw) return null;
        const d = new Date(raw);
        return Number.isNaN(d.getTime())
            ? null
            : d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
    })();

    const avatarInitial = displayName.trim().charAt(0).toUpperCase() || 'P';
    const handleSignOut = () => {
        logout();
        navigate('/');
    };
    return (<div className="min-h-screen bg-fog/20 py-10 px-4 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-royal">
            User Account
          </span>
          <h1 className="text-h2 font-bold tracking-tight text-ink mt-0.5">
            Passenger Profile
          </h1>
          <p className="text-body text-ink-soft mt-1">
            Manage your personal contact details, verified government ID links, and travel preferences.
          </p>
        </div>

        {/* Profile Banner */}
        <Card className="p-0 overflow-hidden border-line-mid shadow-card rounded-card">
          <div className="bg-gradient-to-r from-navy via-royal to-azure text-paper p-8 flex flex-col sm:flex-row items-center sm:items-start justify-between gap-6">
            <div className="flex flex-col sm:flex-row items-center gap-5 text-center sm:text-left">
              <div className="size-20 rounded-full bg-white/20 border-2 border-white/40 flex items-center justify-center text-3xl font-black text-paper shadow-raised">
                {avatarInitial}
              </div>
              <div className="space-y-1">
                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                  <h2 className="text-h3 font-bold text-paper">{displayName}</h2>
                  {/*
                    Was an unconditional "Verified Passenger". There is no
                    `verified` column in `users`, so the badge asserted a state
                    the system does not track. The role is real, so that is shown.
                  */}
                  <Badge variant="outline" className="border-white/30 text-paper font-semibold bg-white/10">
                    {currentUser?.role ? String(currentUser.role) : 'Passenger'}
                  </Badge>
                </div>
                <p className="text-caption text-paper/80 font-medium">{displayEmail}</p>
                <div className="flex items-center justify-center sm:justify-start gap-4 text-xs text-paper/70 pt-1">
                  {rawPhone && <><span>{displayPhone}</span><span>•</span></>}
                  {memberSince && <span>Member since {memberSince}</span>}
                </div>
              </div>
            </div>

            <Button variant="outline" size="sm" onClick={handleSignOut} className="border-white/40 text-paper hover:bg-white/15 gap-2 shrink-0">
              <LogOut className="size-4"/> Sign Out
            </Button>
          </div>

          <div className="p-6 md:p-8 bg-white space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <h3 className="text-h4 font-bold text-ink border-b border-line pb-2">
                  Personal Information
                </h3>
                <div className="space-y-3 text-sm">
                  <div>
                    <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft block">
                      Full Name
                    </span>
                    <span className="font-semibold text-ink mt-0.5 block">{displayName}</span>
                  </div>
                  <div>
                    <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft block">
                      Registered Email
                    </span>
                    <span className="font-semibold text-ink mt-0.5 block">{displayEmail}</span>
                  </div>
                  <div>
                    <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft block">
                      Primary Phone
                    </span>
                    <span className="font-semibold text-ink mt-0.5 block">{displayPhone}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-h4 font-bold text-ink border-b border-line pb-2">
                  Account
                </h3>
                {/*
                  Both tiles that used to be here asserted states nothing records:
                  "Mobile Number Verified / Authorized for IRCTC OTP verification"
                  and "Account Security Status" with green check and shield icons.
                  There is no `verified` column and no IRCTC integration. The one
                  true thing here is the account's status, so only that is shown.
                */}
                <div className="space-y-3 text-sm">
                  <div className="flex items-center gap-3 p-3 rounded-control bg-fog/30 border border-line">
                    {currentUser?.status === 'active'
                      ? <CheckCircle2 className="size-5 text-emerald-600 shrink-0"/>
                      : <Shield className="size-5 text-warning-strong shrink-0"/>}
                    <div>
                      <span className="font-semibold text-ink block">
                        Account status: {currentUser?.status ?? 'unknown'}
                      </span>
                      <span className="text-caption text-ink-soft">
                        {currentUser?.status === 'active'
                          ? 'This account can book and pay.'
                          : 'This account cannot book until it is reactivated.'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>);
}
