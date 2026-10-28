# Yatrio Team 3 — Comprehensive Data Dictionary

> **Scope**: Data Dictionary for Cleaned Railway Datasets:
> 1. `Train_details_22122017_cleaned.csv`
> 2. `isl_wise_train_detail_03082015_cleaned.csv`
> 3. `Indian_Railway_Reservation_System_cleaned.xlsx`

---

## 1. Primary Train-Route Dataset: `Train_details_22122017_cleaned.csv`

| # | Column Name | Data Type | Nullable? | Description | Constraints & Business Rules | Example |
| :---: | :--- | :---: | :---: | :--- | :--- | :--- |
| 1 | `Train No` | `int64` | No | Indian Railways scheduled train number. | 3 to 5 digits integer; unique train identifier. | `12951` |
| 2 | `Train Name` | `string` | No | Official operational train name. | Uppercase alphanumeric; stripped of leading/trailing spaces. | `MUMBAI RAJDHANI` |
| 3 | `SEQ` | `int64` | No | Sequential halt order along train route. | Starts at `1`; strictly increasing (`1, 2, ... N`) with zero gaps. | `1` |
| 4 | `Station Code` | `string` | No | Standard IR station alphanumeric alpha code. | 2 to 5 uppercase characters. | `BCT` |
| 5 | `Station Name` | `string` | No | Full human-readable station name. | Title/Uppercase text; stripped of whitespace. | `MUMBAI CENTRAL` |
| 6 | `Arrival time` | `time` | No | Scheduled train arrival time at station halt. | Format `HH:MM:SS` (24-hour clock). `00:00:00` at origin indicates not applicable. | `00:00:00` |
| 7 | `Departure Time` | `time` | No | Scheduled train departure time from station. | Format `HH:MM:SS` (24-hour clock). Terminal halt records arrival time. | `16:35:00` |
| 8 | `Distance` | `int64` | No | Cumulative distance in kilometers from origin. | Starts at `0` at `SEQ=1`; non-decreasing along route. | `0` |
| 9 | `Source Station` | `string` | No | Alphanumeric station code of train origin. | 2 to 5 uppercase characters. | `BCT` |
| 10 | `Source Station Name` | `string` | No | Full name of train origin station. | Alphanumeric text. | `MUMBAI CENTRAL` |
| 11 | `Destination Station` | `string` | No | Alphanumeric station code of final terminus. | 2 to 5 uppercase characters. | `NDLS` |
| 12 | `Destination Station Name`| `string`| No | Full name of final terminus station. | Alphanumeric text. | `NEW DELHI` |

---

## 2. Secondary Historical Dataset: `isl_wise_train_detail_03082015_cleaned.csv`

| # | Column Name | Data Type | Nullable? | Description | Constraints & Business Rules | Example |
| :---: | :--- | :---: | :---: | :--- | :--- | :--- |
| 1 | `Train No.` | `int64` | No | Scheduled train number (August 2015). | Integer train identifier. | `12951` |
| 2 | `train Name` | `string` | No | Train name as recorded in 2015 schedule. | Stripped of fixed-width padding. | `MUMBAI RAJDHANI` |
| 3 | `islno` | `int64` | No | Intermediate station sequence number. | Interleaved duplicate values indicate multi-leg / slip rakes. | `1` |
| 4 | `station Code` | `string` | No | IR station alpha code (stripped). | Uppercase alpha code. | `BCT` |
| 5 | `Station Name` | `string` | No | Full station name (stripped). | Uppercase text. | `MUMBAI CENTRAL` |
| 6 | `Arrival time` | `time` | No | Scheduled arrival time. | Format `HH:MM:SS`. | `00:00:00` |
| 7 | `Departure time` | `time` | No | Scheduled departure time. | Format `HH:MM:SS`. `00:00:00` indicates placeholder halt. | `16:35:00` |
| 8 | `Distance` | `int64` | No | Cumulative distance in kilometers. | Integer distance. | `0` |
| 9 | `Source Station Code` | `string` | No | Origin station code. | Uppercase alpha code. | `BCT` |
| 10 | `source Station Name` | `string` | No | Origin station name. | Alphanumeric text. | `MUMBAI CENTRAL` |
| 11 | `Destination station Code`| `string`| No | Terminus station code. | Uppercase alpha code. | `NDLS` |
| 12 | `Destination Station Name`| `string`| No | Terminus station name. | Alphanumeric text. | `NEW DELHI` |

