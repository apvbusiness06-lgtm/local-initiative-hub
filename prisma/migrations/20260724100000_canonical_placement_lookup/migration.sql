-- Slice 5 (listing page): a syndicated (non-canonical) listing must emit a
-- rel=canonical link pointing at the tenant that holds the canonical
-- placement — the design decision recorded in README.md ("syndicated
-- placements ... canonical back to it, so multi-tenant syndication does not
-- generate duplicate pages"). directory_placements carries RLS, so a normal
-- request-scoped connection (app.tenant_id = tenant A) correctly cannot see
-- tenant B's rows — which blocks this one legitimate cross-tenant lookup
-- along with everything else.
--
-- Rather than granting the request-scoped role BYPASSRLS (explicitly ruled
-- out in the RLS migration's own comment: "never issue this role to a
-- request-scoped connection"), expose exactly one narrow, read-only fact —
-- which tenant is canonical for a given subject — via a SECURITY DEFINER
-- function owned by the migration role. It runs with the owner's privileges
-- (bypassing RLS) but returns nothing beyond a single tenant_id for an
-- already-public routing fact; no other placement column or row is exposed.

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
