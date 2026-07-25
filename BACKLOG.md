# Backlog

Known gaps and future work, logged during the Phase 1 build (Slices 0–13 +
launch infrastructure). Deliberately not built now per `BUILD-BRIEF.md`
rule 4 ("never widen scope mid-slice").

## Schema limitation: OFFER/EVENT placements

`directory_placements.subject_id` carries a hard FK to `businesses.id`
(`placement_business_fk`), even though the `subject` enum
(`BUSINESS`/`OFFER`/`EVENT`/`CONTENT`) implies placements are polymorphic.
Inserting a placement with `subject = 'OFFER'` and `subjectId` pointing at
an `Offer` fails the FK. Today, offers and events inherit visibility from
their parent business's placement. To give them independent placement
control, migrate `subject_id` to a plain unconstrained column (or
per-subject-type FKs via a check constraint).

## Within already-built slices

- **MFA backup codes.** Enrolment and the login challenge both work
  (TOTP, RFC 6238-verified), but there's no recovery path if a user loses
  their authenticator device. Needs a `BackupCode` model or a hashed-codes
  array on `User`.
- **Resend verification email.** A verification link that's expired or
  already used shows an error with no way to request a new one short of
  registering again (which correctly fails with "account already exists").
- **Session listing / "log out everywhere".** `Session` rows exist and
  `destroyAllSessionsForUser` is already used by password reset, but there's
  no UI for a user to see or revoke their own other active sessions.
- **Mobile nav.** `Header` is a single-row desktop layout with no hamburger
  menu or responsive collapse yet — not yet tested/built for phone-width
  viewports.
- **Real photography.** The hero uses a CSS-only dot-grid texture. Swap in
  per-tenant hero images once media upload exists in the portal.
- **Map UI (Slice 4).** `search.ts` returns `lat`/`lng`/`distanceMeters` per
  hit and the list view is complete, but there's no map component yet — no
  Google Maps key is configured. Build the `MapProvider` interface + a Google
  adapter + "connection required" state together.
- **Autocomplete for postcode/place search.** `searchParams.ts` accepts
  `place` (a place ID) but there's no UI to resolve free-text input to one.
  Belongs with the map work (same provider, same adapter).
- **Category/place browse pages** (`/businesses/[category]`,
  `/businesses/[location]`) — the query layer supports these today but the
  routes don't exist.
- **Sponsored placement admin UI.** `search.ts` already slots sponsored
  results separately (capped at 2, first page only) — there's no admin UI
  to mark a placement `isSponsored` yet.
- **Cloud media store.** `MediaStore` interface exists with `LocalDiskStore`
  as the only implementation. Cloud Run's ephemeral filesystem needs an S3 /
  GCS adapter or a mounted volume.
- **Google Business Profile review sync.** `ReviewProvider` interface and
  structural dedup are built; `MockGoogleProvider` is the only implementation.
  Needs a real `GoogleBusinessProfileProvider` with OAuth token refresh.

## Deferred to Phase 2/3 (per master spec)

MCP tool layer, AI concierge, comments/discussions, ad campaign management,
advanced personalisation, franchise/multi-location controls.
