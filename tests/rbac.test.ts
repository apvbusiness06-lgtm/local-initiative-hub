// Slice 2 acceptance criterion: a tenant admin of tenant A must get 403 on
// tenant B's admin routes. Uses the demo accounts from prisma/seed.ts
// (hampshire-admin@... holds tenant_admin scoped to Hampshire only) and
// exercises can() and checkTenantAdminAccess() directly — the exact
// functions the real protected route (app/api/admin/tenants/[tenantId]
// /route.ts) calls, just without needing a live Next server to test them.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { can, hasPlatformRole } from "@/lib/auth/rbac";
import { checkTenantAdminAccess } from "@/lib/auth/adminGuard";
import { createSession, destroySessionByToken } from "@/lib/auth/session";

const prisma = new PrismaClient();

let hampshireTenantId: string;
let homeServicesTenantId: string;
let tenantAdminUserId: string;
let superAdminUserId: string;
let memberUserId: string;

beforeAll(async () => {
  const hampshire = await prisma.tenant.findUniqueOrThrow({ where: { slug: "hampshire" } });
  const homeServices = await prisma.tenant.findUniqueOrThrow({ where: { slug: "home-services" } });
  const tenantAdmin = await prisma.user.findUniqueOrThrow({
    where: { email: "hampshire-admin@demo.local-initiative.test" },
  });
  const superAdmin = await prisma.user.findUniqueOrThrow({
    where: { email: "super-admin@demo.local-initiative.test" },
  });
  const member = await prisma.user.findUniqueOrThrow({ where: { email: "member@demo.local-initiative.test" } });

  hampshireTenantId = hampshire.id;
  homeServicesTenantId = homeServices.id;
  tenantAdminUserId = tenantAdmin.id;
  superAdminUserId = superAdmin.id;
  memberUserId = member.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("can() — scoped permission checks", () => {
  it("grants a tenant admin the permission within their own tenant", async () => {
    expect(await can(tenantAdminUserId, "tenants.manage", { tenantId: hampshireTenantId })).toBe(true);
  });

  it("denies the same tenant admin the permission in a different tenant", async () => {
    expect(await can(tenantAdminUserId, "tenants.manage", { tenantId: homeServicesTenantId })).toBe(false);
  });

  it("denies a plain member any admin permission", async () => {
    expect(await can(memberUserId, "tenants.manage", { tenantId: hampshireTenantId })).toBe(false);
    expect(await can(memberUserId, "listings.approve", {})).toBe(false);
  });

  it("grants a platform-scope role holder the permission regardless of tenant", async () => {
    expect(await can(superAdminUserId, "tenants.manage", { tenantId: hampshireTenantId })).toBe(true);
    expect(await can(superAdminUserId, "tenants.manage", { tenantId: homeServicesTenantId })).toBe(true);
  });

  it("denies a permission key that isn't granted to any of the user's roles", async () => {
    expect(await can(tenantAdminUserId, "billing.refund", { tenantId: hampshireTenantId })).toBe(false);
  });
});

describe("hasPlatformRole", () => {
  it("is true for the super admin and false for a tenant admin or member", async () => {
    expect(await hasPlatformRole(superAdminUserId)).toBe(true);
    expect(await hasPlatformRole(tenantAdminUserId)).toBe(false);
    expect(await hasPlatformRole(memberUserId)).toBe(false);
  });
});

describe("checkTenantAdminAccess — the actual protected-route guard", () => {
  it("returns 401 with no session token", async () => {
    const result = await checkTenantAdminAccess(undefined, hampshireTenantId);
    expect(result.status).toBe(401);
  });

  it("returns 401 for a garbage session token", async () => {
    const result = await checkTenantAdminAccess("not-a-real-token", hampshireTenantId);
    expect(result.status).toBe(401);
  });

  it("returns 200 for a tenant admin accessing their own tenant", async () => {
    const session = await createSession(tenantAdminUserId);
    try {
      const result = await checkTenantAdminAccess(session.token, hampshireTenantId);
      expect(result.status).toBe(200);
      if (result.status === 200) expect(result.body.slug).toBe("hampshire");
    } finally {
      await destroySessionByToken(session.token);
    }
  });

  it("returns 403 for a tenant admin of A hitting tenant B's admin route", async () => {
    const session = await createSession(tenantAdminUserId);
    try {
      const result = await checkTenantAdminAccess(session.token, homeServicesTenantId);
      expect(result.status).toBe(403);
    } finally {
      await destroySessionByToken(session.token);
    }
  });

  it("returns 200 for a platform admin on any tenant", async () => {
    const session = await createSession(superAdminUserId);
    try {
      const hampshireResult = await checkTenantAdminAccess(session.token, hampshireTenantId);
      const homeServicesResult = await checkTenantAdminAccess(session.token, homeServicesTenantId);
      expect(hampshireResult.status).toBe(200);
      expect(homeServicesResult.status).toBe(200);
    } finally {
      await destroySessionByToken(session.token);
    }
  });
});