---

## 3. Excel Relational Workbook: `Indian_Railway_Reservation_System_cleaned.xlsx`

### 3.1 Sheet: `Trains`
| Column | Name | Type | Description |
| :--- | :--- | :---: | :--- |
| A | `Train No` | `int64` | Modern 5-digit scheduled train number. |
| B | `Train Name` | `string` | Full express / premier service train name. |
| C | `Origin Station` | `string` | Originating station code (modern standard). |
| D | `Destination Station` | `string` | Terminating station code (modern standard). |
| E | `Departure Time` | `time` | Scheduled departure time from origin. |
| F | `Arrival Time` | `time` | Scheduled arrival time at destination. |
| G | `Distance (km)` | `int64` | Total route mileage in kilometers. |
| H | `Type` | `string` | Service category: `Rajdhani`, `Shatabdi`, `Duronto`, `Superfast`, `Vande Bharat`. |
| I | `Zone` | `string` | Operating Railway Zone (`WR`, `NR`, `ER`, `SR`, `ECR`, `SWR`, `NFR`, `WCR`). |
| J | `Historical Train No` | `string` | Historical number in 2015/2017 CSVs (`12401` for Magadh Exp `20801`). |
| K | `Historical Route Codes` | `string` | Historical origin-destination codes (`BCT - NDLS`, `NDLS - HBJ`). |
| L | `Historical Dataset Status` | `string` | Verification status against historical CSV records. |

---

### 3.2 Sheet: `Stations`
| Column | Name | Type | Description |
| :--- | :--- | :---: | :--- |
| A | `Station Code` | `string` | Modern alphanumeric station code. |
| B | `Station Name` | `string` | Official station name. |
| C | `City` | `string` | City served. |
| D | `State` | `string` | State / Union Territory. |
| E | `Railway Zone` | `string` | Zonal railway headquarters. |
| F | `Number of Platforms` | `int64` | Total operating platforms at junction. |
| G | `Historical Code` | `string` | Station code in 2015/2017 CSVs (`BCT` for MMCT, `HBJ` for RKMP). |
| H | `Historical Validation & Code Status` | `string` | Verification note explaining renaming history. |

---

### 3.3 Sheet: `Fare_Matrix`

> **Important:** All fares and charges in this sheet are illustrative/demo values, not verified official railway fares. Do not use them for real booking or fare quotations. The current matrix has no `CC` row for `> 2000 km`, and does not define fares for `2S`, `3E`, or `EC`; these gaps are intentionally left unfilled rather than guessing amounts.
| Column | Name | Type | Description |
| :--- | :--- | :---: | :--- |
| A | `Distance Slab (km)` | `string` | Distance tier: `1 - 500`, `501 - 1000`, `1001 - 2000`, `> 2000`. |
| B | `Class Code` | `string` | Travel class code: `SL`, `3A`, `2A`, `1A`, `CC`. |
| C | `Class Description` | `string` | Full accommodation category name. |
| D | `Base Fare (₹)` | `int64` | Slab base fare in Indian Rupees. |
| E | `Reservation Fee (₹)` | `int64` | Fixed reservation booking charge. |
| F | `Superfast Charge (₹)` | `int64` | Supplementary charge for Superfast services. |
| G | `GST %` | `float` | Applicable Goods and Services Tax (0% for SL, 5% for AC). |

---

