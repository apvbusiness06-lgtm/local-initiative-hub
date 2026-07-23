// The core of a tenant-scoped admin endpoint, deliberately factored out of
// the Route Handler so it's unit-testable without a live Next.js request
// context (next/headers' cookies() only works inside one). The route
// handler below is a 3-line wrapper: extract the cookie, call this,
// return it as JSON with the right status.
import { PrismaClient } from "@prisma/client";
import { getSessionByToken } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";

const prisma = new PrismaClient();

export type AdminGuardResult =
  | { status: 401; body: { error: string } }
  | { status: 403; body: { error: string } }
  | { status: 404; body: { error: string } }
  | { status: 200; body: { id: string; slug: string; name: string } };

export async function checkTenantAdminAccess(
  sessionToken: string | undefined,
  tenantId: string
): Promise<AdminGuardResult> {
  if (!sessionToken) {
    return { status: 401, body: { error: "Not authenticated." } };
  }
  const user = await getSessionByToken(sessionToken);
  if (!user) {
    return { status: 401, body: { error: "Session expired or invalid." } };
  }

  const authorised = await can(user.id, "tenants.manage", { tenantId });
  if (!authorised) {
    return { status: 403, body: { error: "You don't have admin access to this tenant." } };
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) {
    return { status: 404, body: { error: "Tenant not found." } };
  }
  return { status: 200, body: { id: tenant.id, slug: tenant.slug, name: tenant.name } };
}
