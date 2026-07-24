# Deployment

The app resolves the tenant from the **Host header** on every request
(`lib/tenant.ts`), so a single running instance serves every tenant domain.
Deployment is therefore mostly about (a) getting a database with PostGIS +
RLS, (b) running the app, and (c) putting a proxy in front that forwards the
original Host and terminates TLS for every tenant domain.

## Options

### Docker / self-hosted (docker-compose)

```bash
cp .env.example .env            # fill AUTH_SECRET, CREDENTIALS_ENCRYPTION_KEY, etc.
docker compose up --build -d
docker compose exec app npx prisma migrate deploy
docker compose exec app npm run db:grant     # grant migration-created tables to lih_app
docker compose exec app npm run db:seed      # demo data only — skip in production
```

`deploy/db-init.sh` creates the non-superuser `lih_app` role on first boot.
Put `deploy/nginx.conf.example` in front for TLS + multi-domain routing.

### Cloud Run + Cloud SQL

1. Build and push the image (`Dockerfile`, standalone output):
   `gcloud builds submit --tag REGION-docker.pkg.dev/PROJECT/repo/local-initiative`
2. Create a Cloud SQL Postgres instance, enable the `postgis` extension, and
   create the `lih_app` role (`NOSUPERUSER NOBYPASSRLS`).
3. Run migrations once (Cloud Run Job or locally against the instance):
   `prisma migrate deploy` as the superuser, then `npm run db:grant`.
4. Deploy the service. Set `DATABASE_URL` (lih_app) and `DIRECT_URL`
   (superuser, migrations only), plus the secrets from `.env.example`.
5. Media: Cloud Run's filesystem is ephemeral — either mount a volume at
   `MEDIA_LOCAL_DIR` or implement a cloud `MediaStore` (see `lib/storage.ts`)
   and set `MEDIA_STORAGE`.
6. Map every tenant domain to the service. Cloud Run domain mappings or a
   load balancer both work as long as the original Host reaches the app.

## Multi-domain + TLS

- **Subdomain tenants** (`hampshire.localinitiative.co.uk`): one wildcard cert
  `*.localinitiative.co.uk`.
- **Custom domains** (`hampshirelocal.co.uk`): the tenant points a CNAME/A
  record at the proxy; add a **verified** `TenantDomain` row (the app refuses
  to serve an unverified custom domain, preventing DNS-based impersonation);
  issue a cert per domain (certbot) or run Cloudflare in front for automatic
  edge TLS.
- The proxy MUST forward the original `Host` unchanged — see
  `nginx.conf.example`. Rewriting it breaks tenant resolution.

## Background jobs

A scheduler must POST periodically with `Authorization: Bearer $JOBS_RUN_SECRET`:

- `/api/jobs/run` — drains the CRM (GHL) sync queue with backoff/dead-letter.
  Every 1–5 minutes.
- `/api/jobs/rollup` — nightly analytics rollups + scheduled-content publishing.

Cloud Scheduler, a cron container, or GitHub Actions `schedule` all work.

## Webhooks to register

- Stripe → `POST /api/webhooks/stripe` (set `STRIPE_WEBHOOK_SECRET` to the
  endpoint's signing secret).
- GoHighLevel → `POST /api/integrations/ghl/webhook` (set `GHL_WEBHOOK_SECRET`).

## Pre-launch checklist

- [ ] `AUTH_SECRET` and `CREDENTIALS_ENCRYPTION_KEY` set to fresh random values.
- [ ] App connects as `lih_app` (NOT a superuser) — verify RLS with
      `tests/tenantIsolation.test.ts` against the production role.
- [ ] `prisma migrate deploy` + `db:grant` run; **demo seed NOT run** in prod.
- [ ] Real `SMTP_URL`/`MAIL_FROM` configured (verification & reset emails).
- [ ] Stripe/GHL webhook secrets set and endpoints registered.
- [ ] Every tenant domain has a verified `TenantDomain` row and a TLS cert.
- [ ] `LEGAL.md` privacy policy + terms reviewed by a lawyer and published.
- [ ] Remove or rotate the demo accounts from `prisma/seed.ts`.
