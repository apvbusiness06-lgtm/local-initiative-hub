// Slice 1 + 4 reference implementation.
// Tenant resolution → RLS-scoped client → search.

import { PrismaClient, Prisma } from "@prisma/client";

const base = new PrismaClient();

export interface ResolvedTenant {
  id: string;
  slug: string;
  name: string;
  kind: "GEOGRAPHIC" | "NICHE" | "HYBRID";
  timezone: string;
  coveragePlaceIds: string[];
  coverageCategoryIds: string[];
  branding: {
    colorPrimary: string;
    colorInk: string;
    colorSurface: string;
    fontHeading: string;
    fontBody: string;
    logoUrl: string | null;
    positioningBadge: string | null;
  };
}

// Hostname lookups happen on every request; cache them.
const cache = new Map<string, { tenant: ResolvedTenant | null; at: number }>();
const TTL_MS = 60_000;

export async function resolveTenant(hostname: string): Promise<ResolvedTenant | null> {
  const host = hostname.toLowerCase().split(":")[0] ?? "";
  const hit = cache.get(host);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.tenant;

  const domain = await base.tenantDomain.findUnique({
    where: { hostname: host },
    include: { tenant: { include: { branding: true } } },
  });

  // Unverified custom domains must not serve content — someone could point
  // DNS at us and impersonate a tenant.
  const t = domain?.verifiedAt ? domain.tenant : null;
  const tenant: ResolvedTenant | null =
    t && t.status === "ACTIVE" && !t.deletedAt
      ? {
          id: t.id,
          slug: t.slug,
          name: t.name,
          kind: t.kind,
          timezone: t.timezone,
          coveragePlaceIds: t.coveragePlaceIds,
          coverageCategoryIds: t.coverageCategoryIds,
          branding: {
            colorPrimary: t.branding?.colorPrimary ?? "#9B7F58",
            colorInk: t.branding?.colorInk ?? "#302B27",
            colorSurface: t.branding?.colorSurface ?? "#FBF8F3",
            fontHeading: t.branding?.fontHeading ?? "Fraunces",
            fontBody: t.branding?.fontBody ?? "Inter",
            logoUrl: t.branding?.logoUrl ?? null,
            positioningBadge: t.branding?.positioningBadge ?? null,
          },
        }
      : null;

  cache.set(host, { tenant, at: Date.now() });
  return tenant;
}

export function invalidateTenantCache(hostname?: string) {
  if (hostname) cache.delete(hostname.toLowerCase());
  else cache.clear();
}

/**
 * The hostname that holds the canonical placement for a subject (e.g. a
 * business), for a syndicated page's rel=canonical. Placements carry RLS, so
 * a normal tenant-scoped connection cannot see another tenant's canonical
 * row — this reads through canonical_tenant_for_subject(), a narrow
 * SECURITY DEFINER function that exposes only that one tenant_id (see the
 * migration for why this is safer than granting BYPASSRLS).
 */
export async function resolveCanonicalHost(
  subject: "BUSINESS" | "OFFER" | "EVENT" | "CONTENT",
  subjectId: string
): Promise<string | null> {
  const rows = await base.$queryRaw<{ tenant_id: string | null }[]>`
    SELECT canonical_tenant_for_subject(${subject}::"PlacementSubject", ${subjectId}::uuid) AS tenant_id
  `;
  const tenantId = rows[0]?.tenant_id;
  if (!tenantId) return null;

  const domain = await base.tenantDomain.findFirst({
    where: { tenantId, isPrimary: true, verifiedAt: { not: null } },
    select: { hostname: true },
  });
  return domain?.hostname ?? null;
}

/**
 * Runs `fn` inside a transaction with `app.tenant_id` set, so every RLS
 * policy applies. Use this for ALL request-scoped queries.
 *
 * set_config(..., true) is transaction-local — the setting cannot leak to
 * the next request that borrows this pooled connection.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return base.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  });
}
