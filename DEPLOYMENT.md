# Deployment Guide

LaxaLab supports three deployment targets:

1. **Render Blueprint** (`render.yaml`) — free evaluation deployment; not for production data.
2. **Railway (managed)** — no servers to run or patch.
3. **Self-hosted Docker Compose** (`docker-compose.prod.yml`) — full TLS via
   Let's Encrypt, nginx in front of the Next.js frontend and NestJS backend.

Pick one per environment. The environment variables are the same either way
(see `.env.production.example`).

## Target 1: Render (free evaluation)

The root [render.yaml](./render.yaml) Blueprint describes six resources:

- `laxalab-web-learner` and `laxalab-web-admin`: separate web origins.
- `laxalab-api-public` and `laxalab-api-admin`: separate APIs. The public API
  refuses admin-audience tokens; the admin API accepts only admin sessions.
- `laxalab-postgres`: one shared PostgreSQL database.
- `laxalab-redis`: a private shared cache and rate-limit store used by both APIs.

Both APIs use the same Cloudflare R2 bucket for uploads, so avatars, course
media, chat attachments, assignments, receipts, and CVs remain available across
the two API origins. Private receipts and CVs are still served only by their
authenticated download routes; R2 itself is not exposed as a public bucket.

### Before creating the Blueprint

1. Create a Cloudflare R2 bucket and an API token with read/write access to that
   bucket. Record the S3 endpoint (`https://<account-id>.r2.cloudflarestorage.com`),
   bucket name, access key ID, and secret access key. Do not commit these values.
2. Confirm that your Render workspace has no other free PostgreSQL database or
   Key Value instance; Render limits each workspace to one active free instance
   of each type.
3. Push this repository and `render.yaml` to GitHub.
4. In Render, choose **New → Blueprint**, connect `MMMHH5/mo2`, and select the
   branch containing this file. Review the services and enter the R2 values
   when prompted for both API services (use the same bucket and token). Render
   generates a separate JWT secret for each API.
5. After the deploy completes, test both frontend URLs and each API's
   `/health` endpoint. Check the API logs for successful database migrations.

The frontend API URLs and backend CORS origins are linked to Render service
hostnames in the Blueprint. If you later add custom domains, update
`NEXT_PUBLIC_SITE_URL` / `NEXT_PUBLIC_API_URL` on each frontend and
`FRONTEND_URL` on its matching API, then redeploy the frontends (Next.js embeds
`NEXT_PUBLIC_*` values during build). Configure any Google OAuth callback and
Stripe webhook URLs to the deployed service URLs as well.

### Free-plan limitations

This Blueprint intentionally selects free plans because it is an evaluation
setup, not a production recommendation:

- Free web services sleep after 15 minutes without traffic and can take about a
  minute to wake. They have ephemeral disks; this project uses R2 for uploads
  so files do not depend on those disks.
- Render's free PostgreSQL database has a 1 GB limit, no backups, and expires
  30 days after creation. Upgrade it before expiry to keep the data; after the
  additional 14-day grace period Render deletes it.
- The free Redis-compatible Key Value instance is in-memory and can lose its
  cache/rate-limit data when it restarts. It is not application data, but do
  not use this plan as a production security boundary.
- Render free web services cannot send SMTP traffic on ports 465/587. Use an
  email provider/API or a supported port, or configure email later.
- Four web services, Redis, and the database share the workspace's free allowances.
  Review Render's current usage and pricing before leaving this as a live
  service.

The Blueprint creates an empty database. If you are moving an existing
deployment, first migrate the database and copy every referenced object from
the old `uploads/` tree into the R2 bucket using the same `uploads/...` keys.
Do not direct production traffic to the new APIs until that migration is
verified.

This repository is prepared for Render deployment, but the Blueprint must be
connected and launched from your Render account. Never paste Render or R2
credentials into chat or commit them to the repository.

---

## Target 2: Railway

Railway deploys from this GitHub repository. Three services:

| Service    | Build command        | Start command       | Env var                          |
|-----------|---------------------|--------------------|----------------------------------|
| Backend    | `npm install`        | `npm run build && node dist/main.js` | `DATABASE_URL`, `JWT_SECRET`, SMTP, etc. |
| Frontend   | `npm install`        | `npm run build && npm start` (Next standalone) | `NEXT_PUBLIC_API_URL` (no `/api` suffix) |
| Postgres   | (Railway managed)    | —                  | internal `DATABASE_URL` connection |

Backend variables (all on the backend service dashboard):

```
DATABASE_URL, JWT_SECRET, FRONTEND_URL, GOOGLE_CLIENT_ID,
GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL, SMTP_HOST, SMTP_PORT,
SMTP_SECURE, SMTP_USER, SMTP_PASS, MAIL_FROM, STRIPE_SECRET_KEY,
STRIPE_WEBHOOK_SECRET, ADMIN_EMAIL
```

Frontend variables:

```
NEXT_PUBLIC_API_URL=https://<your-railway-backend>/api   # no trailing /api stripped
NEXT_PUBLIC_SITE_URL, NEXT_PUBLIC_CURRENCY, NEXT_PUBLIC_GA4_ID, NEXT_PUBLIC_GTM_ID
```

