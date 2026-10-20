import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Info } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';

/**
 * Train creation — removed, because there is nothing to save to.
 *
 * This form had pre-filled capacity figures, all seven running days checked by
 * default (so any train created here silently became a daily service), three
 * hardcoded station options out of the twenty-two in the database, and a four-item
 * class list missing CC, EC and 2S — codes the booking path itself accepts.
 *
 * Its `handleSave` called `preventDefault()`, discarded every field, and
 * navigated to the train list as if the train had been created.
 *
 * The reason is structural, not a missing handler: every route in
 * `Backend/src/routes/adminRoutes.js` is a `router.get(...)`. There is no
 * POST /admin/trains. Keeping a create form would mean keeping a button that
 * looks like it persists data and does not.
 *
 * Trains are seeded via `Backend/src/scripts/seedRailwayData.js`. Adding write
 * endpoints is the work needed to bring this page back.
 */
export default function CreateTrain() {
    const navigate = useNavigate();

    return (
        <div className="p-6 max-w-4xl mx-auto space-y-6">
            <h1 className="text-2xl font-bold text-foreground">Create Train</h1>

            <Card>
                <CardContent className="p-0">
                    <EmptyState
                        title="Not available — the admin API is read-only"
                        description="Trains cannot be created from the console yet. Every admin route on the server is a GET, so there is no endpoint to post a new train to. The previous form here discarded its input and navigated away as though it had saved."
                        action={
                            <div className="flex flex-wrap gap-3 justify-center">
                                <Button onClick={() => navigate('/admin/trains')}>View existing trains</Button>
                            </div>
                        }
                    />
                </CardContent>
            </Card>

            <Card>
                <CardContent className="p-5 flex items-start gap-3">
                    <Info className="size-5 text-primary shrink-0 mt-0.5" />
                    <div className="text-sm text-muted space-y-1">
                        <p>
                            <b className="text-foreground">How trains are added today:</b> run{' '}
                            <code className="num">npm run db:seed</code> in <code className="num">Backend/</code>, which
                            loads trains, routes, classes and stations through the seed scripts.
                        </p>
                        <p>
                            To support editing here, the backend needs POST/PUT/DELETE on the admin train,
                            station, timetable and fare routes, and validation that the supplied stops and classes
                            exist.
                        </p>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
