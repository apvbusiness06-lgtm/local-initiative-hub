// Slice 8: admin moderation + listing actions write audit trails and flip
// state correctly. Uses a throwaway business canonical to Hampshire so the
// tenant-scoped queries resolve it.
import { afterEach, afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { generateRawToken } from "@/lib/auth/tokens";
import { withTenant } from "@/lib/tenant";
import { pendingModeration, resolveModerationReport, setListingStatus, listingsForTenant } from "@/lib/admin";

const prisma = new PrismaClient();

let tenantId: string;
let adminId: string;
let businessId: string;

beforeEach(async () => {
  tenantId = (await prisma.tenant.findUniqueOrThrow({ where: { slug: "hampshire" } })).id;
  adminId = (await prisma.user.findUniqueOrThrow({ where: { email: "super-admin@demo.local-initiative.test" } })).id;

  const suffix = generateRawToken().slice(0, 8).toLowerCase();
  const business = await prisma.business.create({
    data: { slug: `admin-test-${suffix}`, tradingName: `Admin Test ${suffix}`, status: "NEEDS_CHANGES", sourceKind: "test" },
  });
  businessId = business.id;
  // Canonical placement on Hampshire so pendingModeration()/listingsForTenant()
  // see it. directory_placements carries RLS, so this write must set
  // app.tenant_id via withTenant — the same path the app uses.
  await withTenant(tenantId, (tx) =>
    tx.directoryPlacement.create({
      data: { tenantId, subject: "BUSINESS", subjectId: businessId, status: "APPROVED", isCanonical: true, reviewedAt: new Date() },
    })
  );
});

afterEach(async () => {
  await prisma.auditLog.deleteMany({ where: { subjectId: businessId } });
  await prisma.moderationReport.deleteMany({ where: { subjectId: businessId } });
  await withTenant(tenantId, (tx) => tx.directoryPlacement.deleteMany({ where: { subjectId: businessId } }));
  await prisma.business.deleteMany({ where: { id: businessId } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("moderation queue", () => {
  it("surfaces a pending edit_review and approving it re-activates the listing + writes audit", async () => {
    await prisma.moderationReport.create({
      data: { subject: "BUSINESS", subjectId: businessId, reason: "edit_review", detail: "owner changed name" },
    });

    const queue = await pendingModeration(tenantId);
    const report = queue.find((r) => r.businessId === businessId);
    expect(report).toBeTruthy();
    expect(report!.businessStatus).toBe("NEEDS_CHANGES");

    const res = await resolveModerationReport({ actorUserId: adminId, tenantId }, report!.id, "approve");
    expect(res.ok).toBe(true);

    const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });
    expect(business.status).toBe("ACTIVE");

    const resolved = await prisma.moderationReport.findFirstOrThrow({ where: { subjectId: businessId, reason: "edit_review" } });
    expect(resolved.status).toBe("APPROVED");
    expect(resolved.resolvedBy).toBe(adminId);

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { subjectId: businessId, action: "listing.approved" } });
    expect(audit.before).toMatchObject({ status: "NEEDS_CHANGES" });
    expect(audit.after).toMatchObject({ status: "ACTIVE" });
  });

  it("dismissing a report closes it without changing the listing", async () => {
    const report = await prisma.moderationReport.create({
      data: { subject: "BUSINESS", subjectId: businessId, reason: "spam", detail: "junk" },
    });
    const res = await resolveModerationReport({ actorUserId: adminId, tenantId }, report.id, "dismiss");
    expect(res.ok).toBe(true);

    const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });
    expect(business.status).toBe("NEEDS_CHANGES"); // unchanged
    const updated = await prisma.moderationReport.findUniqueOrThrow({ where: { id: report.id } });
    expect(updated.status).toBe("REJECTED");
  });
});

describe("listing status", () => {
  it("setListingStatus flips status and audits before/after", async () => {
    const res = await setListingStatus({ actorUserId: adminId, tenantId }, businessId, "SUSPENDED");
    expect(res.ok).toBe(true);
    const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });
    expect(business.status).toBe("SUSPENDED");
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { subjectId: businessId, action: "listing.suspended" } });
    expect(audit.after).toMatchObject({ status: "SUSPENDED" });
  });

  it("listingsForTenant lists the business with its placement flags", async () => {
    const rows = await listingsForTenant(tenantId);
    const row = rows.find((r) => r.id === businessId);
    expect(row).toBeTruthy();
    expect(row!.isCanonical).toBe(true);
  });
});
