# 25fwd_BE / givingtest

This repository hosts a small Express-based backend that receives donations, charges them via TapPay, and persists successful payments into a Postgres table (`confgive`). The service also exposes an internal endpoint to retrieve newly inserted rows so external systems (e.g., Google Sheets job) can stay in sync.

## High-level architecture
- `index.js` wires Express, sessions, CORS, and two routes: `POST /api/payment` and `POST /api/getall`.
- `controllers/giving.js` handles payment submissions. It validates input, calls TapPay, enqueues DB writes to a BullMQ queue backed by Redis, and exposes a `get` handler that gates access behind a `GOOGLE_SECRET`.
- `models/giving.js` is the Postgres data layer; it inserts into and queries from `confgive` using the shared `pg` pool from `db.js`.
- `stresstest.yaml` is an Artillery scenario for load-testing `POST /api/payment` against either production (`https://confgive.thehope.app`) or local environments.

## Requirements
- Node.js 18+ (ES2022 features, top-level `dotenv` usage, and BullMQ all run well on LTS).
- npm 9+ (ships with Node 18).
- Redis 6+ reachable via `REDIS_URL` for BullMQ job queues.
- PostgreSQL 13+ (or compatible) with a `confgive` table matching the insert columns in `models/giving.js`.
- TapPay sandbox/production credentials (prime tokens must be generated client-side).

## Environment variables
Create a `.env` file in the repo root. All variables below must be present before the server boots—`controllers/giving.js` will throw if any are missing.

| Variable | Description |
| --- | --- |
| `PORT` | Port for Express (defaults to `3000` if unset when using `npm start`). |
| `SESSION_SECRET` | Secret for `express-session`; required even if sessions are short-lived. |
| `ALLOWED_ORIGIN` | Origin allowed by CORS (e.g., `https://confgive.thehope.app`). |
| `PARTNER_KEY` | TapPay partner key for signing API requests. |
| `MERCHANT_ID` | TapPay merchant identifier. |
| `TAPPAY_API` | TapPay REST endpoint (`https://sandbox.tappayapis.com/tpc/payment/pay-by-prime`). |
| `CURRENCY` | Three-letter code sent to TapPay and stored in DB (currently hardcoded to `TWD` when persisting—update code if you change this). |
| `REDIS_URL` | Redis connection string for BullMQ (format: `redis://user:pass@host:port/db`). |
| `WORKERS` | Intended worker count (currently not used; `controllers/giving.js` starts 5 workers regardless). |
| `GOOGLE_SECRET` | Shared secret required by `POST /api/getall`.
| `PGUSER` | Postgres user. |
| `PASSWORD` | Postgres password for the above user. |
| `HOST` | Postgres host (e.g., `localhost`). |
| `PGPORT` | Postgres port (e.g., `5432`). |
| `DATABASE` | Postgres database name that contains `confgive`. |

Example `.env` template:

```
PORT=3000
SESSION_SECRET=replace-me
ALLOWED_ORIGIN=http://localhost:5173
PARTNER_KEY=pk_here
MERCHANT_ID=merchant_here
TAPPAY_API=https://sandbox.tappayapis.com/tpc/payment/pay-by-prime
CURRENCY=TWD
REDIS_URL=redis://localhost:6379
WORKERS=5
GOOGLE_SECRET=super-secret-string
PGUSER=postgres
PASSWORD=postgres
HOST=127.0.0.1
PGPORT=5432
DATABASE=giving
```

## Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Provision backing services:
   - PostgreSQL with a table `confgive` containing at least the columns referenced in `models/giving.js` (`name`, `amount`, `currency`, `date`, `phone_number`, `email`, `receipt`, `paymentType`, `upload`, `receiptName`, `nationalid`, `company`, `taxid`, `note`, `tp_trade_id`).
   - Redis accessible via `REDIS_URL`.
3. Create `.env` (see template above) and ensure TapPay credentials are valid for the chosen environment.

## Running locally
```bash
npm start
```
This runs `node index.js`. The server logs `server listening on port: <PORT>`. Ensure Redis/Postgres are running before starting so BullMQ workers and DB inserts succeed.

### Available endpoints
- `POST /api/payment`: accepts `{ prime, amount, cardholder }`. `cardholder` must include `phoneCode` and `phone_number`. On success, the TapPay response is forwarded immediately while DB writes happen asynchronously via BullMQ.
- `POST /api/getall`: accepts `{ googleSecret, lastRowID }`. When `googleSecret` matches `GOOGLE_SECRET`, it returns all rows with `id > lastRowID`. Use `0` to fetch everything.

## Load testing
Use the provided Artillery config:
```bash
npx artillery run stresstest.yaml
```
Update `config.target` to `http://localhost:<PORT>` for local runs. The scenario issues 800 payment requests over 10 seconds to exercise queue + TapPay integration.

## Operational notes & future tweaks
- BullMQ worker count is currently hardcoded to `5` even though `WORKERS` is read from the environment. Adjust `controllers/giving.js` if dynamic control is needed.
- `CURRENCY` is read from the environment for TapPay but the value saved in Postgres is still the literal string `"TWD"`; align these to avoid mismatched records.
- Add request validation/masking before logging to avoid leaking cardholder data.
- Consider adding health-check endpoints and tests (currently `npm test` exits immediately).
