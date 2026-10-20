// Centralized Yatrio formatting helpers (brandkit.md §10.3)
export const fare = (amount) => {
    const num = typeof amount === 'string' ? parseFloat(amount) : amount;
    if (isNaN(num))
        return '₹0';
    return `₹${num.toLocaleString('en-IN')}`;
};
/**
 * Paise to a rupee string. Razorpay's API, and therefore every amount the
 * payment endpoints return, is in paise — passing one of those to `fare()`
 * would render a 100x-too-small price, so use this instead.
 */
export const paise = (amount) => {
    const num = typeof amount === 'string' ? parseFloat(amount) : Number(amount);
    if (!Number.isFinite(num))
        return '₹0.00';
    return `₹${(num / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
export const time24 = (isoOrTime) => {
    if (!isoOrTime)
        return '--:--';
    if (isoOrTime.includes(':') && isoOrTime.length <= 5)
        return isoOrTime;
    try {
        const d = new Date(isoOrTime);
        if (isNaN(d.getTime()))
            return isoOrTime;
        return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    }
    catch {
        return isoOrTime;
    }
};
export const delayMin = (m) => {
    if (m > 0)
        return `+${m}m`;
    if (m < 0)
        return `${m}m`;
    return 'On time';
};
export const dateLong = (dateInput) => {
    if (!dateInput)
        return '';
    try {
        const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
        if (isNaN(d.getTime()))
            return String(dateInput);
        return d.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' });
    }
    catch {
        return String(dateInput);
    }
};
export const km = (n) => {
    const num = typeof n === 'string' ? parseFloat(n) : n;
    if (isNaN(num))
        return '0 km';
    return `${num.toLocaleString('en-IN')} km`;
};
