// Slice 7: owner-gated mutations, entitlement enforcement in the action
// layer, and moderation routing for high-risk identity edits. Against the DB
// with a throwaway owned business.
import { afterAll, beforeEach, afterEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { generateRawToken } from "@/lib/auth/tokens";
import { saveProfile, saveCategories, getPortalBusiness } from "@/lib/portal";

const prisma = new PrismaClient();

let businessId: string;
let ownerId: string;
let strangerId: string;

beforeEach(async () => {
  const suffix = generateRawToken().slice(0, 8).toLowerCase();
  ownerId = (await prisma.user.create({ data: { email: `owner-${suffix}@example.com`, emailVerifiedAt: new Date() } })).id;
  strangerId = (await prisma.user.create({ data: { email: `stranger-${suffix}@example.com`, emailVerifiedAt: new Date() } })).id;
  const business = await prisma.business.create({
    data: {
      slug: `portal-test-${suffix}`,
      tradingName: "Original Name",
      description: "Original description",
      status: "ACTIVE",
      claimState: "CLAIMED",
      sourceKind: "test",
      locations: { create: { isPrimary: true, locality: "Testville" } },
      owners: { create: { userId: ownerId } },
    },
  });
  businessId = business.id;
});

afterEach(async () => {
  await prisma.moderationReport.deleteMany({ where: { subjectId: businessId } });
  await prisma.businessCategory.deleteMany({ where: { businessId } });
  await prisma.businessOwner.deleteMany({ where: { businessId } });
  await prisma.businessLocation.deleteMany({ where: { businessId } });
  await prisma.business.deleteMany({ where: { id: businessId } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, strangerId] } } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

function edit(over: Partial<Parameters<typeof saveProfile>[2]> = {}) {
  return {
    tradingName: "Original Name",
    summary: "",
    description: "Original description",
    websiteUrl: "",
    phone: "",
    email: "",
    addressLine1: "",
    addressLine2: "",
    locality: "Testville",
    postcode: "",
    ...over,
  };
}

describe("ownership gating", () => {
  it("a non-owner cannot load the portal business", async () => {
    expect(await getPortalBusiness(strangerId, businessId)).toBeNull();
  });

  it("a non-owner cannot save profile edits", async () => {
    const res = await saveProfile(strangerId, businessId, edit({ tradingName: "Hijacked" }));
    expect(res.ok).toBe(false);
    const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });
    expect(business.tradingName).toBe("Original Name");
  });
});

describe("moderation routing", () => {
  it("low-risk edits (phone) apply immediately without moderation", async () => {
    const res = await saveProfile(ownerId, businessId, edit({ phone: "01234 567890" }));
    expect(res.ok).toBe(true);
    expect(res.moderationHeld).toBeFalsy();
    const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });
    expect(business.status).toBe("ACTIVE");
    const reports = await prisma.moderationReport.count({ where: { subjectId: businessId, reason: "edit_review" } });
    expect(reports).toBe(0);
  });

  it("changing the business name routes to moderation and drops the listing from ACTIVE", async () => {
    const res = await saveProfile(ownerId, businessId, edit({ tradingName: "Brand New Name" }));
    expect(res.ok).toBe(true);
    expect(res.moderationHeld).toBe(true);
    const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });
    expect(business.tradingName).toBe("Brand New Name");
    expect(business.status).toBe("NEEDS_CHANGES");
    const report = await prisma.moderationReport.findFirstOrThrow({ where: { subjectId: businessId, reason: "edit_review" } });
    expect(report.status).toBe("PENDING");
  });
});

describe("entitlement enforcement (categories.max)", () => {
  it("rejects selecting more categories than the plan allows (free = 1)", async () => {
    const res = await saveCategories(ownerId, businessId, ["plumbers", "electricians"]);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/up to 1 category/i);
    expect(await prisma.businessCategory.count({ where: { businessId } })).toBe(0);
  });

  it("accepts a single category on the free plan and marks it primary", async () => {
    const res = await saveCategories(ownerId, businessId, ["plumbers"]);
    expect(res.ok).toBe(true);
    const cats = await prisma.businessCategory.findMany({ where: { businessId } });
    expect(cats).toHaveLength(1);
    expect(cats[0]!.isPrimary).toBe(true);
  });
});
