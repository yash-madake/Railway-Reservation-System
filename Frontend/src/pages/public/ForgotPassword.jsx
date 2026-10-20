import React from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '@/components/layout/Logo';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';

/**
 * Password reset — not implemented, and it now says so.
 *
 * This form ran an 800 ms `setTimeout` and then displayed "a password reset link
 * has been dispatched", for any address, without touching the network. There is
 * no reset endpoint to call: `authRoutes` exposes only `POST /auth/register` and
 * `POST /auth/login`, and no controller anywhere handles a reset token.
 *
 * A confirmation that no email was ever sent is worse than an absent feature,
 * because someone will wait for a message that is not coming. So the form is
 * gone and the gap is stated plainly.
 */
export function ForgotPassword() {
    return (
        <div className="min-h-[calc(100vh-16rem)] flex items-center justify-center p-4">
            <div className="w-full max-w-form rounded-card border border-line-mid bg-white p-8 shadow-card">
                <div className="text-center mb-6">
                    <Logo size="md" className="mx-auto mb-4"/>
                    <h1 className="text-h3 font-bold tracking-tight text-ink">Reset Password</h1>
                </div>

                <Alert variant="warning" title="Not available yet">
                    Password reset is not implemented. There is no reset endpoint on the server, so
                    no recovery email can be sent from here.
                </Alert>

                <div className="mt-4 text-sm text-ink-soft">
                    <p>To get back in, register a new account, or sign in with an existing one.</p>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 pt-6">
                    <Link to="/register" className="flex-1">
                        <Button variant="outline" className="w-full">Register</Button>
                    </Link>
                    <Link to="/login" className="flex-1">
                        <Button className="w-full">Return to sign in</Button>
                    </Link>
                </div>
            </div>
        </div>
    );
}
