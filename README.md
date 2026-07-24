# Local Initiative — multi-tenant directory platform

A multi-tenant community, local and niche directory platform for the Local
Initiative ecosystem (geographic editions — UK/county/city/town — plus niche
directories like trades, health, hospitality and professional services).

Built as vertical slices, not breadth-first scaffolding: each slice goes
UI → server action → database → back, with no dead buttons and no hardcoded
arrays standing in for real data. See `BUILD-BRIEF.md` for the full slice
sequence and `BACKLOG.md` for what's deliberately not built yet.

## Status

| Slice | What | State |
|---|---|---|
| 0 | Foundation (Next.js, Prisma, CI) | ✅ Done |
| 1 | Tenant resolution + RLS isolation | ✅ Done |
| 2 | Auth and accounts | ✅ Done |
| 3 | Taxonomy + UK place seed | ✅ Done |
| 4 | Search and map | ✅ Search done; map UI not started (behind `MapProvider`, no key configured) |
| 5 | Listing page | ✅ Done — see BACKLOG.md for the OFFER/EVENT placement FK bug found while building it |
| 6 | Claim flow | ✅ Done — email-possession + admin approval; ownership grant writes an AuditLog; used/expired tokens fail |
| 7 | Business portal | ✅ Done — owner-gated editor; server-side image validation + metadata strip (sharp); entitlement limits enforced in the action layer; identity edits route to moderation |
| 8 | Admin backend | ✅ Done — moderation queue, claim review, listing/placement management, time-limited support impersonation (banner + dual-ID audit + auto-expiry) |
| 9 | Plans, entitlements, Stripe | ✅ Done — Checkout + billing portal; signature-verified, idempotent webhook; entitlements activate from verified webhook state; usage limits enforced in the action layer |
| 10 | Offers and events | ✅ Done — offer claim (unique code + QR), staff redemption (concurrency-safe, one redemption per claim), events with DST-correct recurrence, RSVP, add-to-calendar (.ics), Event JSON-LD |
| 11 | Reviews | ✅ Done — rate-limited first-party submission with moderation (no gating), provider sync behind a `ReviewProvider` interface with structural dedup, reconnect-on-token-expiry, scale-aware aggregation |
| 12 | GHL sync | ✅ Done — idempotent outbound job queue (backoff + dead-letter + resync), signature-verified inbound webhook, loop prevention via `originSystem`, secret-redacted per-tenant sync log |
| 13 | Content, newsletter, analytics | ⬜ Not started (minimal `/blog` read path built ahead of sequence — see BACKLOG.md) |

Verified locally against a real PostgreSQL 16 + PostGIS instance:
- `prisma migrate deploy` succeeds on an empty database.
- `001_postgis_and_rls.sql` applies cleanly (spatial/FTS indexes, RLS
  policies) — column names now match the raw SQL after mapping every Prisma
  field to its snake_case column via `@map`.
- `prisma/seed.ts` seeds 20 categories, a UK place hierarchy for Hampshire,
  three demo tenants, 8 demo businesses (flagged `sourceKind: "demo_seed"`)
  and is idempotent (safe to re-run).
- The businesses search page renders real, tenant-scoped, geospatially
  ranked results for two different hostnames from the same running process,
  and an unrecognised hostname gets a branded 404, never a crash or a
  default tenant.
- 69 automated tests pass: `searchParams` round-trip/validation (31),
  RLS tenant isolation (4), TOTP against all 5 RFC 6238 Appendix B vectors
  plus round-trip/drift-tolerance cases (11), registration/verification/
  password-reset/session-invalidation (12), and RBAC scoping including the
  actual `checkTenantAdminAccess` guard the protected route calls (11) —
  all run against the non-superuser `lih_app` role, not a superuser
  connection that would pass for the wrong reason.
