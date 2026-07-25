# Deploying with Vercel + Supabase

This guide covers deploying the Local Initiative platform using **Vercel**
(Next.js hosting) and **Supabase** (PostgreSQL + PostGIS + Storage).

---

## 1. Supabase setup

### Create project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) and create
   a new project. Choose a region close to your users.
2. Note your **Project URL** (`https://xxx.supabase.co`) and **service role
   key** (Settings → API → `service_role` secret).

### Run setup SQL

Open the **SQL Editor** in Supabase Dashboard and paste the contents of
`deploy/supabase-setup.sql`. **Change the password** on the `CREATE ROLE`
line to a strong random value — this is the password `lih_app` will connect
with.

### Get connection strings

Go to Settings → Database → Connection string:

- **Direct connection** (for migrations / `DIRECT_URL`):
  ```
  postgresql://postgres.[project-ref]:[db-password]@aws-0-[region].pooler.supabase.com:5432/postgres
  ```
  Or use the direct (non-pooled) host on port 5432.

- **Application connection** (for the app / `DATABASE_URL`):
  Replace the user with `lih_app` and use the password you set:
  ```
  postgresql://lih_app:[lih_app_password]@db.[project-ref].supabase.co:5432/postgres
  ```

### Run migrations

From your local machine (or CI):

```bash
# Set the superuser connection for migrations
export DIRECT_URL="postgresql://postgres:[db-password]@db.[project-ref].supabase.co:5432/postgres"
export DATABASE_URL="postgresql://lih_app:[password]@db.[project-ref].supabase.co:5432/postgres"

npx prisma migrate deploy
```

Then re-run the grants (in the Supabase SQL Editor or via `npm run db:grant`):

```sql
GRANT ALL ON ALL TABLES IN SCHEMA public TO lih_app;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO lih_app;
```

### Create storage bucket

1. Go to Storage in the Supabase Dashboard.
2. Create a new **public** bucket called `media`.
3. Add a storage policy allowing authenticated service-role uploads (or
   use the default "Allow public read" + "Allow service role all" policies).

---

## 2. Vercel setup

### Import repository

1. Go to [vercel.com/new](https://vercel.com/new) and import your GitHub
   repository (`apvbusiness06-lgtm/local-initiative-hub`).
2. Vercel auto-detects Next.js. The `vercel.json` configures the build
   command (`npx prisma generate && next build`) and cron jobs.

### Environment variables

Set these in the Vercel project settings (Settings → Environment Variables):

| Variable | Value | Notes |
|---|---|---|
| `DATABASE_URL` | `postgresql://lih_app:...@db.xxx.supabase.co:5432/postgres` | Non-superuser (RLS enforced) |
| `DIRECT_URL` | `postgresql://postgres:...@db.xxx.supabase.co:5432/postgres` | Superuser for migrations |
| `AUTH_SECRET` | (random 32+ bytes) | `openssl rand -base64 32` |
| `AUTH_URL` | `https://yourdomain.com` | Your production URL |
| `CREDENTIALS_ENCRYPTION_KEY` | (random 32 bytes, base64) | `openssl rand -base64 32` |
| `MEDIA_STORAGE` | `supabase` | Uses Supabase Storage |
| `SUPABASE_URL` | `https://xxx.supabase.co` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | (from Supabase dashboard) | Service role key (secret!) |
| `SUPABASE_STORAGE_BUCKET` | `media` | Bucket name (defaults to "media") |
| `CRON_SECRET` | (random string) | Vercel uses this to auth cron requests |
| `STRIPE_SECRET_KEY` | `sk_live_...` | From Stripe dashboard |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | Stripe webhook signing secret |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_live_...` | Stripe publishable key |
| `SMTP_URL` | `smtp://user:pass@smtp.provider.com:587` | Transactional email |
| `MAIL_FROM` | `hello@yourdomain.com` | Sender address |
| `JOBS_RUN_SECRET` | (same as CRON_SECRET) | Or set both to the same value |

Optional (if using GoHighLevel / Google Business Profile):

| Variable | Value |
|---|---|
| `GHL_CLIENT_ID` | GHL OAuth app ID |
| `GHL_CLIENT_SECRET` | GHL OAuth secret |
| `GHL_WEBHOOK_SECRET` | GHL webhook signing secret |
| `GBP_CLIENT_ID` | Google OAuth client ID |
| `GBP_CLIENT_SECRET` | Google OAuth secret |

### Custom domains (multi-tenant)

Each tenant needs its own domain or subdomain pointing to the Vercel project:

1. **Subdomain tenants** (e.g. `hampshire.localinitiative.co.uk`):
   - Add a wildcard domain `*.localinitiative.co.uk` in Vercel project
     settings (Settings → Domains).
   - Point `*.localinitiative.co.uk` CNAME to `cname.vercel-dns.com`.

2. **Custom domains** (e.g. `hampshirelocal.co.uk`):
   - Add each domain in Vercel project settings.
   - Point the domain's DNS (CNAME or A record) to Vercel.
   - Add a verified `TenantDomain` row in the database — the app refuses
     to serve unverified custom domains.

Vercel handles TLS automatically for all configured domains.

### Deploy

Push to your main branch (or the branch Vercel is tracking). Vercel will:

1. Run `npx prisma generate && next build`
2. Deploy the serverless functions + static assets
3. Start the cron jobs (`/api/jobs/run` every 5 min, `/api/jobs/rollup`
   at 2 AM UTC)

---

## 3. Webhooks

### Stripe

1. In the Stripe Dashboard → Developers → Webhooks, add an endpoint:
   `https://yourdomain.com/api/webhooks/stripe`
2. Subscribe to events: `checkout.session.completed`,
   `customer.subscription.updated`, `customer.subscription.deleted`,
   `invoice.payment_succeeded`, `invoice.payment_failed`.
3. Copy the signing secret → set `STRIPE_WEBHOOK_SECRET` in Vercel.

### GoHighLevel (if using)

1. Register webhook endpoint:
   `https://yourdomain.com/api/integrations/ghl/webhook`
2. Set `GHL_WEBHOOK_SECRET` in Vercel to the signing secret.

---

## 4. Post-deploy checklist

- [ ] Verify the app connects as `lih_app` (not postgres) — run
      `tests/tenantIsolation.test.ts` against the production database.
- [ ] Confirm cron jobs fire — check Vercel Dashboard → Cron Jobs.
- [ ] Test media upload — a gallery image should land in the Supabase
      `media` bucket and display via the public URL.
- [ ] Register Stripe webhook and verify a test event succeeds.
- [ ] Have a solicitor review `LEGAL.md` and publish the privacy policy
      and terms of service.
- [ ] Add tenant domains and verify each one resolves correctly.
- [ ] Do NOT run `npm run db:seed` in production — seed is demo data only.

---

## 5. Vercel Pro considerations

- **Function timeout**: Hobby plan = 10s, Pro = 60s. The rollup job
  and image processing may need Pro-tier timeouts. The route files
  export `maxDuration = 60` where needed.
- **Cron jobs**: Hobby = 1 cron job (daily). Pro = unlimited. You need
  at least 2 (sync queue + rollup). **Vercel Pro is required.**
- **Bandwidth / serverless invocations**: Monitor usage in the Vercel
  dashboard as traffic grows.
