// Slice 1 acceptance criteria: a query scoped to tenant A must return
// nothing when app.tenant_id is set to B — enforced by Postgres RLS, not
// application logic. Runs against a real database (see README/CI) using the
// same non-superuser `lih_app` role the running app connects as; a
// superuser or BYPASSRLS connection would pass this test for the wrong
// reason.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { withTenant } from "@/lib/tenant";

const prisma = new PrismaClient();

let hampshireId: string;
let homeServicesId: string;

beforeAll(async () => {
  const hampshire = await prisma.tenant.findUniqueOrThrow({ where: { slug: "hampshire" } });
  const homeServices = await prisma.tenant.findUniqueOrThrow({ where: { slug: "home-services" } });
  hampshireId = hampshire.id;
  homeServicesId = homeServices.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("tenant isolation (row-level security)", () => {
  it("tenant A's session cannot read tenant B's placements even when explicitly queried", async () => {
    const rows = await withTenant(hampshireId, (tx) =>
      tx.directoryPlacement.findMany({ where: { tenantId: homeServicesId } })
    );
    expect(rows).toHaveLength(0);
  });

  it("tenant B's own session can read its own placements", async () => {
    const rows = await withTenant(homeServicesId, (tx) =>
      tx.directoryPlacement.findMany({ where: { tenantId: homeServicesId } })
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it("tenant A's session, queried without a tenant filter, still only sees its own rows", async () => {
    const rows = await withTenant(hampshireId, (tx) => tx.directoryPlacement.findMany({}));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.tenantId === hampshireId)).toBe(true);
  });

  it("fails closed: no app.tenant_id set means no rows, not all rows", async () => {
    const rows = await prisma.directoryPlacement.findMany({});
    expect(rows).toHaveLength(0);
  });
});
