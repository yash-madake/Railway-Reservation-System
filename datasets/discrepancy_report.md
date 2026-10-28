# Yatrio Team 3 — Dataset Discrepancy & Conflict Report

> **Dataset Scope**:
> 1. `Train_details_22122017.csv` $\rightarrow$ Cleaned: `Train_details_22122017_cleaned.csv`
> 2. `isl_wise_train_detail_03082015_v1.csv` $\rightarrow$ Cleaned: `isl_wise_train_detail_03082015_cleaned.csv`
> 3. `Indian_Railway_Reservation_System.xlsx` $\rightarrow$ Cleaned: `Indian_Railway_Reservation_System_cleaned.xlsx`

---

## 1. Executive Summary of Discrepancies

| Discrepancy Category | `Train_details_22122017.csv` | `isl_wise_train_detail_03082015_v1.csv` | `Indian_Railway_Reservation_System.xlsx` | Resolution Status |
| :--- | :--- | :--- | :--- | :--- |
| **Corrupted / Broken Rows** | **5 split-line pairs** (10 rows corrupted with `NA` padding) | 0 rows | 0 rows | **Resolved**: Repaired into 5 valid records; 0 nulls remain. |
| **Missing Values (Nulls)** | 5 arrival, 5 departure, 5 distance, 10 source/dest nulls | 0 nulls | 0 nulls | **Resolved**: 100% eliminated after line repair. |
| **Leading/Trailing Whitespace** | 49 cells in Train Name | **55,947** station codes, **65,207** station names, **39,563** train names | Minimal | **Resolved**: Whitespace stripped across all text fields. |
| **Duplicate Sequence Numbers** | 0 trains (100% unique sequence indexing) | **103 trains** have duplicate `islno` | 0 | **Documented & Preserved**: Multi-leg interleaved schedules documented. |
| **Decreasing Distances** | 0 trains | **65 trains** have at least one decreasing-distance transition in stored row order | 0 | **Documented**: 65 trains show at least one adjacent distance decrease in the cleaned file’s stored row order. This is a data-quality flag, not proof of an invalid route; multi-leg/slip routes may explain some cases. |
| **Legitimate Repeated Visits** | **20 trains** (30 repeated stops) | **111 trains** (290 repeated stops) | 0 | **Preserved**: Loop/circuit trains (e.g. Palace on Wheels) protected. |
| **Route Endpoint Mismatches** | **463 trains** (origin $\ne$ source), **462 trains** (terminus $\ne$ dest) | **31 trains** (origin $\ne$ source), **4 trains** (terminus $\ne$ dest) | 0 | **Logged**: Rake-sharing / slip routes flagged without dropping stops. |
| **Schedule / Timing Conflicts** | Historical timetable snapshot (Dec 2017) | Historical timetable snapshot (Aug 2015) | Synthetic operational model (Oct 2026) | **62.5% arrival times conflict**: Versioned historical baselines maintained. |
| **Code Evolution & Renaming** | Uses historical codes (`BCT`, `HBJ`) | Uses historical codes (`BCT`, `HBJ`) | Uses modern codes (`MMCT`, `RKMP`, `20801`, `22436`) | **Resolved**: Cross-reference aliases added in cleaned workbook. |

---

## 2. Missing Values & Line Corruptions

### 2.1 The 5 Split-Line Corruptions in 2017 CSV
In `Train_details_22122017.csv`, an unescaped newline within the station name `KALGURKI H\nK` at station code `KGIH` split 5 single records into 10 broken fragments:

```
[Row 2310] 6919,UBL-BJP SPL,33,KGIH,KALGURKI H,NA,NA,NA,NA,NA,NA,NA
[Row 2311] K,12:16:00,12:17:00,214,UBL,HUBLI JN.,BJP,BIJAPUR JN,NA,NA,NA,NA

[Row 2322] 6920,BJP-UBL SPL,6,KGIH,KALGURKI H,NA,NA,NA,NA,NA,NA,NA
[Row 2323] K,14:15:00,14:16:00,33,BJP,BIJAPUR JN,UBL,HUBLI JN.,NA,NA,NA,NA

[Row 135828] 56905,BJP-UBL PASS,14,KGIH,KALGURKI H,NA,NA,NA,NA,NA,NA,NA
[Row 135829] K,07:46:00,07:47:00,142,SUR,SOLAPUR,UBL,HUBLI JN.,NA,NA,NA,NA

[Row 135886] 56906,UBL-BJP PASS,29,KGIH,KALGURKI H,NA,NA,NA,NA,NA,NA,NA
[Row 135887] K,18:46:00,18:47:00,214,UBL,HUBLI JN.,SUR,SOLAPUR,NA,NA,NA,NA

[Row 140470] 57641,BGK PASS,19,KGIH,KALGURKI H,NA,NA,NA,NA,NA,NA,NA
[Row 140471] K,14:54:00,14:55:00,142,SUR,SOLAPUR,GDG,GADAG JN.,NA,NA,NA,NA
```