### 3.4 Sheet: `PNR_Master`
| Column | Name | Type | Description |
| :--- | :--- | :---: | :--- |
| A | `PNR Number` | `string` | 10-digit Passenger Name Record booking number. |
| B | `Train No` | `int64` | Train number booked. |
| C | `Journey Date` | `date` | Date of travel (sample demo dates: Oct 2026). |
| D | `Passenger Name` | `string` | Passenger full name. |
| E | `Age` | `int64` | Passenger age in years. |
| F | `Gender` | `string` | Gender code: `M`, `F`. |
| G | `Berth Preference` | `string` | `LB`, `MB`, `UB`, `SL`, `SU`, `SUB`, `WINDOW`. |
| H | `Class Code` | `string` | Accommodation class code booked. |
| I | `Quota Code` | `string` | Booking quota: `GN`, `TQ`, `PT`, `LD`, `SS`. |
| J | `Total Fare (₹)` | `int64` | Total fare paid (synthetic demonstration integer). |
| K | `Current Status` | `string` | Ticket status: `CNF` (Confirmed), `RAC`, `WL`, `CAN`. |
| L | `Data Nature` | `string` | Explicit segregation flag: `Sample Demo Record (Oct 2026)`. |

---

### 3.5 Sheet: `Lookup_Tables`
- **Class Codes**:
  - `1A`: AC First Class (AC)
  - `2A`: AC 2-Tier (AC)
  - `3A`: AC 3-Tier (AC)
  - `3E`: AC 3-Tier Economy (AC)
  - `CC`: AC Chair Car (AC)
  - `EC`: Executive Chair Car (AC)
  - `SL`: Sleeper Class (Non-AC)
  - `2S`: Second Sitting (Non-AC)
- **Quota Codes**:
  - `GN`: General Quota (Standard Booking)
  - `TQ`: Tatkal Quota (Premium Charges Apply)
  - `PT`: Premium Tatkal (Dynamic Pricing)
  - `LD`: Ladies Quota (Solo / Female Passengers)
  - `SS`: Senior Citizen (Lower Berth Priority)
  - `HP`: Handicapped Quota (Special Concession)
  - `DF`: Defense Quota (Armed Forces Priority)
- **Status Codes**:
  - `CNF`: Confirmed Seat / Berth
  - `RAC`: Reservation Against Cancellation
  - `WL`: Waitlisted Ticket
  - `CAN`: Cancelled Booking
  - `NOSB`: No Seat Berth (Child)

---

## 4. Cross-Dataset Column Equivalency Map

| Semantic Concept | `Train_details_22122017_cleaned.csv` | `isl_wise_train_detail_03082015_cleaned.csv` | `Indian_Railway_Reservation_System_cleaned.xlsx` |
| :--- | :--- | :--- | :--- |
| **Train Identifier** | `Train No` | `Train No.` | `Trains!A (Train No)`, `PNR_Master!B (Train No)` |
| **Train Title** | `Train Name` | `train Name` | `Trains!B (Train Name)` |
| **Halt Order** | `SEQ` | `islno` | — |
| **Station Code** | `Station Code` | `station Code` | `Stations!A (Station Code)` |
| **Station Name** | `Station Name` | `Station Name` | `Stations!B (Station Name)` |
| **Arrival Time** | `Arrival time` | `Arrival time` | `Trains!F (Arrival Time)` *(Destination)* |
| **Departure Time** | `Departure Time` | `Departure time` | `Trains!E (Departure Time)` *(Origin)* |
| **Mileage** | `Distance` | `Distance` | `Trains!G (Distance (km))` |
| **Origin Station Code** | `Source Station` | `Source Station Code` | `Trains!C (Origin Station)` |
| **Origin Station Name** | `Source Station Name` | `source Station Name` | `Stations!B (via lookup)` |
| **Terminus Station Code**| `Destination Station` | `Destination station Code` | `Trains!D (Destination Station)` |
| **Terminus Station Name**| `Destination Station Name`| `Destination Station Name`| `Stations!B (via lookup)` |
