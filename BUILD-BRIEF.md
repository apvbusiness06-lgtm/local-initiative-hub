# Local Initiative — Phase 1 Build Brief

## How to use this

The master spec is a **product definition**, not a build instruction. Handed to
an agent whole, it produces breadth-first scaffolding: every screen exists, none
works. This brief splits Phase 1 into **13 vertical slices**, each shippable on
its own.

**Rules for the build agent:**

1. Work one slice at a time. Do not start slice N+1 until N's acceptance
   criteria pass.
2. Every slice goes UI → server action → database → back. No slice ends with a
   dead button or a hardcoded array.
3. Run `prisma migrate`, `tsc --noEmit`, lint and the slice's tests before
   moving on.
4. Never widen scope from the master spec mid-slice. Log the idea in
   `BACKLOG.md` and continue.
5. Feature-flag anything incomplete. A flagged-off module is acceptable; a
   fake-working one is not.

Give the agent this brief **plus the one slice section** it is working on —
not the whole document. Context that isn't relevant to the current slice
degrades output.

---

## Slice 0 — Foundation

**Build:** Next.js + TypeScript + Tailwind. Prisma with the supplied schema.
Run `001_postgis_and_rls.sql`. Env template with descriptions and no values.
Structured logging, error tracking, CI running typecheck + lint + tests.

**Done when:** `migrate deploy` succeeds on an empty database; CI is green;
`.env.example` documents every variable the app reads.

---

## Slice 1 — Tenant resolution

**Build:** Middleware resolving hostname → `TenantDomain` → `Tenant`. Cached
lookup. Request-scoped Prisma client that sets `app.tenant_id` for RLS. Tenant
branding (colours, fonts, logo) applied as CSS custom properties in the root
layout. Unknown host → branded 404, never a crash or a default tenant.

**Done when:** two seeded tenants on different hostnames render different
branding from the same running process; a query for tenant A's placements
returns nothing when `app.tenant_id` is set to B.

**This is the highest-risk slice.** Get isolation wrong here and every
later slice inherits the leak.

---

## Slice 2 — Auth and accounts

**Build:** Email/password with verification and reset. Session validation
server-side on every protected route. MFA enrolment for platform roles.
Role assignment resolution across PLATFORM / TENANT / BUSINESS scopes.
A single `can(user, permission, subject)` helper — every check routes
through it.

**Done when:** tests cover verification, reset-token expiry and reuse, session
invalidation on password change, and a tenant admin of A getting 403 on
tenant B's admin routes.

---

## Slice 3 — Taxonomy and places seed

**Build:** Seed the 20 categories with schema.org subtypes and the UK place
hierarchy (country → county → town) for Hampshire, with centroids. Category
attributes and which are filterable.

**Done when:** a town resolves to a coordinate and its parent county; category
tree renders nested.

---

## Slice 4 — Search and map ⭐

**Build:** Full-text search over the generated `search_vector` with weighted
ranking. Radius search via `ST_DWithin`. Combined keyword + location + filters.
Cursor pagination. List/map toggle with marker clustering. "Search this area."
Filters persisted in the URL. Empty states with nearby alternatives. Maps
behind a `MapProvider` interface — Google first, substitutable.

Sponsored results appear labelled and are ranked in a reserved slot,
**not** by inflating organic score.

**Done when:** a keyword+radius query on 5,000 seeded listings returns in
under 200ms; the URL alone reproduces the result set; results respect tenant
placement.

---

## Slice 5 — Listing page

**Build:** Full profile — gallery, hours (with open-now computed in tenant tz),
services, map, CTAs, reviews with source labels, similar businesses. JSON-LD
using the category's schema type. Entitlement checks decide which sections
render — **one template, not a free and a paid copy**. Sponsored/featured
disclosure. Report and suggest-edit.

**Done when:** the same template renders a free and a premium listing
correctly; JSON-LD validates; rating schema is emitted only where eligible.

---

## Slice 6 — Claim flow

