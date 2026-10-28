# Team 7 performance review

## Queries reviewed
- User list: filters are applied before pagination and dynamic sorting uses an allowlist.
- Booking list: journey date, status and route filters are indexed.
- Payment list: status/date are indexed.
- Audit log list: created time, module/action and actor are indexed.
- Dashboard: reporting views/functions avoid downloading raw rows to React.

## EXPLAIN procedure
Run these against the configured MySQL database before release:

```sql
EXPLAIN SELECT * FROM bookings WHERE journey_date >= CURRENT_DATE() AND status = 'CONFIRMED' ORDER BY created_at DESC LIMIT 20;
EXPLAIN SELECT COUNT(*) FROM audit_logs WHERE created_at >= NOW() - INTERVAL 7 DAY;
EXPLAIN SELECT origin_code,destination_code,COUNT(*) FROM bookings WHERE status <> 'CANCELLED' GROUP BY origin_code,destination_code;
```

Check for unexpected full table scans, filesorts and unindexed joins. The migration adds the principal Team 7 indexes; production workloads should be rechecked with real cardinalities.