**Reconstruction & Repair**:
Each pair was reassembled into a single valid record with Station Name `KALGURKI HK`, restoring all missing arrival/departure times, distance, and origin/destination stations.
- **Before Repair**: 186,124 rows, 10 rows with missing values, columns forced to `object` dtype.
- **After Repair**: 186,119 rows, 0 missing values, clean `int64` and `time` data types.

---

## 3. Duplicates & Sequence Integrity

> **Distance-count methodology:** The cleaned 2015 CSV was checked in its stored row order, grouped by train number. A train is counted once if any adjacent `Distance` value decreases. This reproducible check finds **65 trains** (677 decreasing adjacent transitions). The earlier figure of 73 was not reproducible from the delivered cleaned file and has been corrected. Do not reorder or “repair” these routes automatically without validating their separate legs.

### 3.1 Exact Duplicate Rows
- `Train_details_22122017.csv`: **0 exact duplicate rows**.
- `isl_wise_train_detail_03082015_v1.csv`: **0 exact duplicate rows**.

### 3.2 Duplicate Sequence Numbers in 2015 CSV (103 Trains)
In the 2015 dataset, **103 trains** contain duplicate sequence numbers (`islno`).
- **Root Cause**: Multi-leg schedules, bifurcated rakes, or slip-coach sections were merged under a single train number without a sub-route / leg identifier.
- **Representative Case 1: Train 1156**
  - Section A: Pandharpur (`PVR`) to Manmad (`MMR`), starting at `islno=1`, distance `0 km`.
  - Section B: Jalamb (`JM`) to Khamgaon (`KMN`), starting at `islno=1`, distance `673 km`.
  - The records alternate row-by-row: `(islno=1, JM)`, `(islno=1, PVR)`, `(islno=2, KMN)`, `(islno=2, KWV)`.
- **Representative Case 2: Train 5010**
  - Interleaves Gorakhpur (`GKP`) branch with Jhajha (`JAJ`) / Jasidih (`JSME`) section:
  - `islno=1, GKP (0 km)` $\rightarrow$ `islno=1, SGG (440 km)` $\rightarrow$ `islno=2, CC (25 km)` $\rightarrow$ `islno=2, JAJ (568 km)`.
- **Handling**: These records are preserved intact in `isl_wise_train_detail_03082015_cleaned.csv` to avoid discarding valid stations, but documented here as non-linear multi-leg schedules.

### 3.3 Legitimate Repeated Station Visits (Do Not De-duplicate!)
Automated de-duplication based on `(Train No, Station Code)` would corrupt legitimate railway circuits:
- **`Train_details_22122017.csv`**: **20 trains** (30 repeated stops).
  - Train `290` (*Palace on Wheels*): Originates and terminates at Delhi Safdarjung (`DSJ`).
  - Train `477` (*Full Tariff Rate charter*): Visits `CNB`, `BNW`, `SSA`, `ROK`, `MGS`, `HSR`, `DSJ` multiple times in a tour loop.
  - Trains `52591`–`52597` (*Darjeeling Himalayan Railway Joyrides*): Loops from Darjeeling (`DJ`) $\rightarrow$ Ghum (`GHUM`) $\rightarrow$ Darjeeling (`DJ`).
- **`isl_wise_train_detail_03082015_v1.csv`**: **111 trains** (290 repeated stops).

---

## 4. Route Endpoint & Metadata Inconsistencies

### 4.1 Header Source/Destination vs Route Trajectory (2017 CSV: 463 Trains)
In 463 trains, the first station in `SEQ=1` does not match the `Source Station` header column, or the last station does not match `Destination Station`.

