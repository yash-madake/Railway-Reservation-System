# Yatrio Team 7 — start here

This repository contains the existing Yatrio/RailSetu application plus the Team 7 admin, analytics and system-infrastructure implementation.

## Requirements
- Node.js 20+
- MySQL 8+
- Optional Redis 7+ for dashboard caching/health reporting

## 1. Backend

```bash
cd backend
npm install
copy .env.example .env
npm run migrate
npm run seed:team7
npm run dev
```

Set the database values in `.env`. Do not commit it.

Default demo admin created by the seed script:
- Email: `admin@yatrio.in`
- : `Admin@12345` unless `ADMIN_SEED_PASSWORD` is set before seeding.

## 2. Frontend

In a second terminal:

```bash
cd Frontend
npm install
npm run dev
```

If the backend is not served through the Vite proxy in your environment, set `VITE_API_URL=http://localhost:5000/api/v1` in `Frontend/.env.local`.

## 3. Team 7 endpoints

- `GET /api/v1/admin/dashboard`
- `GET /api/v1/admin/users`
- `GET /api/v1/admin/bookings`
- `GET /api/v1/admin/payments`
- `GET /api/v1/admin/cancellations`
- `GET /api/v1/admin/audit-logs`
- `GET /api/v1/admin/reports`
- `GET /api/v1/admin/analytics`
- `GET /api/v1/admin/monitoring`
- `GET /api/v1/admin/monitoring/api`
- `GET /api/v1/admin/monitoring/pnr`

All Team 7 endpoints require a valid JWT and the `admin` role.

## 4. Validation

```bash
cd Frontend
npm run lint
npm run build
```

The build could not be executed in the current sandbox because package installation/network access timed out; the source was statically checked where possible.

## 5. Documentation

- `brandkit.md` — supplied Yatrio frontend system
- `docs/team7-api.md` — API contract
- `docs/team7-performance-report.md` — EXPLAIN/performance review procedure
- `docs/team7-release-checklist.md` — release checklist
