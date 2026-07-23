# Backlog

Ideas and known gaps logged during Slices 0/1/3/4, deliberately not built
now per `BUILD-BRIEF.md` rule 4 ("never widen scope mid-slice").

## Immediate next slice

**Slice 2 — Auth and accounts** is next. Slices 1 and 4 (tenant isolation,
search) were built first because the brief flags them as highest-risk;
Slice 2 blocks everything after it (claim flow, business portal, admin,
reviews all need real sessions and `can(user, permission, subject)`).

## Within already-built slices

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
