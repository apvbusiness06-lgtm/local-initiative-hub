# Backlog

Ideas and known gaps logged during Slices 0/1/3/4/5, deliberately not built
now per `BUILD-BRIEF.md` rule 4 ("never widen scope mid-slice").

## Immediate next slice

**Slice 5 — Listing page** is done (`app/listing/[slug]/page.tsx`): gallery
(entitlement-capped via `lib/entitlements.ts`), hours with open-now computed
in the tenant timezone, services, address + directions link, CTAs, reviews
with source labels, similar businesses, sponsored/featured/premium
disclosure, report/suggest-edit/enquiry round-trips, and JSON-LD with
`aggregateRating` only when there's at least one approved review. Same
template for free and premium — verified locally against the demo premium
subscription seeded on `winchester-warm-plumbing`.

**Slice 7 — Business portal** is next. Slices 1, 4 and 2 were built first
because the brief flags them as highest-risk/blocking; every remaining
slice needs real sessions and `can()`, which now exist.

### Bug found while building Slice 5: OFFER/EVENT placements can't be created

`directory_placements.subject_id` carries a hard FK to `businesses.id`
(`placement_business_fk`), even though the `subject` enum
(`BUSINESS`/`OFFER`/`EVENT`/`CONTENT`) implies placements are polymorphic.
Inserting a placement row with `subject = 'OFFER'` and `subjectId` pointing
at an `Offer` fails the FK. Real Slice 10 work: migrate `subject_id` to a
plain unconstrained column (or per-subject-type FKs via a check constraint)
so offers/events can carry their own placement instead of inheriting
visibility from their parent business, which is the interim behaviour
`lib/offers.ts`/`lib/events.ts` use today.

### Built ahead of sequence, at user request: minimal blog + homepage deals/events

Real, DB-backed, but deliberately smaller than their eventual slices:

- **`/blog`, `/blog/[slug]`** — reads `ContentItem` (platform-wide, no
  `tenantId`, same pattern as categories). No block editor, no revisions,
  no scheduling UI, no newsletter tie-in — that's Slice 13. `bodyBlocks` is
  seeded as a flat `{type, text}` array; the real block editor's schema may
  not match this shape when Slice 13 lands.
- **Homepage "Deals & offers" and "What's on"** — read `lib/offers.ts` /
  `lib/events.ts`, both tenant-scoped via the parent business's placement
  (see the FK bug above — there's no other way today). No claim/QR
  redemption flow (Slice 10), no RSVP (Slice 10). Cards link to the
  offer/event's business listing page, not a dedicated offer/event page,
  since those don't exist yet.

## Within already-built slices

- **MFA backup codes.** Enrolment and the login challenge both work
  (TOTP, RFC 6238-verified), but there's no recovery path if a user loses
  their authenticator device. Needs a `BackupCode` model or a hashed-codes
  array on `User` — deliberately left out to avoid widening Slice 2 further.
- **Resend verification email.** A verification link that's expired or
  already used shows an error with no way to request a new one short of
  registering again (which now correctly fails with "account already
  exists"). Small, self-contained addition.
- **Real transactional email.** `lib/mailer.ts`'s `ConsoleSandboxMailer` is
  the only adapter — every "sent" email is a console log line plus (for
  registration only) an inline sandbox link. Connecting a real provider
  means implementing `Mailer` against it; nothing else changes.
- **Session listing / "log out everywhere".** `Session` rows exist and
  `destroyAllSessionsForUser` is already used by password reset, but there's
  no UI for a user to see or revoke their own other active sessions.
- **Mobile nav.** `Header` is a single-row desktop layout with no hamburger
  menu or responsive collapse yet — fine down to small-desktop widths, not
  yet tested/built for phone-width viewports.
- **Real photography.** The hero uses a CSS-only dot-grid texture instead
  of the reference design's location photography, because there's no real,
  licensed imagery to use yet and a stock placeholder would look fake.
  Swap in per-tenant hero images once `MediaAsset` upload exists (Slice 7).

- **Map UI (Slice 4).** `search.ts` returns `lat`/`lng`/`distanceMeters` per
  hit and the list view is complete, but there's no `MapProvider` interface
  or map component yet — no Google Maps key is configured, and building a
  map against a real provider without one would mean faking it. Build the
  interface + a Google adapter + "connection required" state together, not
  a static Google Maps iframe now.
- **Autocomplete for postcode/place search.** `searchParams.ts` accepts
  `place` (a place ID) but there's no UI to resolve free-text input to one.
  Belongs with the map work (same provider, same adapter).
- **Category/place browse pages** (`/businesses/[category]`,
  `/businesses/[location]`, `/businesses/[location]/[category]`) — the
  query layer supports these today (`categorySlugs`, `placeId` params) but
  the routes themselves don't exist. Cheap to add once Slice 5's listing
  page establishes the page-template pattern.
- **Sponsored placement UI feedback loop.** `search.ts` already excludes
  sponsored rows from the organic ranking and slots them separately
  (capped at 2, first page only) — there's no admin UI to actually mark a
  placement `isSponsored` yet (that's Slice 8/Ad slots territory).

## Deferred to Phase 2/3 (per master spec)

MCP tool layer, AI concierge, comments/discussions, ad campaign management,
advanced personalisation, franchise/multi-location controls.
