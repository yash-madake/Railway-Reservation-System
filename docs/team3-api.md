# Team 3 API & Handoff Documentation

**Module:** Train Details, Route Schedules, Quotas, Fares & Seat Availability  
**Base Path:** `/trains`  
**Authentication:** Public read access for timetable and availability (matches IRCTC public search).

---

## 1. Train Schedule API
**Endpoint:** `GET /trains/:trainNo/schedule`  
**Description:** Retrieves the complete station-by-station schedule in stop sequence order.

### Success Response (200 OK):
```json
{
  "success": true,
  "message": "Train schedule retrieved successfully",
  "data": {
    "trainNumber": "12951",
    "source": { "code": "MMCT", "name": "MUMBAI CENTRAL", "departureTime": "16:35:00" },
    "destination": { "code": "NDLS", "name": "NEW DELHI", "arrivalTime": "08:32:00" },
    "totalDistanceKm": 1384,
    "totalStops": 7,
    "stops": [
      {
        "stopSequence": 1,
        "stationCode": "MMCT",
        "stationName": "MUMBAI CENTRAL",
        "city": "Mumbai",
        "state": "Maharashtra",
        "railwayZone": "WR",
        "arrivalTime": null,
        "departureTime": "16:35",
        "distanceKm": 0,
        "dayOffset": 1,
        "haltMinutes": 0,
        "platform": "1"
      },
      {
        "stopSequence": 2,
        "stationCode": "BVI",
        "stationName": "BORIVALI",
        "city": "Mumbai",
        "state": "Maharashtra",
        "railwayZone": "WR",
        "arrivalTime": "17:03",
        "departureTime": "17:05",
        "distanceKm": 30,
        "dayOffset": 1,
        "haltMinutes": 2,
        "platform": "6"
      }
    ]
  }
}
```

---

## 2. Train Seat Availability & ConfirmTkt Predictions API
**Endpoint:** `GET /trains/:trainNo/availability`  
**Description:** Retrieves date, class, and quota-specific seat availability with ConfirmTkt prediction percentage.

### Query Parameters:
* `date` (Required: `YYYY-MM-DD`, must not be in past)
* `class` (Optional: `1A`, `2A`, `3A`, `SL`, `CC`, `2S`. When omitted, returns all supported classes)
* `quota` (Optional: `GN`, `TQ`, `LD`, `PT`, `SS`. Default: `GN`)

### Success Response (200 OK):
```json
{
  "success": true,
  "message": "Train availability retrieved successfully",
  "data": {
    "trainNumber": "12951",
    "trainName": "MUMBAI RAJDHANI",
    "journeyDate": "2026-11-05",
    "travelClass": "3A",
    "quota": "GN",
    "status": "AVAILABLE",
    "availableSeats": 42,
    "racSeats": 0,
    "waitingSeats": 0,
    "confirmationProbability": 100,
    "formattedStatus": "AVAILABLE-42",
    "isDemoData": true
  }
}
```

---

## 3. Dynamic Distance Slab Fare API
**Endpoint:** `GET /trains/:trainNo/fare`  
**Description:** Calculates the exact pro-rata distance slab fare and GST based on boarding and destination stations.

### Query Parameters:
* `from` (Station code, e.g. `MMCT` or `BVI`)
* `to` (Station code, e.g. `NDLS`)
* `class` (Travel class, e.g. `3A`)

### Success Response (200 OK):
```json
{
  "success": true,
  "data": {
    "trainNumber": "12951",
    "fromStation": "BVI",
    "toStation": "NDLS",
    "distanceKm": 1354,
    "travelClass": "3A",
    "baseFare": 1750.00,
    "totalFare": 2231.00
  }
}
```

---

## 4. Train Classes API
**Endpoint:** `GET /trains/:trainNo/classes`  
**Description:** Returns all accommodation classes offered by this train.

---

## 5. Quotas API
**Endpoint:** `GET /quotas` or `GET /trains/quotas`  
**Description:** Returns active Indian Railways booking quotas (`GN`, `TQ`, `LD`, `PT`, `SS`).

---

## 6. Team 4 Handoff Contract (Booking & Passenger Reservation)

Team 4's reservation engine depends on Team 3's `availability_snapshots` table:

### Step 1: Pre-booking Availability Check
Team 4 calls `GET /trains/:trainNo/availability?date=:date&class=:class&quota=:quota` to verify `availableSeats >= passengers.length`.

### Step 2: Atomic Reservation Lock
During `POST /bookings/confirm`, Team 4 runs this parameterized update inside a database transaction:
```sql
START TRANSACTION;

UPDATE availability_snapshots
   SET available_seats = available_seats - :passengerCount
 WHERE train_id = :trainId
   AND journey_date = :journeyDate
   AND class_code = :classCode
   AND quota_code = :quotaCode
   AND available_seats >= :passengerCount;

-- If rows affected == 0, seats were taken: ROLLBACK and answer 409 Conflict.
COMMIT;
```

### Step 3: Automated Trigger Logging
Updating `availability_snapshots` automatically fires Team 3's `trg_log_availability_changes` trigger, logging previous and new counts into `availability_history`.