**Build:** Claim CTA → identity check → verification (email domain, phone OTP,
document upload, or admin review) → evidence stored → admin queue → approve
/reject with audit record → ownership granted. Expiring hashed tokens,
single-use.

**Done when:** a used or expired token fails; approval writes an `AuditLog`
row with before/after; rejected claimants gain no access.

---

## Slice 7 — Business portal

**Build:** Profile editor for identity, categories, hours, services, media,
attributes. Image upload with validation, compression, metadata stripping,
alt text. Changes route to moderation when risk rules require. Team invites
with business-scoped permissions.

**Done when:** an edit round-trips to the public page after approval; an
oversized or wrong-MIME upload is rejected server-side, not just client-side.

---

## Slice 8 — Admin backend

**Build:** Listing moderation queue, claim review, user/business management,
tenant CRUD with branding and domain config, placement approval. Support
impersonation: reason required, time-limited, banner visible, every action
audited under both real and impersonated user.

**Done when:** impersonation expires automatically and its audit rows carry
both IDs.

---

## Slice 9 — Plans, entitlements, Stripe

**Build:** Plans and features as data. Server-side `entitled(business, key)`
and `withinLimit(business, key)` — enforced in the action layer, never only
in the UI. Stripe Checkout. Webhook handler with signature verification and
idempotency keyed on event ID. Entitlements activate from **verified webhook
state**, never from the redirect URL.

**Done when:** a replayed webhook is a no-op; cancelling downgrades
entitlements; a limit is enforced when the API is called directly with the
UI bypassed.

---

## Slice 10 — Offers and events

**Build:** Offer CRUD with eligibility rules. Claim flow issuing unique codes
and QR. Staff redemption screen. Events with RRULE expansion into occurrences,
RSVP, add-to-calendar, structured data.

**Done when:** concurrent redemption of one claim succeeds exactly once
(enforced by the unique FK, verified under parallel load); a weekly recurrence
expands correctly across a BST boundary.

---

## Slice 11 — Reviews

**Build:** First-party submission with rate limiting and moderation. Google
Business Profile adapter behind a `ReviewProvider` interface, OAuth server-side.
Incremental sync deduplicating on `(provider, account, providerReviewId)`.
Unified inbox with source labels. Aggregate score computed per source and
combined only across matching scales.

No gating. No fabrication. Testimonials labelled as business-provided.
Token expiry surfaces a reconnect action.

**Done when:** syncing the same payload twice creates no duplicates;
an expired token shows reconnect rather than failing silently.

---

## Slice 12 — GHL sync

**Build:** OAuth connection per tenant → GHL location. Field mapping UI.
Outbound events (member signup, business import, claim state, plan change,
offer claim, enquiry) queued as `SyncJob`s with idempotency keys, exponential
backoff and a dead-letter queue. External IDs stored in `ExternalIdMapping`.
Inbound webhooks signature-verified. Loop prevention via `originSystem`.
Per-tenant sync log with secrets redacted. Manual resync.

**Done when:** the same event queued twice produces one GHL contact; an
unsigned webhook is rejected; a failed job appears in the admin queue and
retries successfully.

---

## Slice 13 — Content, newsletter, analytics

**Build:** Block editor with revisions and scheduled publishing. Newsletter
signup writing a `ConsentRecord` with wording version. Analytics events with
bot filtering and nightly rollups. Business dashboard on rollups, not raw
scans.

Label CTA clicks as clicks — never as confirmed calls or sales.

**Done when:** unsubscribe works from the emailed token without login;
consent withdrawal blocks marketing sends immediately.

---

## Cross-cutting — verify continuously, not at the end

Tenant isolation · server-side entitlement enforcement · audit coverage on
sensitive actions · no secret reaching the browser bundle · WCAG 2.2 AA
keyboard paths.

Run a bundle scan for secret-shaped strings in CI. This is cheap and catches
the one mistake that is expensive.

---

## Sequencing note

Slices 1, 4, 9 and 12 carry most of the architectural risk. If time is
constrained, build those four properly and flag the rest off. A directory with
excellent search and correct billing beats one with every feature half-working.
