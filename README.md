# RailSetu

**Railway Ticket Booking and Management System**

RailSetu is a modern railway reservation and management system designed to provide a seamless experience for passengers and administrators.

## 🚆 Project Overview

RailSetu provides a complete platform for railway ticket reservation, passenger management, train management, booking management, and administrative operations.

The frontend is built with React and JavaScript/JSX, while the backend is built with Node.js and Express.js.

---

## ✨ Features

### 👤 Passenger

* Railway/train search
* Train details and route information
* Passenger details management
* Seat selection
* Ticket booking
* Booking review
* Payment interface
* PNR status
* My bookings
* Ticket/booking details
* Profile management

### 🛠️ Admin

* Dashboard
* Train management
* Station management
* Schedule management
* Booking management
* User management
* Fare management
* Reports
* Audit logs

---

## 🛠️ Tech Stack

### Frontend

* **React**
* **Vite**
* **CSS / Tailwind CSS**
* **React Router**
* **Lucide Icons**

### Backend

* **Node.js**
* **Express.js**
* **JWT Authentication**
* **bcryptjs**

### Database

* MySQL (the existing repository database integration)

---

## 📁 Project Structure

```text
RailSetu/
├── backend/
│   ├── src/
│   │   ├── controllers/
│   │   ├── middleware/
│   │   ├── routes/
│   │   ├── services/
│   │   └── server.js
│   ├── package.json
│   └── package-lock.json
│
├── public/
├── src/
│   ├── api/
│   ├── assets/
│   ├── components/
│   │   ├── auth/
│   │   ├── layout/
│   │   └── ui/
│   ├── context/
│   ├── data/
│   ├── layouts/
│   ├── pages/
│   │   ├── admin/
│   │   ├── passenger/
│   │   └── public/
│   ├── services/
│   ├── types/
│   ├── App.tsx
│   ├── main.tsx
│   └── router.tsx
│
├── package.json
├── package-lock.json
├── vite.config.ts
├── tsconfig.json
└── README.md
```

---

# ▶️ How to Run the Project

## 1. Clone the Repository

```bash
git clone https://github.com/BROKEN0103/RailSetu.git
```

Navigate into the project:

```bash
cd RailSetu
```

---

## 2. Install Frontend Dependencies

From the project root:

```bash
npm install
```

---

## 3. Install Backend Dependencies

Navigate to the backend:

```bash
cd backend
```

Install the backend dependencies:

```bash
npm install
```

Then return to the project root:

```bash
cd ..
```

---

# 🔐 Environment Variables

The backend uses environment variables for configuration.

Create a `.env` file inside the `backend` directory:

```text
backend/
└── .env
```

Add the required environment variables according to your backend configuration.

For example:

```env
PORT=5000
JWT_SECRET=your_secret_key
```

> Do not commit your `.env` file to GitHub if it contains passwords, API keys, database credentials, or other secrets.

---

# 🚀 Start the Application

The frontend and backend should be run in **two separate terminals**.

## Terminal 1 — Start Backend

From the project root:

```bash
cd backend
npm run dev
```

The backend will start using Nodemon.

You should see output similar to:

```text
[nodemon] starting `node src/server.js`
```

---

## Terminal 2 — Start Frontend

Open another terminal and go to the project root:

```bash
cd RailSetu
```

Then run:

```bash
npm run dev
```

Vite will display the local development URL, usually something similar to:

```text
http://localhost:5173
```

Open that URL in your browser.

---

# 🔄 Running Both Servers

You need both servers running at the same time:

```text
Terminal 1
──────────────
cd backend
npm run dev

        ↓

Backend
http://localhost:5000
```

and:

```text
Terminal 2
──────────────
npm run dev

        ↓

Frontend
http://localhost:5173
```

The frontend communicates with the backend through the configured API endpoints.

---

# 🧪 Development

### Frontend

```bash
npm run dev
```

### Backend

```bash
cd backend
npm run dev
```

### Build Frontend

```bash
npm run build
```

### Preview Production Build

```bash
npm run preview
```

---

# 🔮 Future Development

The project can be extended with:

* User authentication and authorization
* Train and station APIs
* Real-time train search
* Database-driven seat availability
* Ticket booking
* Automatic PNR generation
* Booking cancellation
* Fare calculation
* Payment processing
* RAC/waitlist management
* Administrative APIs
* Reports and analytics

---

# 📌 Project Status

| Component       | Status                      |
| --------------- | --------------------------- |
| Frontend        | ✅ Completed                 |
| Backend         | 🚧 Under Development        |
| Database        | 🚧 Planned / In Development |
| API Integration | 🚧 In Development           |
| Authentication  | 🚧 In Development           |

---

# 👨‍💻 Author

**BROKEN0103**

---

## 📄 License

This project is developed for educational and development purposes.

## Team 7 — Admin, Analytics & System Infrastructure

Team 7 extends the existing Yatrio/RailSetu application with a real admin control centre rather than static dashboard mock data.

### Admin routes
- `/admin` — operational KPIs and recent bookings
- `/admin/users` — server-side user search and pagination
- `/admin/bookings` — server-side booking search and pagination
- `/admin/payments` — payment reporting
- `/admin/cancellations` — cancellation reporting
- `/admin/analytics` and `/admin/reports` — reporting charts
- `/admin/audit-logs` — auditable administrative events
- `/admin/monitoring` — API latency/error and Redis health

### Team 7 API
All endpoints below require a valid JWT with `role=admin`:
`GET /api/v1/admin/dashboard`, `/users`, `/bookings`, `/payments`, `/cancellations`, `/audit-logs`, `/analytics`, `/monitoring`.

### Database
The current repository already uses MySQL, so Team 7 preserves that existing integration instead of introducing a second database engine. Migration `009_team7_admin.sql` adds booking/payment/cancellation reporting tables, audit/API logs, indexes, reporting views and stored functions.

### Local setup
1. Copy `backend/.env.example` to `backend/.env` and set your local MySQL values.
2. Run `cd backend && npm install && npm run migrate`.
3. Run `npm run seed:team7` to create the demo administrator and reporting data. The default demo password is `Admin@12345`; set `ADMIN_SEED_PASSWORD` before seeding if you want another value.
4. Start the backend with `npm run dev`.
5. In another terminal, run `cd Frontend && npm install && npm run dev`.

Never commit `.env`, database credentials, JWT secrets or payment credentials.

## Admin portal: import the supplied railway datasets

The project includes the source files supplied for the admin data layer under `backend/data/source/` and a normalized extraction of the workbook under `backend/data/import/workbook-data.json`.

From the `backend` directory, after setting up `.env` and running migrations:

```powershell
npm run import:provided-data
```

This imports/upserts station master data, train master records, ordered route stops, and sample PNR records from the supplied sources into MySQL. It is designed to be re-run safely for station/train/PNR records. The CSV datasets are historic (2015/2017), and the workbook contains illustrative sample PNRs; these are not live railway or IRCTC feeds. The importer does not fabricate payment transactions or user accounts from passenger names.

### Admin data boundaries

- Stations, trains, and route stops are seeded from the supplied sources.
- PNR records in the workbook are imported into the bookings table as reference/demo booking rows.
- Payment, cancellation, user, and API-monitoring pages depend on their corresponding MySQL tables and will show empty states until those tables have real records.
- Keep admin JWT authorization enabled. Do not make admin endpoints public to work around an authentication error.
