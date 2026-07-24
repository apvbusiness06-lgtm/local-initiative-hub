-- Run this in the Supabase SQL Editor ONCE after creating your project.
-- It enables required extensions and creates the non-superuser application
-- role. RLS is SILENTLY BYPASSED by superusers, so the app MUST connect as
-- lih_app, never as the default postgres role.

-- 1. Enable required extensions (PostGIS, trigram, UUID).
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Create the non-superuser application role.
-- Replace 'CHANGE_ME_STRONG_PASSWORD' with a real random password.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'lih_app') THEN
    CREATE ROLE lih_app LOGIN PASSWORD 'CHANGE_ME_STRONG_PASSWORD'
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

-- 3. Grant permissions so lih_app can use tables created by migrations.
GRANT USAGE ON SCHEMA public TO lih_app;
GRANT ALL ON ALL TABLES IN SCHEMA public TO lih_app;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO lih_app;

-- Future tables created by the migration user also need grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO lih_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO lih_app;

-- 4. After running Prisma migrations (npx prisma migrate deploy), run the
--    grants again since migrations create tables as the superuser:
--
--    GRANT ALL ON ALL TABLES IN SCHEMA public TO lih_app;
--    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO lih_app;
--
--    Or use: npm run db:grant