> Note: the frontend build **bakes** `NEXT_PUBLIC_*` values into the bundle, so
> changing them requires a redeploy. In the Dockerfile the default
> `NEXT_PUBLIC_API_URL` already points at the real backend, so the build arg is
> only needed when the backend URL changes.

The migrations run automatically at backend container start (`prisma migrate deploy`).

### First-deploy assumption (no legacy data)

The `seatsTaken` column on `CourseOpening` (introduced with the
`20260925181018_webhook_events_and_seat_counter` migration) backfills itself
from existing non-rejected enrollments. The assumption is that this project has
**no legacy production data on first deploy**: a brand-new Railway Postgres is
created and `prisma migrate deploy` runs every migration including the backfill
against empty tables. If you ever import old data, re-run the backfill by
counting enrollments with `status NOT IN ('REJECTED','REVOKED')` per opening.

### Refund policy

- A refund is **only** possible from a `PAID` payment (admin/finance only;
  students cancel `PENDING` payments themselves).
- `refund()` marks the payment `REFUNDED`, sets `refundedAt`, **revokes** the
  linked enrollment (`REVOKED`), **releases the claimed seat**, and writes an
  audit log row — all in one transaction. A refunded enrollment never holds a
  seat and never appears as an active course member.
- Stripe webhook over-capacity settlement **auto-refunds**: if a paid
  PaymentIntent can't claim a seat because the opening filled up between
  checkout and settlement, the payment is refunded automatically, the student is
  emailed, and the opening seat counter is never touched.
- Financial records are **never deleted**; a refund keeps the original `Payment`
  row (status `REFUNDED`) for ledger integrity.

### Certificate issuance policy

- Ending a course **does not issue certificates automatically**. Instructors
  and admins manually select which approved students receive a certificate once
  the opening is `ENDED` (requires `course.certificateIssued = true`).
- Staff gate: ADMIN / COURSE_MANAGER anywhere; INSTRUCTORS only for openings
  they teach. `revoke()`/`reissue()` are admin/course-manager only.
- Everything is audit-logged; students get an in-app + email notification.

### Stripe webhook integrity

- The webhook is **idempotent**: each Stripe event id is recorded in a
  `WebhookEvent` table and duplicates short-circuit.
- The PaymentIntent is verified (`providerRef`, exact amount, currency) before
  any settlement; mismatches are logged and ignored (no enrollment granted).
- Settlement (payment `PAID` + enrollment `APPROVED` + seat claim + coupon
  usage + `WebhookEvent`) happens in a **single atomic transaction**.

---

## Target 3: Self-hosted Docker Compose

`docker-compose.prod.yml` runs: **Postgres 15**, **NestJS backend**, **Next.js
frontend**, **nginx** (HTTP→HTTPS, TLS, 100MB uploads), and **certbot** (Let's
Encrypt, auto-renewal).

### Requirements

- Docker + Docker Compose v2
- A domain `A`/`AAAA` record → your server's public IP (ports 80 & 443 open)

### 1. Configure the environment

```bash
cp .env.production.example .env.production
# then edit .env.production:
#  - DB_PASS, JWT_SECRET: strong random values
#  - DOMAIN: your real domain
#  - CERTBOT_EMAIL: your email (for certificate expiry notices)
#  - FRONTEND_URL / NEXT_PUBLIC_API_URL: https://yourdomain.com / https://yourdomain.com/api
#  - SMTP_*, GOOGLE_*, STRIPE_* as needed
```

`.env.production` is gitignored and never committed.

### 2. Start the stack

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

> `--env-file .env.production` is **required**: Compose interpolates `${DB_USER}`,
> `${DOMAIN}`, `DATABASE_URL`, etc. from it, and the services read the same file
> via `env_file:`, so one file drives the whole stack.

This starts `db`, `backend`, `frontend`, and `nginx`; the backend runs
`prisma migrate deploy` on startup. nginx serves HTTP 80 and redirects to HTTPS.

### 3. Issuing the TLS certificate (first run only)

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up --build certbot
```

`certbot` obtains a certificate for `DOMAIN` and `www.DOMAIN` via the webroot
challenge (nginx serves `/.well-known/acme-challenge/` on port 80), then keeps
renewing automatically in the background. After issuance nginx picks up the
certificates at `/etc/letsencrypt/live/${DOMAIN}/` on its next reload.

### 4. Verify

```bash
curl -I https://yourdomain.com          # expect 301/200 + TLS
curl -I https://yourdomain.com/api/health  # backend liveness
```

### Environment mapping (Compose => service)

| `.env.production` key      | Used by                                            |
|----------------------------|----------------------------------------------------|
| `DB_USER`/`DB_PASS`/`DB_NAME` | Postgres + backend `DATABASE_URL`               |
| `PORT`                     | backend (must stay `3000`)                         |
| `NEXT_PUBLIC_API_URL`      | frontend build arg (baked into bundle)             |
| `DOMAIN`, `CERTBOT_EMAIL`  | nginx `server_name` + certbot certificate          |
| all others                 | backend runtime (JWT, SMTP, Google, Stripe, ...)   |

### Backups

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T db \
  pg_dump -U "$DB_USER" "$DB_NAME" > backup.sql
```

The `uploads` volume (`uploads_data`) holds user-uploaded files — include it in
your backup automation.