| Train No | Train Name | Scheduled Route (SEQ 1 $\rightarrow$ Last) | Header Metadata (Source $\rightarrow$ Destination) | Analysis / Explanation |
| :---: | :--- | :--- | :--- | :--- |
| `7062` | `VLNK-BZA` | `VLNK` (Velankanni) $\rightarrow$ `TPTY` (Tirupati) | `BZA` (Vijayawada) $\rightarrow$ `COA` (Kakinada Port) | Slip coach / link service with parent train header preserved. |
| `8064` | `BQA-KGP DEMU` | `YPR` (Yesvantpur) $\rightarrow$ `HWH` (Howrah) | `BQA` (Bankura) $\rightarrow$ `KGP` (Kharagpur) | Severe metadata mislabeling; contains the full route of Yesvantpur-Howrah Superfast Express. |
| `91393` | `WAD1` | `CSMT` (Mumbai CSMT) $\rightarrow$ `VDLR` (Vadala Road) | `CSTM` $\rightarrow$ `VDLR` | Station code evolution: `CSMT` in sequence, historical `CSTM` in header. |

---

## 5. Timetable & Schedule Drift (2015 vs 2017)

Across the **2,465 common trains** operating across **57,476 common train-station stops**:

```
Total Common Train-Station Stops: 57,476
├── Arrival Times:
│   ├── Matching (Unchanged):  21,544 (37.5%)
│   └── Conflicting (Drifted): 35,932 (62.5%)
└── Departure Times:
    ├── Matching (Unchanged):  24,635 (42.9%)
    └── Conflicting (Drifted): 32,841 (57.1%)
```

**Route Evolution**:
- **1,048 trains (42.5%)**: Maintained identical stop counts between 2015 and 2017.
- **1,417 trains (57.5%)**: Experienced route restructuring (stops added, removed, or bypassed).

> [!IMPORTANT]
> The two CSV files cannot be merged into a single schedule table. They represent distinct chronological timetable snapshots (August 2015 vs December 2017).

---

## 6. Excel Workbook Discrepancies & Enhancements

> **Fare data limitation:** The `Fare_Matrix` values are illustrative/demo values and have not been verified as official Indian Railways fares. They must not be presented as live or authoritative fares. The added `> 2000 km` rows and `CC` rows are likewise illustrative. The matrix does not currently cover `CC` above 2000 km or classes `2S`, `3E`, and `EC`; do not invent values to fill these gaps.

### 6.1 Train Number & Station Code Evolution
1. **Train 20801 (*Magadh Express*)**:
   - Present in Excel `Trains` as `20801`.
   - In 2015 and 2017 historical CSVs, Magadh Express operated under train number **`12401`** (IPR $\rightarrow$ NDLS).
   - *Enhancement*: Added historical cross-reference `12401` in `Indian_Railway_Reservation_System_cleaned.xlsx`.
2. **Train 22436 (*Vande Bharat Express*)**:
   - Present in Excel `Trains` as `22436` (NDLS $\rightarrow$ BSB).
   - Inaugurated in February 2019; does not exist in 2015 or 2017 historical datasets.
   - *Enhancement*: Tagged as `Modern Addition (Post-2017)` in cleaned workbook.
3. **Station `MMCT` (Mumbai Central)**:
   - Present in Excel as `MMCT`. Historical code in both CSVs is **`BCT`**.
   - *Enhancement*: Added `BCT` historical code mapping in `Stations` sheet.
4. **Station `RKMP` (Rani Kamlapati)**:
   - Present in Excel as `RKMP`. Historical code in both CSVs is **`HBJ`** (Habibganj, renamed in Nov 2021).
   - *Enhancement*: Added `HBJ` historical code mapping in `Stations` sheet.

### 6.2 Fare Matrix Gaps
1. **Missing Distance Slab `> 2000 km`**:
   - Trains 12626 (3,035 km), 12424 (2,427 km), 12650 (2,611 km), and 12213 (2,367 km) all exceed 2,000 km.
   - *Enhancement*: Added distance slab `> 2000` for classes `SL`, `3A`, `2A`, `1A` in `Fare_Matrix`.
2. **Missing Seat Classes**:
   - Class `CC` (AC Chair Car) is booked in `PNR_Master` (Train 12002 Bhopal Shatabdi) and defined in `Lookup_Tables`, but was absent from `Fare_Matrix`.
   - *Enhancement*: Added `CC` fare rows for slabs `1 - 500`, `501 - 1000`, `1001 - 2000` in `Fare_Matrix`.

### 6.3 PNR Master Records
- The 20 reservation records in `PNR_Master` are synthetic demonstration transactions with journey dates in **October 2026**.
- Total Fare values are flat integer values.
- *Enhancement*: Added a data nature flag (`Sample Demo Record (Oct 2026)`) and updated the subtitle to ensure strict segregation from any operational booking data.
