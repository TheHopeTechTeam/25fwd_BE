# 25fwd_BE / givingtest

Express backend that accepts donation submissions, charges them through TapPay, and persists successful payments into PostgreSQL via a BullMQ worker pool. Use this document as the single place to recall how the pieces fit together when you need to change the service later.

Keep in mind that this repo intentionally stays small—there is no ORM, no migration system, and the queue/worker live in the same Node process. That simplicity makes it easy to reason about, but it also means you must remember the manual steps (Redis, Postgres schema, env vars) whenever you pick it up again.

## How the system hangs together
- **Entry point (`index.js`)** – boots Express, sessions, JSON parser, CORS, and mounts two routes: `POST /api/payment` and `POST /api/getall`.
- **Payment controller (`controllers/giving.js`)** – validates incoming payloads (including the `cardholder.campus` flag the frontend now passes), calls TapPay, converts the record into a DB-friendly shape, and enqueues a job on the `tappay-payments` BullMQ queue. Five workers (hardcoded) pull jobs and write rows to Postgres.
- **Email service (`services/emailService.js` + `emails/givingSuccess.html`)** – once TapPay confirms a payment, the controller asks this module to send an HTML receipt through the Google Workspace mailbox (`noreply@thehope.co`).
- **Data layer (`models/giving.js` + `db.js`)** – uses `pg` to insert/read from the `confgive` table. Schema definition lives in `schema.sql` so you can recreate the database quickly, including the `is_success` flag and `env` (sandbox/production) columns.
- **Supporting files** – `stresstest.yaml` (Artillery load scenario), `AGENTS.md` (notes), and `package.json` for dependencies/scripts.

### Request lifecycle
1. Frontend sends `{ prime, amount, cardholder }` to `POST /api/payment`.
2. Controller builds TapPay request: partner key, merchant ID, amount, currency, and combines `phoneCode` + `phone_number` for the `details` string.
3. TapPay response is returned immediately to the client. Only records with `status === 0` are persisted.
4. Successful responses yield a job containing the structured donation record (now including `campus`) plus `rec_trade_id`, `is_success`, and the detected environment (`sandbox` when the TapPay API URL contains `sandbox`, otherwise `production`). BullMQ workers consume the job and call `givingModel.add`, which inserts into `confgive`.
5. External systems poll `POST /api/getall` with `{ googleSecret, lastRowID }`. When the secret matches `GOOGLE_SECRET`, the API streams every row with `id > lastRowID`.

### Queue/worker specifics
- Queue name: `tappay-payments` (BullMQ). Redis connection string set with `REDIS_URL`.
- Default job options: 3 attempts, exponential backoff (1s base), 10s timeout.
- Number of workers: hardcoded to 5 in `controllers/giving.js` (`WORKERS` env is validated but not yet wired in code).
- Payload stored per job: one `givingData` object with the cardholder fields plus TapPay response metadata.

