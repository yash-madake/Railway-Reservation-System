import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, ShieldCheck, AlertTriangle, ArrowLeft, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { paymentService, paymentAttempt } from '@/services/paymentService';

/**
 * The gap between "Razorpay says yes" and "the server agrees".
 *
 * Nothing here decides that a payment succeeded — it only asks. The Checkout
 * handler response proves nothing on its own, so the three values it returns are
 * posted to `/verify`, where the server recomputes the HMAC and re-reads the
 * status from Razorpay. A browser saying "success" is the one input that is
 * never trusted.
 *
 * The attempt is read back from sessionStorage so a refresh here does not lose
 * the payment id and strand the traveller.
 */

const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 20; // ~60s, then hand back to the traveller

export function PaymentProcessing() {
    const navigate = useNavigate();
    const [attempt, setAttempt] = useState(null);
    const [stage, setStage] = useState('verifying');
    const [failure, setFailure] = useState(null);
    const [pollCount, setPollCount] = useState(0);
    const settled = useRef(false);

    // Guard: verification can resolve twice (verify, then a poll that lands on
    // captured). Only the first resolution navigates.
    const finish = (path) => {
        if (settled.current) return;
        settled.current = true;
        paymentAttempt.clear();
        navigate(path, { replace: true });
    };

    const failWith = (title, message, code) => {
        if (settled.current) return;
        settled.current = true;
        paymentAttempt.clear();
        setFailure({ title, message, code });
        setStage('failed');
    };

    // 1. Verify.
    useEffect(() => {
        const stored = paymentAttempt.load();
        if (!stored?.razorpayPaymentId || !stored?.razorpaySignature) {
            navigate('/booking/review', { replace: true });
            return;
        }
        setAttempt(stored);

        (async () => {
            try {
                const result = await paymentService.verify(stored);

                if (result.status === 'captured') {
                    finish('/booking/success');
                    return;
                }
                if (result.status === 'failed') {
                    failWith(
                        'Payment failed',
                        result.failureReason || 'The bank declined this payment. No money has been charged.',
                        result.failureCode,
                    );
                    return;
                }
                // Authorized but not settled — let the gateway finish.
                setStage('polling');
            } catch (err) {
                failWith(
                    'We could not confirm this payment',
                    err?.message || 'Please try paying again.',
                    err?.code,
                );
            }
        })();
        // Runs once. `finish`/`failWith` are guarded by `settled`.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // 2. Poll while the gateway settles.
    useEffect(() => {
        if (stage !== 'polling' || !attempt) return;

        if (pollCount >= POLL_MAX_ATTEMPTS) {
            failWith(
                'Payment is taking longer than expected',
                'Do not pay again — if the money left your account, the booking is still confirmed and the amount is refunded automatically if it does not settle.',
                'PENDING_TIMEOUT',
            );
            return;
        }

        const timerId = setTimeout(async () => {
            setPollCount((n) => n + 1);
            try {
                const result = await paymentService.getStatus(attempt.razorpayOrderId);
                if (result.status === 'captured') {
                    finish('/booking/success');
                } else if (result.status === 'failed') {
                    failWith(
                        'Payment failed',
                        result.failureReason || 'The bank declined this payment. No money has been charged.',
                        result.failureCode,
                    );
                }
                // Still authorized: the next tick tries again.
            } catch {
                // A gateway hiccup must not fail the poll — keep retrying.
            }
        }, POLL_INTERVAL_MS);

        return () => clearTimeout(timerId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stage, pollCount, attempt]);

    if (stage === 'failed') {
        return (<div className="min-h-screen bg-fog/20 flex items-center justify-center px-4 py-16">
          <Card className="max-w-md w-full p-8 text-center space-y-5 border-line-mid shadow-raised rounded-card">
            <div className="size-14 rounded-full bg-error-strong/10 text-error-strong flex items-center justify-center mx-auto">
              <AlertTriangle className="size-7"/>
            </div>
            <div className="space-y-1.5">
              <h1 className="text-h3 font-bold text-ink">{failure?.title}</h1>
              <p className="text-caption text-ink-soft">{failure?.message}</p>
              {failure?.code && (<span className="num text-[11px] text-ink-muted inline-block mt-1">{failure.code}</span>)}
            </div>
            <Button size="lg" fullWidth onClick={() => navigate('/booking/review')} leftIcon={<RefreshCw className="size-4"/>}>
              Try paying again
            </Button>
            <Button variant="ghost" size="sm" fullWidth onClick={() => navigate('/booking/review')} leftIcon={<ArrowLeft className="size-4"/>}>
              Back to review
            </Button>
          </Card>
        </div>);
    }

    return (<div className="min-h-screen bg-fog/20 flex items-center justify-center px-4 py-16">
      <Card className="max-w-md w-full p-8 text-center space-y-6 border-line-mid shadow-raised rounded-card">
        <div className="relative size-16 mx-auto flex items-center justify-center">
          <span className="absolute inset-0 rounded-full bg-royal/10 animate-ping"/>
          <ShieldCheck className="size-8 text-royal relative"/>
        </div>
        <div className="space-y-1.5">
          <h1 className="text-h3 font-bold text-ink">
            {stage === 'verifying' ? 'Confirming your payment' : 'Waiting for your bank'}
          </h1>
          <p className="text-caption text-ink-soft">
            {stage === 'verifying'
              ? 'Verifying the payment signature with Razorpay. This takes a moment — please do not close this page.'
              : 'Your bank has approved the payment and it is settling. This usually takes a few seconds.'}
          </p>
        </div>
        <div className="flex items-center justify-center gap-2 text-caption text-ink-muted">
          <Loader2 className="size-4 animate-spin text-royal"/>
          {attempt?.razorpayOrderId && <span className="num">{attempt.razorpayOrderId}</span>}
        </div>
      </Card>
    </div>);
}