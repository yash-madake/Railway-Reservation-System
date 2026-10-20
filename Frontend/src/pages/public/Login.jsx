import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Logo } from '@/components/layout/Logo';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { EmailVerification } from '@/components/auth/EmailVerification';
import { useAuth } from '@/context/AuthContext';
import { API_BASE_URL } from '@/api/client';
export function Login() {
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    // Set when the password was right but the email has never been confirmed.
    const [pendingEmail, setPendingEmail] = useState(null);
    const { login } = useAuth();
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');

    // Real network counts for the side panel, so it stops claiming 99.98%
    // uptime across 1,840 stations.
    const [counts, setCounts] = useState(null);

    useEffect(() => {
        let isMounted = true;
        fetch(`${API_BASE_URL}/trains/stats`)
            .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`stats ${res.status}`))))
            .then((body) => {
                if (isMounted) setCounts(body?.data?.counts ?? null);
            })
            .catch(() => {
                /* the panel falls back to an honest "unavailable" */
            });
        return () => {
            isMounted = false;
        };
    }, []);
    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setNotice('');
        setIsLoading(true);
        try {
            await login(email, password);
            navigate('/search');
        }
        catch (err) {
            if (err.code === 'EMAIL_NOT_VERIFIED') {
                // Right password, unconfirmed email: go to the code screen.
                setPendingEmail(err.email || email.trim());
            }
            else {
                setError(err.message || 'Invalid credentials');
            }
        }
        finally {
            setIsLoading(false);
        }
    };
    // The code was accepted, so the user is already signed in.
    const handleVerified = (result) => {
        if (result?.alreadyVerified) {
            setPendingEmail(null);
            setPassword('');
            setNotice('Your email is already verified. Please sign in.');
        }
        else {
            navigate('/search');
        }
    };
    return (<div className="min-h-[calc(100vh-4rem)] grid lg:grid-cols-2">
      {/* Left Column: Sign In Form */}
      <div className="flex flex-col justify-center px-6 py-12 sm:px-12 lg:px-16 max-w-form mx-auto w-full">
        <div className="mb-8">
          <Logo size="md" className="mb-6"/>
          <h1 className="text-h2 font-bold tracking-tight text-ink">
            {pendingEmail ? 'Verify your email' : 'Sign In'}
          </h1>
          <p className="mt-2 text-body text-ink-soft">
            {pendingEmail
            ? `Your email address hasn't been confirmed yet. Enter the 6-digit code sent to ${pendingEmail}.`
            : 'Access your tickets, manage trips, and track live bookings.'}
          </p>
        </div>

        {pendingEmail ? (<EmailVerification email={pendingEmail} sendOnMount onVerified={handleVerified} onBack={() => setPendingEmail(null)} backLabel="Back to sign in"/>) : (<>
        {notice && (<Alert variant="success" title="Email verified" className="mb-6">
            {notice}
          </Alert>)}

        {error && (<Alert variant="error" title="Authentication failed" className="mb-6">
            {error}
          </Alert>)}

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input label="Email address" type="email" placeholder="passenger@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email"/>

          <div className="space-y-1.5">
            <Input label="Password" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password"/>
            <div className="flex justify-end">
              <Link to="/forgot-password" className="text-caption font-semibold text-royal hover:underline">
                Forgot password?
              </Link>
            </div>
          </div>

          <Button type="submit" size="lg" className="w-full mt-2" isLoading={isLoading}>
            Sign In
          </Button>

        {/*
          The one-click demo credential buttons are gone.

          They filled the form with `rahul.sharma@example.com / Passenger@123`
          and `admin@railconnect.in / Admin@123`. Neither account exists in the
          `users` table — the seeded users are gmail.com addresses — so both
          buttons could only ever produce a failed login, while shipping what
          look like real passwords inside the built JavaScript. Sign up for a real
          account instead.
        */}
      </form>

        <div className="mt-8 text-center text-sm text-ink-soft">
          Don't have an account?{' '}
          <Link to="/register" className="font-semibold text-royal hover:underline">
            Register here
          </Link>
        </div>
        </>)}
      </div>

      {/* Right Column: Horizon Blueprint Brand Panel (brandkit §9.11) */}
      <div className="hidden lg:flex flex-col justify-between bg-[linear-gradient(135deg,#04275B_0%,#014CA9_78%,#0A63C6_100%)] p-12 text-white blueprint relative overflow-hidden">
        <div className="relative z-10">
          <Logo size="lg" variant="dark" showTagline/>
        </div>

        <div className="relative z-10 max-w-md space-y-6">
          <h2 className="text-display font-bold tracking-tight text-white leading-tight">
            Move Beyond Limits.
          </h2>
          <p className="text-lead text-on-dark-soft">
            Experience next-generation railway reservations with zero latency and live station updates.
          </p>

          {/*
            Counted from the database, not marketing copy.

            This claimed "99.98%" reliability and "1,840 stations and 12,000+
            daily trains nationwide". Neither is measurable here — there is no
            uptime metric and no national network — so they are replaced by the
            figures that can actually be counted.
          */}
          <div className="rounded-card border border-white/10 bg-white/5 backdrop-blur-sm p-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-eyebrow uppercase tracking-[0.16em] text-sky-bright font-semibold">
                Network Coverage
              </span>
              <span className="num font-bold text-white">
                {counts ? counts.trains : '—'} trains
              </span>
            </div>
            <p className="text-caption text-on-dark-soft">
              {counts
                ? `Across ${counts.stations} stations, ${counts.coaches} coaches and ${counts.berths} bookable berths.`
                : 'Network figures are unavailable right now.'}
            </p>
          </div>
        </div>

        <div className="relative z-10 text-caption text-on-dark-label">
          © 2026 Yatrio Platform · Precision Rail Systems
        </div>
      </div>
    </div>);
}