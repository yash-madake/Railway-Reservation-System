import React, { createContext, useContext, useEffect, useState } from 'react';
const BookingContext = createContext(undefined);

/**
 * The booking draft outlives a page reload.
 *
 * Payment is addressed by bookingRef, and the traveller can reach the payment
 * stage by refreshing, by using the back button from Checkout, or by opening
 * the URL directly. With state held only in React, all of those wiped the
 * selection — and because bookingRef went with it, a refresh silently minted a
 * *second* booking and a second order. sessionStorage keeps the draft for the
 * tab's lifetime, which is the right scope: a booking should not follow
 * someone to another tab or survive the browser closing.
 */
const DRAFT_KEY = 'yatrio.booking.draft';

const readDraft = () => {
    try {
        const raw = sessionStorage.getItem(DRAFT_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
};

const writeDraft = (draft) => {
    try {
        sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
        // Private mode with storage disabled. The flow still works within the
        // session; only reload survival is lost.
    }
};

export function BookingProvider({ children }) {
    const [draft] = useState(readDraft);
    const [searchParams, setSearchParamsState] = useState(draft?.searchParams ?? null);
    const [selectedTrain, setSelectedTrainState] = useState(draft?.selectedTrain ?? null);
    const [selectedClass, setSelectedClass] = useState(draft?.selectedClass ?? '');
    const [selectedCoach, setSelectedCoach] = useState(draft?.selectedCoach ?? '');
    const [selectedSeats, setSelectedSeats] = useState(draft?.selectedSeats ?? []);
    const [passengers, setPassengers] = useState(draft?.passengers ?? []);
    /**
     * Where the ticket and any refund go.
     *
     * Collected on the passenger step and sent with the booking. It used to live
     * only in that page's local state, so it was discarded on navigation — the
     * ticket was addressed to whatever `user?.email` happened to be, and a guest
     * who typed a contact email got a booking with no contact at all.
     */
    const [contact, setContact] = useState(draft?.contact ?? { email: '', phone: '' });
    // Minted by the server (POST /bookings/confirm) and required by
    // /payments/create-order. Held here so a reload on the payment stage still
    // points at the same booking instead of minting a second one.
    const [bookingRef, setBookingRef] = useState(draft?.bookingRef ?? null);

    /**
     * Which seats the server is currently holding for `bookingRef`.
     *
     * Stored so the review screen can notice that the traveller went back and
     * changed their selection. Without it, changing seats silently leaves the old
     * ones held for five minutes against nobody, and the next attempt at those
     * seats comes back as "being paid for by someone else" — by the same person.
     */
    const [heldSeats, setHeldSeats] = useState(draft?.heldSeats ?? []);

    useEffect(() => {
        writeDraft({ searchParams, selectedTrain, selectedClass, selectedCoach, selectedSeats, passengers, contact, bookingRef, heldSeats });
    }, [searchParams, selectedTrain, selectedClass, selectedCoach, selectedSeats, passengers, contact, bookingRef, heldSeats]);

    const setSearchParams = (params) => setSearchParamsState(params);
    const setSelectedTrain = (train) => setSelectedTrainState(train);
    const addSeat = (seat) => {
        setSelectedSeats(prev => [...prev, seat]);
    };
    /**
     * Remove a chosen berth.
     *
     * Takes either a composite `coach-seatNumber` key or a bare seat number.
     * The composite is what the seat map passes, because berth numbers repeat
     * across coaches and a bare number would take out seat 24 in every coach at
     * once. The bare form is kept for anything that still holds only a number.
     */
    const removeSeat = (seatKey) => {
        setSelectedSeats(prev =>
            String(seatKey).includes('-')
                ? prev.filter((s) => `${s.coach}-${s.number}` !== String(seatKey))
                : prev.filter((s) => String(s.number) !== String(seatKey)),
        );
    };
    const addPassenger = (passenger) => {
        setPassengers(prev => [...prev, passenger]);
    };
    const removePassenger = (id) => {
        setPassengers(prev => prev.filter(p => p.id !== id));
    };
    const updatePassenger = (id, data) => {
        setPassengers(prev => prev.map(p => p.id === id ? { ...p, ...data } : p));
    };
    /**
     * Replace the whole manifest in one update.
     *
     * The passenger form edits a copy and submits the whole list, so it needs to
     * be able to say "this is now the list" — including *shorter* than it was.
     * Adding and updating individually cannot express a removal, which is how a
     * traveller who deleted the second passenger in the form still ended up with
     * two on the seat map. One functional update also avoids the interleaving
     * that a loop of add/update/remove calls would depend on ordering for.
     */
    const replacePassengers = (next) => {
        setPassengers(next ?? []);
    };
    const resetBooking = () => {
        setSelectedTrainState(null);
        setSelectedClass('');
        setSelectedCoach('');
        setSelectedSeats([]);
        setPassengers([]);
        setContact({ email: '', phone: '' });
        setBookingRef(null);
        setHeldSeats([]);
        setSearchParamsState(null);
        try {
            sessionStorage.removeItem(DRAFT_KEY);
        } catch {
            /* nothing to do */
        }
    };
    const value = {
        searchParams,
        selectedTrain,
        selectedClass,
        selectedCoach,
        selectedSeats,
        passengers,
        contact,
        setContact,
        bookingRef,
        setBookingRef,
        heldSeats,
        setHeldSeats,
        // A new booking must mint a new reference. Without this the draft's
        // reference survives a completed payment and the next booking tries to
        // pay against an order that is already captured.
        resetBookingRef: () => {
            setBookingRef(null);
            setHeldSeats([]);
        },
        setSearchParams,
        setSelectedTrain,
        setSelectedClass,
        setSelectedCoach,
        addSeat,
        removeSeat,
        addPassenger,
        removePassenger,
        updatePassenger,
        replacePassengers,
        resetBooking
    };
    return <BookingContext.Provider value={value}>{children}</BookingContext.Provider>;
}
export const useBooking = () => {
    const context = useContext(BookingContext);
    if (context === undefined) {
        throw new Error('useBooking must be used within a BookingProvider');
    }
    return context;
};
