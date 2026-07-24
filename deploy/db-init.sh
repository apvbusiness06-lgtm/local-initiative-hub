#!/bin/bash
# Runs once on first boot of the postgis container (docker-entrypoint-initdb.d).
# Creates the non-superuser application role the app connects as. RLS is
# SILENTLY BYPASSED by superusers, so the app must never connect as postgres —
# see README "Critical: RLS requires a non-superuser role".
set -e

APP_PASSWORD="${LIH_APP_PASSWORD:-lih_app_pw}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname lih <<SQL
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'lih_app') THEN
      CREATE ROLE lih_app LOGIN PASSWORD '${APP_PASSWORD}'
        NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
    END IF;
  END
  \$\$;

  GRANT ALL ON SCHEMA public TO lih_app;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO lih_app;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO lih_app;
SQL

echo "lih_app role ready. Run 'prisma migrate deploy' then 'npm run db:grant' to grant tables created by the migration superuser."
