import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserPlus, Trash2, ArrowRight, Info } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { RouteConnector } from '@/components/ui/RouteConnector';
import { useBooking } from '@/context/BookingContext';
const emptyPassenger = (id) => ({
    id,
    name: '',
    age: '',
    gender: 'Male',
    berthPreference: 'No Preference',
});

let passengerSeq = 0;
const nextPassengerId = () => {
    passengerSeq += 1;
    return `p_${Date.now().toString(36)}_${passengerSeq}`;
};

export function PassengerDetails() {
    const navigate = useNavigate();
    const { selectedTrain, selectedClass, passengers, replacePassengers, setContact, contact: draftContact } = useBooking();

    /**
     * Seeded with one *blank* passenger, never a filled-in example.
     *
     * This used to start the form holding a made-up "Rahul Sharma", and the
     * contact block held a made-up email and phone. A traveller who skimmed the
     * form and pressed next booked a fictional person — and because the name was
     * pre-filled, the field looked validated rather than empty. The example now
     * lives in `placeholder`, which is suggestion text and is never submitted.
     */
    const [localPassengers, setLocalPassengers] = useState(
        passengers && passengers.length > 0 ? passengers : [emptyPassenger(nextPassengerId())]
    );
    /**
     * Seeded from the draft so a back-navigation does not wipe it, but never with
     * a made-up address — a booking addressed to `rahul.sharma@example.com` is
     * worse than one with no contact at all.
     */
    const [contact, setLocalContact] = useState(draftContact ?? { email: '', phone: '' });
    const updateContact = (field, value) => setLocalContact({ ...contact, [field]: value });

    const handleAdd = () => {
        if (localPassengers.length < 6) {
            setLocalPassengers([...localPassengers, emptyPassenger(nextPassengerId())]);
        }
    };
    const handleRemove = (id) => {
        if (localPassengers.length > 1) {
            setLocalPassengers(localPassengers.filter((p) => p.id !== id));
        }
    };
    const handleChange = (id, field, value) => {
        setLocalPassengers(localPassengers.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
    };
    const handleSubmit = (e) => {
        e.preventDefault();

        // Drop rows the traveller blanked out but never deleted. `required`
        // already refuses an empty submit, so reaching here means every row has
        // a name — but guarding is cheap and this list is sent to the server.
        const filled = localPassengers.filter((p) => String(p.name ?? '').trim() !== '');
        if (filled.length === 0) return;

        // Replace, rather than add-and-update. Adding cannot express "one fewer
        // than before", so a passenger removed on this screen stayed in the
        // booking and the seat map went on offering a berth for them.
        replacePassengers(filled.map((p) => ({ ...p, name: String(p.name).trim() })));

        // Persisted here so the ticket is actually addressed. Previously this was
        // local state, thrown away on navigation.
        setContact({ email: contact.email.trim(), phone: contact.phone.trim() });


        navigate('/booking/seat-selection');
    };
    /**
     * Whatever the search step actually chose, and nothing invented if it chose
     * nothing.
     *
     * These fell back to a literal 12951 "Mumbai Rajdhani" in 3A, so opening this
     * page without a search result showed a plausible-looking train rather than
     * admitting the selection was missing.
     */
    const trainName = selectedTrain?.name ?? null;
    const trainNo = selectedTrain?.number ?? null;
    const travelClass = selectedClass ?? selectedTrain?.class ?? null;
    const fromCode = selectedTrain?.source?.code ?? selectedTrain?.source ?? null;
    const toCode = selectedTrain?.destination?.code ?? selectedTrain?.destination ?? null;
    const fromName = selectedTrain?.source?.name ?? fromCode;
    const toName = selectedTrain?.destination?.name ?? toCode;

    /*
     * No fare is quoted on this step.
     *
     * This page used to price the journey in the browser from a hardcoded rate
     * card (1A 2850 / 2A 1850 / 3A 1250 / SL 480) plus a flat Rs 70 per
     * traveller and 5% GST. Those figures matched nothing in
     * `train_classes.base_fare`, and the tax model differed from the server's.
     * The server prices the journey from the price list, pro-rates it by
     * distance, and applies tax once plus a flat per-booking fee, so any
     * estimate shown here was a number the traveller would be charged against.
     */
    return (<div className="mx-auto w-full max-w-content px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* 3-Step Stepper Header */}
      <div className="rounded-card border border-line-mid bg-white p-4 shadow-card">
        <div className="grid grid-cols-3 text-center">
          <div className="flex flex-col items-center gap-1.5 border-b-2 border-azure pb-2">
            <span className="num size-7 rounded-full bg-azure text-white text-xs font-bold flex items-center justify-center">1</span>
            <span className="text-caption font-semibold text-ink">Passengers</span>
          </div>
          <div className="flex flex-col items-center gap-1.5 border-b-2 border-transparent pb-2 text-ink-soft">
            <span className="num size-7 rounded-full bg-fog text-ink-soft text-xs font-bold flex items-center justify-center">2</span>
            <span className="text-caption font-medium">Seats</span>
          </div>
          <div className="flex flex-col items-center gap-1.5 border-b-2 border-transparent pb-2 text-ink-soft">
            <span className="num size-7 rounded-full bg-fog text-ink-soft text-xs font-bold flex items-center justify-center">3</span>
            <span className="text-caption font-medium">Review &amp; Pay</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-8 items-start">
        {/* Left Form Column */}
        <form id="passenger-form" onSubmit={handleSubmit} className="space-y-6">
          <div>
            <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft">
              Step 1 of 3
            </span>
            <h1 className="text-h2 font-bold tracking-tight text-ink mt-0.5">
              Passenger Information
            </h1>
            <p className="text-body text-ink-soft mt-1">
              Enter traveller details matching government-issued ID proofs.
            </p>
          </div>

          {/* Passenger Cards */}
          <div className="space-y-4">
            {localPassengers.map((passenger, index) => (<Card key={passenger.id} className="p-5 space-y-4 relative border-line-mid">
                <div className="flex justify-between items-center border-b border-line pb-3">
                  <div className="flex items-center gap-2">
                    <span className="num size-6 rounded-full bg-royal/10 text-royal font-bold text-xs flex items-center justify-center">
                      {index + 1}
                    </span>
                    <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-ink">
                      Passenger {index + 1}
                    </h3>
                  </div>

                  {localPassengers.length > 1 && (<button type="button" onClick={() => handleRemove(passenger.id)} className="text-caption font-semibold text-error-strong hover:underline flex items-center gap-1 cursor-pointer">
                      <Trash2 className="size-3.5"/> Remove
                    </button>)}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-4">
                  <div className="sm:col-span-6 space-y-1.5">
                    <label className="block text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft">
                      Full Name *
                    </label>
                    <input type="text" placeholder="e.g. Rahul Sharma" value={passenger.name} onChange={(e) => handleChange(passenger.id, 'name', e.target.value)} required className="h-11 w-full rounded-control border border-line-strong bg-white px-3.5 text-sm font-medium text-ink focus:border-royal focus:ring-4 focus:ring-royal/15"/>
                  </div>

                  <div className="sm:col-span-2 space-y-1.5">
                    <label className="block text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft">
                      Age *
                    </label>
                    <input type="number" min="1" max="110" placeholder="32" value={passenger.age} onChange={(e) => handleChange(passenger.id, 'age', e.target.value)} required className="num h-11 w-full rounded-control border border-line-strong bg-white px-3.5 text-sm font-medium text-ink focus:border-royal focus:ring-4 focus:ring-royal/15"/>
                  </div>

                  <div className="sm:col-span-4 space-y-1.5">
                    <label className="block text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft">
                      Gender *
                    </label>
                    <select value={passenger.gender} onChange={(e) => handleChange(passenger.id, 'gender', e.target.value)} className="h-11 w-full rounded-control border border-line-strong bg-white px-3 text-sm font-medium text-ink focus:border-royal focus:ring-4 focus:ring-royal/15 cursor-pointer">
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Transgender">Transgender</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1.5 pt-2">
                  <label className="block text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft">
                    Berth Preference
                  </label>
                  <select value={passenger.berthPreference} onChange={(e) => handleChange(passenger.id, 'berthPreference', e.target.value)} className="h-11 w-full rounded-control border border-line-strong bg-white px-3 text-sm font-medium text-ink focus:border-royal focus:ring-4 focus:ring-royal/15 cursor-pointer sm:w-1/2">
                    <option value="No Preference">No Preference</option>
                    <option value="Lower">Lower Berth</option>
                    <option value="Middle">Middle Berth</option>
                    <option value="Upper">Upper Berth</option>
                    <option value="Side Lower">Side Lower</option>
                    <option value="Side Upper">Side Upper</option>
                  </select>
                </div>
              </Card>))}

            {localPassengers.length < 6 && (<button type="button" onClick={handleAdd} className="w-full h-12 rounded-control border border-dashed border-royal/40 text-royal font-semibold text-sm hover:bg-royal/5 flex items-center justify-center gap-2 transition-colors cursor-pointer">
                <UserPlus className="size-4"/> Add Traveller ({localPassengers.length}/6)
              </button>)}
          </div>

          {/* Contact Details Card */}
          <Card className="p-5 space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-ink border-b border-line pb-2">
              Ticket Delivery & Contact
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft">
                  Mobile Number *
                </label>
                <div className="flex">
                  <span className="h-11 px-3.5 bg-surface-sunken border border-r-0 border-line-strong rounded-l-control text-sm font-semibold text-ink flex items-center">
                    +91
                  </span>
                  <input type="tel" pattern="[0-9]{10}" value={contact.phone} onChange={(e) => updateContact('phone', e.target.value)} required className="num h-11 w-full rounded-r-control border border-line-strong bg-white px-3.5 text-sm font-medium text-ink focus:border-royal focus:ring-4 focus:ring-royal/15"/>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft">
                  Email Address *
                </label>
                <input type="email" value={contact.email} onChange={(e) => updateContact('email', e.target.value)} required className="h-11 w-full rounded-control border border-line-strong bg-white px-3.5 text-sm font-medium text-ink focus:border-royal focus:ring-4 focus:ring-royal/15"/>
              </div>
            </div>
          </Card>
        </form>

        {/* Right Sticky Fare Summary */}
        <aside className="space-y-4 sticky top-20">
          <Card className="p-6 space-y-6 shadow-raised border-line-mid">
            <div>
              <span className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-ink-soft">
                Journey Summary
              </span>
              <h2 className="text-h4 font-semibold text-ink mt-0.5">
                {trainNo} {trainName}
              </h2>
              <span className="num text-caption font-semibold text-royal">
                Class: {travelClass} · General Quota
              </span>
            </div>

            {/* The route that was searched, not a fixed NDLS to MMCT. */}
            <RouteConnector fromCode={fromCode} toCode={toCode} fromName={fromName} toName={toName} size="sm"/>

            <div className="border-t border-line pt-4 text-sm text-ink-soft">
              The fare is calculated on the server once the journey and berths are set, and shown
              on the review step before anything is charged.
            </div>

            <Button form="passenger-form" type="submit" size="lg" className="w-full">
              Continue to Seat Selection
              <ArrowRight className="size-4"/>
            </Button>
          </Card>

          {/* Test Notice */}
          <div className="rounded-card border border-azure/25 bg-blue-100 p-4 text-caption text-body flex items-start gap-2.5">
            <Info className="size-4 text-royal shrink-0 mt-0.5"/>
            <p>
              <b className="font-semibold text-royal">Valid ID required.</b> Carry original government ID (Aadhaar, Passport, Voter ID) during the journey.
            </p>
          </div>
        </aside>
      </div>
    </div>);
}
