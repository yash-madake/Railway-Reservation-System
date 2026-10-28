import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Logo } from '@/components/layout/Logo';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { EmailVerification } from '@/components/auth/EmailVerification';
import { useAuth } from '@/context/AuthContext';
export function Register() {
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        phone: '',
        password: '',
        confirmPassword: '',
    });
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    // Set once the account exists and a code has been emailed:
    //   { email, emailSent }
    const [verification, setVerification] = useState(null);
    const { register } = useAuth();
    const navigate = useNavigate();
    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        if (formData.password !== formData.confirmPassword) {
            setError('Passwords do not match');
            return;
        }
        if (formData.password.length < 8) {
            setError('Password must be at least 8 characters long');
            return;
        }
        setIsLoading(true);
        try {
            const result = await register({
                name: formData.name.trim(),
                email: formData.email.trim(),
                phone: formData.phone.trim(),
                password: formData.password,
            });
            if (result.requiresVerification) {
                // Next step: enter the 6-digit code that was just emailed.
                setVerification({ email: result.email, emailSent: result.emailSent });
            }
            else {
                setSuccess(true);
                setTimeout(() => {
                    navigate('/login');
                }, 1500);
            }
        }
        catch (err) {
            setError(err.message || 'Registration failed');
        }
        finally {
            setIsLoading(false);
        }
    };
    // The code was accepted, so the user is already signed in.
    const handleVerified = (result) => {
        navigate(result?.alreadyVerified ? '/login' : '/search');
    };
    return (<div className="min-h-[calc(100vh-4rem)] grid lg:grid-cols-2">
      {/* Left Form */}
      <div className="flex flex-col justify-center px-6 py-12 sm:px-12 lg:px-16 max-w-form mx-auto w-full">
        <div className="mb-8">
          <Logo size="md" className="mb-6"/>
          <h1 className="text-h2 font-bold tracking-tight text-ink">
            {verification ? 'Verify your email' : 'Create Account'}
          </h1>
          <p className="mt-2 text-body text-ink-soft">
            {verification
            ? `Enter the 6-digit code we sent to ${verification.email} to finish creating your account.`
            : 'Register to book tickets, choose berths, and track train status.'}
          </p>
        </div>

        {verification ? (<EmailVerification email={verification.email} emailSent={verification.emailSent} initialCooldown={verification.emailSent ? 60 : 0} onVerified={handleVerified} onBack={() => setVerification(null)} backLabel="Use a different email"/>) : (<>
        {error && (<Alert variant="error" title="Registration error" className="mb-6">
            {error}
          </Alert>)}

        {success && (<Alert variant="success" title="Account created" className="mb-6">
            Registration successful! Redirecting to sign in...
          </Alert>)}

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input label="Full name" type="text" placeholder="Rahul Sharma" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required/>

          <Input label="Email address" type="email" placeholder="rahul@example.com" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} required/>

          <Input label="Mobile number" type="tel" placeholder="9876543210" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} required pattern="[0-9]{10}" helperText="10-digit mobile number for SMS ticket updates"/>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="Password" type="password" placeholder="••••••••" value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} required/>
            <Input label="Confirm password" type="password" placeholder="••••••••" value={formData.confirmPassword} onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })} required/>
          </div>

          <Button type="submit" size="lg" className="w-full mt-4" isLoading={isLoading}>
            Create Account
          </Button>
        </form>

        <div className="mt-8 text-center text-sm text-ink-soft">
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-royal hover:underline">
            Sign in
          </Link>
        </div>
        </>)}
      </div>

      {/* Right Brand Panel */}
      <div className="hidden lg:flex flex-col justify-between bg-[linear-gradient(135deg,#04275B_0%,#014CA9_78%,#0A63C6_100%)] p-12 text-white blueprint relative overflow-hidden">
        <div className="relative z-10">
          <Logo size="lg" variant="dark" showTagline/>
        </div>

        <div className="relative z-10 max-w-md space-y-6">
          <h2 className="text-display font-bold tracking-tight text-white leading-tight">
            Engineered for seamless travel.
          </h2>
          <p className="text-lead text-on-dark-soft">
            Join thousands of travelers who rely on honest railway tracking and instantaneous booking.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-card border border-white/10 bg-white/5 p-4">
              <span className="text-eyebrow uppercase tracking-[0.16em] text-sky-bright font-semibold">
                Average Booking Time
              </span>
              <div className="num text-2xl font-bold text-white mt-1">42 sec</div>
            </div>
            <div className="rounded-card border border-white/10 bg-white/5 p-4">
              <span className="text-eyebrow uppercase tracking-[0.16em] text-sky-bright font-semibold">
                Data Precision
              </span>
              <div className="num text-2xl font-bold text-white mt-1">100% Verified</div>
            </div>
          </div>
        </div>

        <div className="relative z-10 text-caption text-on-dark-label">
          © 2026 Yatrio Platform · Move Beyond Limits
        </div>
      </div>
    </div>);
}