# Team 7 release checklist

- [ ] Admin login rejects missing, malformed and expired JWTs.
- [ ] Passenger/user roles receive HTTP 403 on admin APIs.
- [ ] Dashboard loads populated, empty and database-error states.
- [ ] Users, bookings, payments, cancellations and audit logs use server-side pagination.
- [ ] Search, filters and sort fields are allowlisted and parameterized.
- [ ] Reporting views and stored functions are installed successfully.
- [ ] Audit records are created for Team 7 administrative actions.
- [ ] API monitoring records duration and HTTP status for admin endpoints.
- [ ] Redis is optional for local development and used when configured.
- [ ] No secrets are committed; `.env.example` contains placeholders only.
- [ ] `npm run lint` and `npm run build` pass for the frontend.
- [ ] Backend starts with `npm start` and migrations run cleanly.
- [ ] Admin pages remain keyboard accessible and responsive at 320px.
- [ ] No production destructive booking/payment/seat/PNR mutation is performed by Team 7.
