import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';

const CODE_LENGTH = 6;
const EMPTY_CODE = Array(CODE_LENGTH).fill('');

/**
 * The "enter your 6-digit code" step of email verification.
 *
 * Used by the Register page (right after Create Account) and by the Login page
 * (when the password is right but the email was never confirmed).
 *
 * Props
 *   email            address the code was sent to
 *   emailSent        false when the account was created but the email failed to
 *                    send, so Resend is offered immediately
 *   initialCooldown  seconds before Resend unlocks (the server enforces 60)
 *   sendOnMount      ask the server for a fresh code as soon as this appears
 *                    (used from Login, where no code was just sent)
 *   onVerified       called with { alreadyVerified } once the code is accepted;
 *                    by then the user is logged in
 *   onBack           renders a back button when given
 *   backLabel        text for that button
 */
export function EmailVerification({
    email,
    emailSent = true,
    initialCooldown = 0,
    sendOnMount = false,
    onVerified,
    onBack,
    backLabel = 'Use a different email',
}) {
    const { verifyEmail, resendOtp } = useAuth();

    const [digits, setDigits] = useState(EMPTY_CODE);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState(() => {
        if (sendOnMount) return null;
        return emailSent
            ? { variant: 'success', text: `We sent a 6-digit code to ${email}. It expires in 10 minutes.` }
            : { variant: 'warning', text: 'Your account was created, but we could not send the email. Tap "Resend code" to try again.' };
    });
    const [isVerifying, setIsVerifying] = useState(false);
    const [isResending, setIsResending] = useState(false);
    const [cooldown, setCooldown] = useState(initialCooldown);

    const inputsRef = useRef([]);
    const submittingRef = useRef(false);
    const autoSentRef = useRef(false);

    const focusBox = (index) => {
        const box = inputsRef.current[index];
        if (box) box.focus();
    };

    // Resend countdown: one tick a second while it is running.
    const cooling = cooldown > 0;
    useEffect(() => {
        if (!cooling) return undefined;
        const timer = setInterval(() => {
            setCooldown((s) => (s > 1 ? s - 1 : 0));
        }, 1000);
        return () => clearInterval(timer);
    }, [cooling]);

    // From Login there is no code in flight yet, so ask for one. If one was
    // sent a moment ago the server answers "wait", and that code still works.
    useEffect(() => {
        if (!sendOnMount || autoSentRef.current) return;
        autoSentRef.current = true;

        (async () => {
            try {
                const result = await resendOtp(email);
                setCooldown(Math.ceil(result.retryAfterSeconds));
                setNotice({
                    variant: 'success',
                    text: `We emailed a new 6-digit code to ${email}. It expires in 10 minutes.`,
                });
            }
            catch (err) {
                if (err.code === 'RESEND_COOLDOWN') {
                    setCooldown(Math.ceil(err.retryAfterSeconds ?? 60));
                    setNotice({
                        variant: 'info',
                        text: `A code was sent to ${email} a moment ago. Enter it below.`,
                    });
                }
                else if (err.code === 'RESEND_LIMIT') {
                    setCooldown(Math.ceil(err.retryAfterSeconds ?? 60));
                    setNotice({
                        variant: 'warning',
                        text: 'Too many codes have been requested. Use the latest one in your inbox, or try again later.',
                    });
                }
                else {
                    setNotice({
                        variant: 'warning',
                        text: err.message || 'We could not send a code. Tap "Resend code" to try again.',
                    });
                }
            }
        })();
    }, [sendOnMount, email, resendOtp]);

    const submit = async (code) => {
        if (submittingRef.current) return;
        submittingRef.current = true;
        setIsVerifying(true);
        setError('');

        try {
            const result = await verifyEmail(email, code);
            if (onVerified) onVerified(result);
        }
        catch (err) {
            setError(err.message || 'Verification failed.');
            if (err.code === 'OTP_TOO_MANY_ATTEMPTS' || err.code === 'OTP_EXPIRED' || err.code === 'OTP_NOT_FOUND') {
                setNotice(null);
            }
            setDigits(EMPTY_CODE);
            focusBox(0);
        }
        finally {
            submittingRef.current = false;
            setIsVerifying(false);
        }
    };

    // Write `text` into the boxes starting at `start`, then move on (or submit
    // when all six are filled). Used for typing, autofill and paste alike.
    const fillFrom = (text, start) => {
        const chars = text.slice(0, CODE_LENGTH - start).split('');
        const next = [...digits];
        chars.forEach((ch, i) => {
            next[start + i] = ch;
        });
        setDigits(next);
        setError('');

        if (next.every(Boolean)) {
            focusBox(CODE_LENGTH - 1);
            submit(next.join(''));
        }
        else {
            focusBox(Math.min(start + chars.length, CODE_LENGTH - 1));
        }
    };

    const handleChange = (index, value) => {
        const onlyDigits = value.replace(/\D/g, '');

        if (!onlyDigits) {
            const next = [...digits];
            next[index] = '';
            setDigits(next);
            return;
        }

        // Several characters at once means autofill (one-time-code) or a paste.
        if (onlyDigits.length > 1) {
            fillFrom(onlyDigits, onlyDigits.length >= CODE_LENGTH ? 0 : index);
            return;
        }

        fillFrom(onlyDigits, index);
    };

    const handleKeyDown = (index, e) => {
        if (e.key === 'Backspace' && !digits[index] && index > 0) {
            e.preventDefault();
            const next = [...digits];
            next[index - 1] = '';
            setDigits(next);
            focusBox(index - 1);
        }
        else if (e.key === 'ArrowLeft' && index > 0) {
            e.preventDefault();
            focusBox(index - 1);
        }
        else if (e.key === 'ArrowRight' && index < CODE_LENGTH - 1) {
            e.preventDefault();
            focusBox(index + 1);
        }
    };

    const handlePaste = (index, e) => {
        const pasted = e.clipboardData.getData('text').replace(/\D/g, '');
        if (!pasted) return;
        e.preventDefault();
        fillFrom(pasted, pasted.length >= CODE_LENGTH ? 0 : index);
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        const code = digits.join('');
        if (code.length < CODE_LENGTH) {
            setError('Enter all 6 digits of the code.');
            return;
        }
        submit(code);
    };

    const handleResend = async () => {
        if (cooldown > 0 || isResending) return;
        setIsResending(true);
        setError('');

        try {
            const result = await resendOtp(email);
            setCooldown(Math.ceil(result.retryAfterSeconds));
            setNotice({ variant: 'success', text: `A new code has been sent to ${email}.` });
            setDigits(EMPTY_CODE);
            focusBox(0);
        }
        catch (err) {
            if (err.retryAfterSeconds) setCooldown(Math.ceil(err.retryAfterSeconds));
            setError(err.message || 'Could not resend the code.');
        }
        finally {
            setIsResending(false);
        }
    };

    const code = digits.join('');

    return (<div className="space-y-5">
      {notice && (<Alert variant={notice.variant}>{notice.text}</Alert>)}

      {error && (<Alert variant="error" title="Verification failed">{error}</Alert>)}

      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        <div className="space-y-2">
          <span id="otp-label" className="block text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft">
            Verification code
          </span>
          <div role="group" aria-labelledby="otp-label" className="flex gap-2 sm:gap-3">
            {digits.map((digit, index) => (<input key={index} ref={(el) => { inputsRef.current[index] = el; }} type="text" inputMode="numeric" pattern="[0-9]*" maxLength={CODE_LENGTH} autoComplete={index === 0 ? 'one-time-code' : 'off'} aria-label={`Digit ${index + 1} of ${CODE_LENGTH}`} value={digit} readOnly={isVerifying} autoFocus={index === 0 && !sendOnMount} onChange={(e) => handleChange(index, e.target.value)} onKeyDown={(e) => handleKeyDown(index, e)} onPaste={(e) => handlePaste(index, e)} onFocus={(e) => e.target.select()} className={cn('num size-12 sm:size-14 rounded-control border bg-white text-center text-h4 font-semibold text-ink transition-colors focus:outline-none', error
                ? 'border-status-error focus:border-status-error focus:ring-4 focus:ring-error-strong/15'
                : 'border-line-strong hover:border-ink-soft focus:border-royal focus:ring-4 focus:ring-royal/15')}/>))}
          </div>
        </div>

        <Button type="submit" size="lg" className="w-full" isLoading={isVerifying} disabled={code.length < CODE_LENGTH}>
          Verify email
        </Button>
      </form>

      <div className="flex items-center justify-between gap-3 text-sm text-ink-soft">
        <span>Didn't get the code?</span>
        <Button type="button" variant="ghost" size="sm" onClick={handleResend} disabled={cooldown > 0} isLoading={isResending}>
          {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
        </Button>
      </div>

      {onBack && (<Button type="button" variant="ghost" size="sm" leftIcon={<ArrowLeft size={16}/>} onClick={onBack}>
          {backLabel}
        </Button>)}
    </div>);
}