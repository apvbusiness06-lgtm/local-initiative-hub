-- Run AFTER `prisma migrate dev`. Covers what Prisma cannot express natively:
-- PostGIS columns, spatial + full-text indexes, and tenant row-level security.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── Spatial indexes ─────────────────────────────────────────
-- GIST is required for ST_DWithin radius search to use an index.
CREATE INDEX IF NOT EXISTS business_locations_point_gix
  ON business_locations USING GIST (point);
CREATE INDEX IF NOT EXISTS events_point_gix
  ON events USING GIST (point);
CREATE INDEX IF NOT EXISTS places_centroid_gix
  ON places USING GIST (centroid);
CREATE INDEX IF NOT EXISTS places_boundary_gix
  ON places USING GIST (boundary);

-- ── Full-text search ────────────────────────────────────────
-- Weighted: name > summary > description. Generated column keeps it in sync.
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(trading_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(summary, '')),      'B') ||
    setweight(to_tsvector('english', coalesce(description, '')),  'C')
  ) STORED;

CREATE INDEX IF NOT EXISTS businesses_search_gix
  ON businesses USING GIN (search_vector);

-- Typo tolerance for autocomplete.
CREATE INDEX IF NOT EXISTS businesses_name_trgm
  ON businesses USING GIN (trading_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS places_name_trgm
  ON places USING GIN (name gin_trgm_ops);

-- Partial index: the hot path only ever queries live listings.
CREATE INDEX IF NOT EXISTS businesses_active_idx
  ON businesses (status) WHERE deleted_at IS NULL AND status = 'ACTIVE';

-- Exactly one canonical placement per subject, enforced at the DB level.
CREATE UNIQUE INDEX IF NOT EXISTS placement_one_canonical
  ON directory_placements (subject, subject_id)
  WHERE is_canonical = true;

-- ── Row-level security ──────────────────────────────────────
-- Application sets `app.tenant_id` per request after resolving the hostname.
-- This is defence in depth; server-side permission checks still apply.

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

ALTER TABLE directory_placements    ENABLE ROW LEVEL SECURITY;
ALTER TABLE newsletter_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pages                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_events        ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS placements_tenant_isolation ON directory_placements;
CREATE POLICY placements_tenant_isolation ON directory_placements
  USING (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS newsletter_tenant_isolation ON newsletter_subscriptions;
CREATE POLICY newsletter_tenant_isolation ON newsletter_subscriptions
  USING (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS pages_tenant_isolation ON pages;
CREATE POLICY pages_tenant_isolation ON pages
  USING (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS connections_tenant_isolation ON integration_connections;
CREATE POLICY connections_tenant_isolation ON integration_connections
  USING (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS analytics_tenant_isolation ON analytics_events;
CREATE POLICY analytics_tenant_isolation ON analytics_events
  USING (tenant_id = current_tenant_id());

-- Admin/worker role bypasses RLS for cross-tenant operations.
-- Never issue this role to a request-scoped connection.
-- CREATE ROLE lih_admin BYPASSRLS LOGIN PASSWORD '<from secret manager>';
