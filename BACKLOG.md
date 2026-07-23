# Backlog

Ideas and known gaps logged during Slices 0/1/3/4, deliberately not built
now per `BUILD-BRIEF.md` rule 4 ("never widen scope mid-slice").

## Immediate next slice

**Slice 5 — Listing page** is next (or Slice 7/business portal — either
extends naturally from auth now being real). Slices 1, 4 and 2 were built
first because the brief flags them as highest-risk/blocking; every
remaining slice needs real sessions and `can()`, which now exist.

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
