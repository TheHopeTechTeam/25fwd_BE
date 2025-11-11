# 25fwd_BE / givingtest

Express backend that accepts donation submissions, charges them through TapPay, and persists successful payments into PostgreSQL via a BullMQ worker pool. Use this document as the single place to recall how the pieces fit together when you need to change the service later.

## How the system hangs together
- **Entry point (`index.js`)** – boots Express, sessions, JSON parser, CORS, and mounts two routes: `POST /api/payment` and `POST /api/getall`.
- **Payment controller (`controllers/giving.js`)** – validates incoming payloads, calls TapPay, converts the record into a DB-friendly shape, and enqueues a job on the `tappay-payments` BullMQ queue. Five workers (hardcoded) pull jobs and write rows to Postgres.
- **Data layer (`models/giving.js` + `db.js`)** – uses `pg` to insert/read from the `confgive` table. Schema definition lives in `schema.sql` so you can recreate the database quickly.
- **Supporting files** – `stresstest.yaml` (Artillery load scenario), `AGENTS.md` (notes), and `package.json` for dependencies/scripts.

### Request lifecycle
1. Frontend sends `{ prime, amount, cardholder }` to `POST /api/payment`.
2. Controller builds TapPay request: partner key, merchant ID, amount, currency, and combines `phoneCode` + `phone_number` for the `details` string.
3. TapPay response is returned immediately to the client. Only records with `status === 0` are persisted.
4. Successful responses yield a job containing the structured donation record plus `rec_trade_id`. BullMQ workers consume the job and call `givingModel.add`, which inserts into `confgive`.
5. External systems poll `POST /api/getall` with `{ googleSecret, lastRowID }`. When the secret matches `GOOGLE_SECRET`, the API streams every row with `id > lastRowID`.

## Prerequisites
- **Node.js 18+ / npm 9+** – runtime for Express + BullMQ.
- **Redis 6+** – required for the BullMQ queue (`REDIS_URL`).
- **PostgreSQL 13+** – provides the `confgive` table (see `schema.sql`).
- **TapPay credentials** – `PARTNER_KEY`, `MERCHANT_ID`, and the REST endpoint (`TAPPAY_API`) pointing to sandbox or production.

## Environment variables
Create a `.env` in the repo root before starting the app. The controller throws during startup if any item in this list is missing.

| Variable | Purpose |
| --- | --- |
| `PORT` | Port Express listens on (`3000` default when omitted). |
| `SESSION_SECRET` | Secret for `express-session`. |
| `ALLOWED_ORIGIN` | CORS allow-list (single origin). |
| `PARTNER_KEY` | TapPay partner key (also sent as `x-api-key`). |
| `MERCHANT_ID` | TapPay merchant ID. |
| `TAPPAY_API` | TapPay endpoint, e.g. `https://sandbox.tappayapis.com/tpc/payment/pay-by-prime`. |
| `CURRENCY` | Currency code used in the TapPay request (DB insert still hardcodes `TWD`). |
| `REDIS_URL` | Redis connection string for BullMQ (`redis://user:pass@host:port/db`). |
| `WORKERS` | Expected worker count (currently unused; code spawns 5 workers). |
| `GOOGLE_SECRET` | Shared secret for `POST /api/getall`. |
| `PGUSER` | PostgreSQL user. |
| `PASSWORD` | PostgreSQL password. |
| `HOST` | PostgreSQL host. |
| `PGPORT` | PostgreSQL port, default `5432`. |
| `DATABASE` | PostgreSQL database containing `confgive`. |

Example template:
```env
PORT=3000
SESSION_SECRET=replace-me
ALLOWED_ORIGIN=http://localhost:5173
PARTNER_KEY=pk_test
MERCHANT_ID=merchant_test
TAPPAY_API=https://sandbox.tappayapis.com/tpc/payment/pay-by-prime
CURRENCY=TWD
REDIS_URL=redis://localhost:6379
WORKERS=5
GOOGLE_SECRET=super-secret
PGUSER=postgres
PASSWORD=postgres
HOST=127.0.0.1
PGPORT=5432
DATABASE=giving
```

## Local setup & boot
1. Install JS dependencies:
   ```bash
   npm install
   ```
2. Bring up Redis and Postgres (Docker or local instances both work). Use `schema.sql` to ensure the table matches expectations:
   ```bash
   psql -h $HOST -U $PGUSER -d $DATABASE -f schema.sql
   ```
3. Add `.env` with the values above, then start the API:
   ```bash
   npm start
   ```
4. Watch the console for `server listening on port: <PORT>`. BullMQ workers also log job progress/completions.

## Endpoints you can call
- `POST /api/payment`
  - Body: `{ prime, amount, cardholder }`, where `cardholder` includes `phoneCode`, `phone_number`, `name`, `email`, optional receipt metadata, etc.
  - Behavior: Calls TapPay immediately; queues a DB write only when `status === 0`. Errors during TapPay surface as HTTP 500 with `Failed to add payment to processing queue.`
- `POST /api/getall`
  - Body: `{ googleSecret, lastRowID }`.
  - Behavior: Requires the secret to match; returns `{ data: [...] }` sorted by `id`. Pass `0` to fetch everything.

## Operational tips / future work
- Worker count is fixed at 5 even though `WORKERS` exists – change `numberOfWorkers` in `controllers/giving.js` if you need dynamic sizing.
- `givingData.currency` is hardcoded to `"TWD"`; align this with the `CURRENCY` env for better reporting.
- Logging currently prints full job data and may include PII (phone/email); scrub before deploying broadly.
- `npm test` is a placeholder. Add integration tests that mock TapPay and Postgres for safer refactors.
- Use `stresstest.yaml` with Artillery (`npx artillery run stresstest.yaml`) to simulate bursty payment traffic.

With the above in place you can pick up future feature work (new fields, different storage, etc.) without re-reading the source.