### Email notifications
- Transport: Gmail SMTP (Workspace account `noreply@thehope.co`) authenticated with a 2FA-protected App Password, so there is no OAuth refresh token to refresh.
- Template + subject: `emails/givingSuccess.html` is checked into the repo; edit it directly when you get the final copy. The file only interpolates `{{greeting}}` (either the donor's name or “家人”) plus the optional `{{banner}}` block. Set the email subject by adding a top-of-file comment such as `<!-- subject: 感謝你在 FORWARD 季節中的慷慨參與 -->`.
- Banner: point `GIVING_EMAIL_BANNER_PATH` to a local image; it gets attached and referenced in the HTML template through `cid:giving-banner`. If the placeholder `{{banner}}` is omitted, the banner is prepended automatically.
- Execution point: after TapPay returns `status === 0` and the job is queued, `sendGivingSuccessEmail` fires asynchronously. Missing env vars or recipient email simply skips the send without breaking the payment flow.

#### Gmail App Password checklist
1. In the Workspace admin console, make sure IMAP/SMTP is enabled for `noreply@thehope.co`.
2. Sign in as that mailbox, enable 2-Step Verification, then issue an App Password (choose “Mail” + “Other (Custom name)” to label it for this API).
3. Store the mailbox and generated password in `.env` as `GOOGLE_SENDER_EMAIL` and `GOOGLE_APP_PASSWORD`.
4. Point `GIVING_EMAIL_BANNER_PATH` to the banner asset and edit `emails/givingSuccess.html` once the final title/body arrive.

## Prerequisites
- **Node.js 18+ / npm 9+** – runtime for Express + BullMQ.
- **Redis 6+** – required for the BullMQ queue (`REDIS_URL`).
- **PostgreSQL 13+** – provides the `confgive` table (see `schema.sql`).
- **TapPay credentials** – `PARTNER_KEY`, `MERCHANT_ID`, and the REST endpoint (`TAPPAY_API`) pointing to sandbox or production.
- **Google Workspace mailbox** – enable 2-Step Verification on `noreply@thehope.co`, generate a Gmail App Password, and keep it alongside the sender address so the SMTP transport can authenticate.

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
| `GOOGLE_SENDER_EMAIL` | The actual Workspace mailbox (e.g., `noreply@thehope.co`). |
| `GOOGLE_APP_PASSWORD` | App Password generated for that mailbox (requires 2FA). |
| `GIVING_EMAIL_BANNER_PATH` | Optional – absolute/relative path to the banner image the email service should inline. |

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
GOOGLE_SENDER_EMAIL=noreply@thehope.co
GOOGLE_APP_PASSWORD=abcd efgh ijkl mnop
GIVING_EMAIL_BANNER_PATH=./assets/banner.png
```

## Database schema & migrations
`schema.sql` is the single source of truth. Because the file uses `CREATE TABLE IF NOT EXISTS`, it will **not** retroactively add columns to an existing table. Whenever the schema changes, either drop/recreate the table or run manual `ALTER TABLE` statements (e.g., we now add `campus` with `ALTER TABLE public.confgive ADD COLUMN IF NOT EXISTS campus TEXT;`).

Key columns inside `public.confgive`:
- `name`, `amount` (int), `currency` (3-char)
- `date` (stored as `DATE`, set by the service)
- `phone_number`, `email`, `receipt` (bool), `paymenttype`, `upload`
- Receipt metadata: `receiptname`, `nationalid`, `company`, `taxid`, `note`, `campus`
- TapPay metadata: `tp_trade_id`, `is_success` (bool), `env` (`sandbox` or `production`), `created_at`

Manual migration helper when you see `column "is_success" does not exist`:
```sql
ALTER TABLE public.confgive
  ADD COLUMN IF NOT EXISTS is_success BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS env VARCHAR(16) NOT NULL DEFAULT 'sandbox' CHECK (env IN ('sandbox','production'));
```
Rerun `schema.sql` afterwards to catch any other drift and keep the index (`confgive_tp_trade_id_idx`) in place.

## Local setup & boot
1. Install JS dependencies:
   ```bash
   npm install
   ```
2. Bring up Redis and Postgres (Docker or local instances both work). Use `schema.sql` to ensure the table matches expectations (`is_success` boolean + `env` varchar columns now included):
   ```bash
   psql -h $HOST -U $PGUSER -d $DATABASE -f schema.sql
   ```
   - If the table already existed before, run the `ALTER TABLE` block from the section above (including the new `campus` column) or drop/recreate the table so the missing columns are added.
3. Add `.env` with the values above, then start the API:
   ```bash
   npm start
   ```
4. Watch the console for `server listening on port: <PORT>`. BullMQ workers also log job progress/completions.
5. (Email) Once the API is online, hit the health flow with a test payment that includes `cardholder.email`. The console logs `emailService` messages showing whether the SMTP transport authenticated and if the email was dispatched.

## Endpoints you can call
- `POST /api/payment`
  - Body: `{ prime, amount, cardholder }`, where `cardholder` includes `phoneCode`, `phone_number`, `name`, `email`, optional receipt metadata, and the new `campus` key that identifies which campus initiated the donation.
  - Behavior: Calls TapPay immediately; queues a DB write only when `status === 0`. The email service also triggers here (best-effort) to send an HTML receipt via Gmail. Errors during TapPay surface as HTTP 500 with `Failed to add payment to processing queue.`
- `POST /api/getall`
  - Body: `{ googleSecret, lastRowID }`.
  - Behavior: Requires the secret to match; returns `{ data: [...] }` sorted by `id`. Pass `0` to fetch everything.

## Troubleshooting
- **`column "is_success" of relation "confgive" does not exist`** – The code inserts into `is_success`, but your table predates the column. Add the column manually using the SQL snippet above or drop/recreate the table via `schema.sql`.
- **Queue stuck / Redis errors** – Ensure `REDIS_URL` points to a reachable Redis 6+ instance and that you can `redis-cli -u $REDIS_URL ping` successfully. The worker and the queue share the same process, so any Redis connectivity issue blocks writes.
- **`Missing required environment variables`** – At startup the controller validates `PARTNER_KEY`, `MERCHANT_ID`, `TAPPAY_API`, `CURRENCY`, `REDIS_URL`, `WORKERS`, `GOOGLE_SECRET`. Double-check your `.env` before investigating further.

## Operational tips / future work
- Worker count is fixed at 5 even though `WORKERS` exists – change `numberOfWorkers` in `controllers/giving.js` if you need dynamic sizing.
- `givingData.currency` is hardcoded to `"TWD"`; align this with the `CURRENCY` env for better reporting.
- Logging currently prints full job data and may include PII (phone/email); scrub before deploying broadly.
- `npm test` is a placeholder. Add integration tests that mock TapPay and Postgres for safer refactors.
- Use `stresstest.yaml` with Artillery (`npx artillery run stresstest.yaml`) to simulate bursty payment traffic.

With the above in place you can pick up future feature work (new fields, different storage, etc.) without re-reading the source.
