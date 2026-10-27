# Team 7 API contract

Base path: `/api/v1/admin`.
All routes require `Authorization: Bearer <JWT>` and an admin role.

## List contract
`GET /users`, `/bookings`, `/payments`, `/cancellations`, `/audit-logs`

Query parameters: `page`, `pageSize` (1–100), `search`, `sortBy`, `sortOrder`, plus resource-specific filters.

Response:
```json
{"success":true,"data":[],"page":1,"pageSize":20,"total":0,"totalPages":0}
```

## Dashboard
`GET /dashboard`

Returns `stats`, `recent`, `revenue`, and `routes` generated from database views/functions.

## Analytics
`GET /analytics`

Returns daily revenue, popular routes and train occupancy.

## Monitoring
`GET /monitoring` returns API health, latency and Redis status.
`GET /monitoring/api` returns recent API request telemetry.
`GET /monitoring/pnr` returns PNR-related API telemetry when PNR paths have been recorded.

Errors use:
```json
{"success":false,"error":{"code":"ADMIN_REQUIRED","message":"Administrator access is required."}}
```