- The full register → verify → login → account → logout flow, the MFA
  forced-enrolment path for platform roles, the MFA challenge path on
  subsequent logins, and the tenant-scoped 403 on the real
  `/api/admin/tenants/[tenantId]` route were exercised end-to-end against
  a live server (Playwright + curl), not just unit-tested. That's how a
  real bug got caught: the verify-email route was building its redirect
  from `request.url` (Next's internal origin) instead of the incoming
  `Host` header, silently losing tenant resolution on click-through — fixed
  in `app/api/auth/verify-email/route.ts`.

## Demo accounts (Slice 2 — local testing only, never for production)

Seeded by `prisma/seed.ts`, password `DemoPass123!` for all three:

| Email | Role |
|---|---|
| `member@demo.local-initiative.test` | Community member, no admin role |
| `hampshire-admin@demo.local-initiative.test` | `tenant_admin`, scoped to Hampshire only — gets 403 on any other tenant's admin routes |
| `super-admin@demo.local-initiative.test` | `super_admin` (PLATFORM scope), deliberately not MFA-enrolled — logging in demonstrates the mandatory forced-enrolment flow |

## Setup

```bash
npm install
cp .env.example .env.local   # fill in DATABASE_URL/DIRECT_URL etc — see below
npx prisma generate
npx prisma migrate dev        # or `migrate deploy` against an existing DB
npm run db:grant              # migrations run as the DIRECT_URL superuser; grant the new tables to lih_app
npm run db:seed
npm run dev
```

PostGIS extensions, spatial/FTS indexes and RLS policies are applied as
part of the normal migration history (`prisma/migrations/*_postgis_and_rls`)
— there's no separate manual SQL step. `db:grant` is still needed after
every migration because migrations run as the superuser (`DIRECT_URL`) and
Postgres doesn't retroactively extend `ALTER DEFAULT PRIVILEGES` to
objects a *different* role created.

Requires PostgreSQL 16+ with PostGIS (`postgresql-16-postgis-3` on
Debian/Ubuntu, or use the `postgis/postgis` Docker image — see
`.github/workflows/ci.yml` for a working example).

### Critical: RLS requires a non-superuser role

Row-level security is **silently bypassed** by Postgres superusers and by
any role with `BYPASSRLS`. Tenant isolation will appear to work in
development and leak in production if the application connects as a
superuser.

```sql
CREATE ROLE lih_app LOGIN PASSWORD '...' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
GRANT ALL ON SCHEMA public TO lih_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO lih_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO lih_app;
-- after migrating, tables created by the superuser need an explicit grant too:
GRANT ALL ON ALL TABLES IN SCHEMA public TO lih_app;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO lih_app;
```

`DATABASE_URL` (runtime, used by the app and by `prisma/seed.ts`'s privilege
checks) connects as `lih_app`. `DIRECT_URL` (migrations only) connects as a
superuser. `tests/tenantIsolation.test.ts` verifies isolation against the
`lih_app` connection specifically — running it against a superuser
connection would pass without proving anything.

### Local hostnames

There's no real DNS for the demo tenants. Test them with a `Host` header
instead of editing `/etc/hosts`:

```bash
curl -H "Host: hampshire.local-initiative.test"   http://localhost:3000/businesses
curl -H "Host: homeservices.local-initiative.test" http://localhost:3000/businesses
curl -H "Host: hub.local-initiative.test"          http://localhost:3000/
curl -H "Host: nonexistent.example.test"           http://localhost:3000/   # branded 404
```

## Design decisions worth preserving

These are load-bearing. Changing them later is expensive.

**Placement is visibility.** A business is not "on" a tenant because of a
foreign key. It is visible because an approved `DirectoryPlacement` row
exists. Exactly one placement per subject may be canonical, enforced by a
partial unique index. Syndicated placements are non-canonical and carry
local editorial copy, so multi-tenant syndication does not generate
duplicate pages.

**Organisation is not location.** A business owns one or more physical
locations. Hours, coordinates and service radius belong to the location.

**Ownership is separate from the listing.** An imported listing exists with
no owner. `ListingClaim` records the claim attempt and evidence;
`BusinessOwner` records the outcome. Never conflate them.

**Review dedup is structural.** `(provider, providerAccountId,
providerReviewId)` is unique. Re-syncing the same payload cannot create
duplicates regardless of application logic.

**Double redemption is impossible.** `Redemption.claimId` is a unique
foreign key. Concurrent redemption attempts on one claim resolve to exactly
one success at the database level, not in application code.

**Sponsored results are slotted, not boosted.** Paid placement occupies a
reserved labelled slot and is excluded from the organic query. Relevance
stays honest and the disclosure stays truthful.

**Entitlements are data, enforced server-side.** Plans and features are
rows, not code branches. Every limit check must run in the action layer —
UI-only enforcement is bypassed by calling the API directly.

**Money is integer minor units with an explicit currency.** Never floats.

**Timestamps are UTC.** Display converts to the tenant timezone.

## A fix worth knowing about

The schema as originally drafted left every Prisma field in camelCase with
no `@map`, while the raw PostGIS/RLS migration and `lib/search.ts`'s raw SQL
both assumed snake_case columns (`trading_name`, `deleted_at`, `tenant_id`,
...). Running the migration against a live database surfaced this
immediately — every column reference in `001_postgis_and_rls.sql` failed.
Every scalar field across all 61 models now has an explicit `@map("snake_
case")`; relation fields are untouched since they have no underlying
column. If you add a new field, map it the same way or the raw SQL that
references it will silently target the wrong column name.

## Deliberately out of scope (Phase 1)

MCP tool layer, AI concierge, comments/discussions, ad campaign management,
advanced personalisation, franchise controls. Add them in Phase 2/3 per the
master spec, not now. See `BACKLOG.md` for slice-level gaps within Phase 1
itself.

## Legal and compliance

`ConsentRecord` stores purpose, channel, lawful basis, exact wording version
and withdrawal timestamp because UK GDPR/PECR requires proving *what*
someone consented to, not merely that they did. No marketing send may occur
without a matching consent record and channel preference. Review gating
(soliciting only happy customers) is prohibited by provider terms and must
not be implemented. Manually imported testimonials must be labelled as
business-provided and never presented as independently verified.

Privacy policy and terms templates require human legal review before
launch — none exist yet, because no page collects personal data yet
(Slice 2 is where that starts to matter).
