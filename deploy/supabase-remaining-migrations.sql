-- =============================================================================
-- LOCAL INITIATIVE HUB — Remaining Supabase Migrations
-- =============================================================================
-- Paste this ENTIRE script into the Supabase Dashboard SQL Editor and run it.
-- It is safe to re-run (uses IF NOT EXISTS / DROP IF EXISTS throughout).
--
-- What it does:
--   1. Creates the 18 missing tables (reviews → newsletter_subscriptions)
--   2. Creates indexes and foreign keys for those tables
--   3. Applies auth_slice2 (sessions, verification/reset tokens)
--   4. Applies postgis_and_rls (spatial indexes, full-text, RLS policies)
--   5. Applies canonical_placement_lookup (SECURITY DEFINER function)
--   6. Applies stripe_webhook_events (webhook idempotency)
--   7. Grants all permissions to lih_app
--   8. Creates Prisma migration tracking records
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 1: 18 Missing Tables
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "reviews" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "provider" "ReviewProvider" NOT NULL,
    "provider_review_id" TEXT,
    "provider_account_id" TEXT,
    "rating" DOUBLE PRECISION NOT NULL,
    "rating_scale_max" INTEGER NOT NULL DEFAULT 5,
    "title" TEXT,
    "body" TEXT,
    "author_name" TEXT,
    "author_avatar_url" TEXT,
    "reviewed_at" TIMESTAMP(3) NOT NULL,
    "source_url" TEXT,
    "user_id" UUID,
    "moderation_state" "ModerationState" NOT NULL DEFAULT 'PENDING',
    "synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "review_responses" (
    "id" UUID NOT NULL,
    "review_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "author_user_id" UUID,
    "is_ai_drafted" BOOLEAN NOT NULL DEFAULT false,
    "approved_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "provider_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "review_responses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "review_sync_runs" (
    "id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "fetched" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    CONSTRAINT "review_sync_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "offers" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "OfferType" NOT NULL,
    "audience" "OfferAudience" NOT NULL DEFAULT 'PUBLIC',
    "percent_off" INTEGER,
    "amount_off_minor" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "min_spend_minor" INTEGER,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "total_quantity" INTEGER,
    "per_user_limit" INTEGER NOT NULL DEFAULT 1,
    "terms" TEXT,
    "status" "ListingStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "offer_codes" (
    "id" UUID NOT NULL,
    "offer_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "is_generic" BOOLEAN NOT NULL DEFAULT false,
    "claimed_at" TIMESTAMP(3),
    CONSTRAINT "offer_codes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "offer_claims" (
    "id" UUID NOT NULL,
    "offer_id" UUID NOT NULL,
    "user_id" UUID,
    "guest_email" TEXT,
    "guest_verified_at" TIMESTAMP(3),
    "code" TEXT NOT NULL,
    "qr_payload" TEXT,
    "claimed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "offer_claims_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "redemptions" (
    "id" UUID NOT NULL,
    "claim_id" UUID NOT NULL,
    "redeemed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redeemed_by_user_id" UUID,
    "location_id" UUID,
    "note" TEXT,
    CONSTRAINT "redemptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "events" (
    "id" UUID NOT NULL,
    "business_id" UUID,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "cover_url" TEXT,
    "venue_name" TEXT,
    "address_line1" TEXT,
    "postcode" TEXT,
    "place_id" UUID,
    "point" geography(Point,4326),
    "timezone" TEXT NOT NULL DEFAULT 'Europe/London',
    "is_recurring" BOOLEAN NOT NULL DEFAULT false,
    "recurrence_rule" TEXT,
    "price_minor" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "booking_url" TEXT,
    "capacity" INTEGER,
    "age_suitability" TEXT,
    "is_accessible" BOOLEAN NOT NULL DEFAULT false,
    "status" "ListingStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "event_occurrences" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "is_cancelled" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "event_occurrences_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "rsvps" (
    "id" UUID NOT NULL,
    "occurrence_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "guest_count" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rsvps_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "content_items" (
    "id" UUID NOT NULL,
    "kind" "ContentKind" NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "excerpt" TEXT,
    "body_blocks" JSONB NOT NULL,
    "featured_image_url" TEXT,
    "author_user_id" UUID,
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMP(3),
    "scheduled_for" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "content_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "content_revisions" (
    "id" UUID NOT NULL,
    "content_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "author_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "content_revisions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "favourites" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "subject" "SubjectKind" NOT NULL,
    "subject_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "favourites_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "follows" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "subject" "SubjectKind" NOT NULL,
    "subject_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "follows_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "enquiries" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "tenant_id" UUID,
    "user_id" UUID,
    "kind" "EnquiryKind" NOT NULL DEFAULT 'MESSAGE',
    "status" "EnquiryStatus" NOT NULL DEFAULT 'NEW',
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "message" TEXT NOT NULL,
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "enquiries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "consent_records" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "email" TEXT,
    "purpose" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "lawful_basis" TEXT NOT NULL,
    "wording_version" TEXT NOT NULL,
    "wording_text" TEXT NOT NULL,
    "granted_at" TIMESTAMP(3),
    "withdrawn_at" TIMESTAMP(3),
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "notification_preferences" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "channel" "Channel" NOT NULL,
    "topic" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "quiet_hours_start" TEXT,
    "quiet_hours_end" TEXT,
    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "newsletter_subscriptions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "email" TEXT NOT NULL,
    "place_id" UUID,
    "interest_category_ids" UUID[],
    "confirmed_at" TIMESTAMP(3),
    "unsubscribed_at" TIMESTAMP(3),
    "unsubscribe_token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "newsletter_subscriptions_pkey" PRIMARY KEY ("id")
);


-- ─────────────────────────────────────────────────────────────────────────────
-- PART 2: Indexes for the 18 tables
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS "reviews_business_id_moderation_state_idx" ON "reviews"("business_id", "moderation_state");
CREATE UNIQUE INDEX IF NOT EXISTS "reviews_provider_provider_account_id_provider_review_id_key" ON "reviews"("provider", "provider_account_id", "provider_review_id");
CREATE UNIQUE INDEX IF NOT EXISTS "review_responses_review_id_key" ON "review_responses"("review_id");
CREATE INDEX IF NOT EXISTS "review_sync_runs_connection_id_started_at_idx" ON "review_sync_runs"("connection_id", "started_at");
CREATE UNIQUE INDEX IF NOT EXISTS "offers_slug_key" ON "offers"("slug");
CREATE INDEX IF NOT EXISTS "offers_business_id_status_idx" ON "offers"("business_id", "status");
CREATE INDEX IF NOT EXISTS "offers_starts_at_ends_at_idx" ON "offers"("starts_at", "ends_at");
CREATE UNIQUE INDEX IF NOT EXISTS "offer_codes_offer_id_code_key" ON "offer_codes"("offer_id", "code");
CREATE INDEX IF NOT EXISTS "offer_claims_offer_id_idx" ON "offer_claims"("offer_id");
CREATE UNIQUE INDEX IF NOT EXISTS "offer_claims_offer_id_user_id_key" ON "offer_claims"("offer_id", "user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "redemptions_claim_id_key" ON "redemptions"("claim_id");
CREATE UNIQUE INDEX IF NOT EXISTS "events_slug_key" ON "events"("slug");
CREATE INDEX IF NOT EXISTS "events_status_idx" ON "events"("status");
CREATE INDEX IF NOT EXISTS "event_occurrences_event_id_starts_at_idx" ON "event_occurrences"("event_id", "starts_at");
CREATE INDEX IF NOT EXISTS "event_occurrences_starts_at_idx" ON "event_occurrences"("starts_at");
CREATE UNIQUE INDEX IF NOT EXISTS "rsvps_occurrence_id_user_id_key" ON "rsvps"("occurrence_id", "user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "content_items_slug_key" ON "content_items"("slug");
CREATE INDEX IF NOT EXISTS "content_items_kind_status_published_at_idx" ON "content_items"("kind", "status", "published_at");
CREATE UNIQUE INDEX IF NOT EXISTS "content_revisions_content_id_version_key" ON "content_revisions"("content_id", "version");
CREATE UNIQUE INDEX IF NOT EXISTS "favourites_user_id_subject_subject_id_key" ON "favourites"("user_id", "subject", "subject_id");
CREATE UNIQUE INDEX IF NOT EXISTS "follows_user_id_subject_subject_id_key" ON "follows"("user_id", "subject", "subject_id");
CREATE INDEX IF NOT EXISTS "enquiries_business_id_status_idx" ON "enquiries"("business_id", "status");
CREATE INDEX IF NOT EXISTS "consent_records_user_id_purpose_channel_idx" ON "consent_records"("user_id", "purpose", "channel");
CREATE INDEX IF NOT EXISTS "consent_records_email_idx" ON "consent_records"("email");
CREATE UNIQUE INDEX IF NOT EXISTS "notification_preferences_user_id_channel_topic_key" ON "notification_preferences"("user_id", "channel", "topic");
CREATE UNIQUE INDEX IF NOT EXISTS "newsletter_subscriptions_unsubscribe_token_hash_key" ON "newsletter_subscriptions"("unsubscribe_token_hash");
CREATE UNIQUE INDEX IF NOT EXISTS "newsletter_subscriptions_tenant_id_email_key" ON "newsletter_subscriptions"("tenant_id", "email");


-- ─────────────────────────────────────────────────────────────────────────────
-- PART 3: Foreign keys for the 18 tables
-- ─────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  ALTER TABLE "reviews" ADD CONSTRAINT "reviews_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "review_responses" ADD CONSTRAINT "review_responses_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "review_sync_runs" ADD CONSTRAINT "review_sync_runs_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "integration_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "offers" ADD CONSTRAINT "offers_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "offer_codes" ADD CONSTRAINT "offer_codes_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "offer_claims" ADD CONSTRAINT "offer_claims_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "offer_claims" ADD CONSTRAINT "offer_claims_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "offer_claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "events" ADD CONSTRAINT "events_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "event_occurrences" ADD CONSTRAINT "event_occurrences_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "rsvps" ADD CONSTRAINT "rsvps_occurrence_id_fkey" FOREIGN KEY ("occurrence_id") REFERENCES "event_occurrences"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "rsvps" ADD CONSTRAINT "rsvps_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "content_revisions" ADD CONSTRAINT "content_revisions_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "favourites" ADD CONSTRAINT "favourites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "follows" ADD CONSTRAINT "follows_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "newsletter_subscriptions" ADD CONSTRAINT "newsletter_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- PART 4: Auth Slice 2 (sessions, email verification, password reset tokens)
-- ─────────────────────────────────────────────────────────────────────────────

DROP INDEX IF EXISTS "business_locations_point_gix";
DROP INDEX IF EXISTS "businesses_name_trgm";
DROP INDEX IF EXISTS "businesses_search_gix";
DROP INDEX IF EXISTS "events_point_gix";
DROP INDEX IF EXISTS "places_boundary_gix";
DROP INDEX IF EXISTS "places_centroid_gix";
DROP INDEX IF EXISTS "places_name_trgm";

ALTER TABLE "businesses" DROP COLUMN IF EXISTS "search_vector";
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mfa_secret_encrypted" TEXT;

CREATE TABLE IF NOT EXISTS "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_agent" TEXT,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "email_verification_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "sessions_token_hash_key" ON "sessions"("token_hash");
CREATE INDEX IF NOT EXISTS "sessions_user_id_idx" ON "sessions"("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "email_verification_tokens_token_hash_key" ON "email_verification_tokens"("token_hash");
CREATE INDEX IF NOT EXISTS "email_verification_tokens_user_id_idx" ON "email_verification_tokens"("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");
CREATE INDEX IF NOT EXISTS "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

DO $$ BEGIN
  ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- PART 5: PostGIS, Full-Text Search, and Row-Level Security
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS business_locations_point_gix
  ON business_locations USING GIST (point);
CREATE INDEX IF NOT EXISTS events_point_gix
  ON events USING GIST (point);
CREATE INDEX IF NOT EXISTS places_centroid_gix
  ON places USING GIST (centroid);
CREATE INDEX IF NOT EXISTS places_boundary_gix
  ON places USING GIST (boundary);

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(trading_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(summary, '')),      'B') ||
    setweight(to_tsvector('english', coalesce(description, '')),  'C')
  ) STORED;

CREATE INDEX IF NOT EXISTS businesses_search_gix
  ON businesses USING GIN (search_vector);

CREATE INDEX IF NOT EXISTS businesses_name_trgm
  ON businesses USING GIN (trading_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS places_name_trgm
  ON places USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS businesses_active_idx
  ON businesses (status) WHERE deleted_at IS NULL AND status = 'ACTIVE';

CREATE UNIQUE INDEX IF NOT EXISTS placement_one_canonical
  ON directory_placements (subject, subject_id)
  WHERE is_canonical = true;

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


-- ─────────────────────────────────────────────────────────────────────────────
-- PART 6: Canonical Placement Lookup (SECURITY DEFINER)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION canonical_tenant_for_subject(p_subject "PlacementSubject", p_subject_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tenant_id FROM directory_placements
  WHERE subject = p_subject
    AND subject_id = p_subject_id
    AND is_canonical = true
    AND status = 'APPROVED'::"PlacementStatus"
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION canonical_tenant_for_subject("PlacementSubject", uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION canonical_tenant_for_subject("PlacementSubject", uuid) TO lih_app;


-- ─────────────────────────────────────────────────────────────────────────────
-- PART 7: Stripe Webhook Events (idempotency)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "stripe_webhook_events" (
    "id" UUID NOT NULL,
    "event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stripe_webhook_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "stripe_webhook_events_event_id_key" ON "stripe_webhook_events"("event_id");


-- ─────────────────────────────────────────────────────────────────────────────
-- PART 8: Grant all to lih_app
-- ─────────────────────────────────────────────────────────────────────────────

GRANT USAGE ON SCHEMA public TO lih_app;
GRANT ALL ON ALL TABLES IN SCHEMA public TO lih_app;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO lih_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO lih_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO lih_app;


-- ─────────────────────────────────────────────────────────────────────────────
-- PART 9: Mark migrations as applied in Prisma's tracking table
-- ─────────────────────────────────────────────────────────────────────────────
-- This tells Prisma these migrations have already run, so `prisma migrate
-- deploy` won't try to re-apply them. Only inserts if the row doesn't exist.

INSERT INTO "_prisma_migrations" (id, checksum, migration_name, finished_at, applied_steps_count)
SELECT gen_random_uuid(), 'manual_apply', '20260723094219_auth_slice2', NOW(), 1
WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name = '20260723094219_auth_slice2');

INSERT INTO "_prisma_migrations" (id, checksum, migration_name, finished_at, applied_steps_count)
SELECT gen_random_uuid(), 'manual_apply', '20260723094500_postgis_and_rls', NOW(), 1
WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name = '20260723094500_postgis_and_rls');

INSERT INTO "_prisma_migrations" (id, checksum, migration_name, finished_at, applied_steps_count)
SELECT gen_random_uuid(), 'manual_apply', '20260724100000_canonical_placement_lookup', NOW(), 1
WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name = '20260724100000_canonical_placement_lookup');

INSERT INTO "_prisma_migrations" (id, checksum, migration_name, finished_at, applied_steps_count)
SELECT gen_random_uuid(), 'manual_apply', '20260724110000_stripe_webhook_events', NOW(), 1
WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name = '20260724110000_stripe_webhook_events');


-- ═════════════════════════════════════════════════════════════════════════════
-- DONE. All tables, indexes, foreign keys, RLS policies, and grants applied.
-- Next step: create the "media" storage bucket in Supabase Dashboard → Storage.
-- ═════════════════════════════════════════════════════════════════════════════
