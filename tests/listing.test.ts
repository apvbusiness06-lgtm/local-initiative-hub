// Slice 5 acceptance: the SAME template must render a free and a premium
// listing correctly, entitlements are resolved from real Plan data (not a
// hardcoded tier), and a listing is visible only where an APPROVED
// placement exists for that tenant. Runs against the seeded database via
// the same withTenant/RLS path the app uses, matching the repo's existing
// integration-test convention (see tenantIsolation.test.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { getListingForTenant } from "@/lib/listing";
import { getActivePlan, entitled, featureLimit } from "@/lib/entitlements";

const prisma = new PrismaClient();

let hampshireId: string;
let homeServicesId: string;

beforeAll(async () => {
  hampshireId = (await prisma.tenant.findUniqueOrThrow({ where: { slug: "hampshire" } })).id;
  homeServicesId = (await prisma.tenant.findUniqueOrThrow({ where: { slug: "home-services" } })).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("getListingForTenant (placement-scoped visibility)", () => {
  it("returns a listing that has an approved placement on this tenant", async () => {
    const listing = await getListingForTenant(hampshireId, "winchester-warm-plumbing");
    expect(listing).not.toBeNull();
    expect(listing?.tradingName).toBe("Winchester Warm Plumbing");
    expect(listing?.isCanonical).toBe(true);
  });

  it("returns null for a business with no placement on this tenant", async () => {
    // The café is a plumbing/cafe demo business placed on hampshire + hub,
    // but NOT syndicated to the trades-only home-services niche tenant.
    const onNiche = await getListingForTenant(homeServicesId, "the-basingstoke-bakehouse");
    expect(onNiche).toBeNull();
  });

  it("returns null for a slug that does not exist", async () => {
    expect(await getListingForTenant(hampshireId, "no-such-business")).toBeNull();
  });

  it("includes approved reviews and an aggregate rating for a verified listing", async () => {
    const listing = await getListingForTenant(hampshireId, "winchester-warm-plumbing");
    expect(listing!.reviewCount).toBeGreaterThan(0);
    expect(listing!.avgRating).toBeGreaterThan(0);
  });

  it("surfaces a business's active offers on its listing", async () => {
    const listing = await getListingForTenant(hampshireId, "winchester-warm-plumbing");
    expect(listing!.activeOffers.length).toBeGreaterThan(0);
  });
});

describe("entitlements (data-driven, not hardcoded tiers)", () => {
  it("resolves the premium plan for the seeded premium subscription", async () => {
    const listing = await getListingForTenant(hampshireId, "winchester-warm-plumbing");
    const plan = await getActivePlan(listing!.id);
    expect(plan.key).toBe("premium");
  });

  it("grants featured.placement on premium but not on the free default", async () => {
    const premium = await getListingForTenant(hampshireId, "winchester-warm-plumbing");
    const free = await getListingForTenant(hampshireId, "fareham-roofline-roofing");

    expect(await entitled(premium!.id, "featured.placement")).toBe(true);
    expect(await entitled(free!.id, "featured.placement")).toBe(false);
  });

  it("gives a higher image limit to premium than to the free default", async () => {
    const premium = await getListingForTenant(hampshireId, "winchester-warm-plumbing");
    const free = await getListingForTenant(hampshireId, "fareham-roofline-roofing");

    const premiumMax = await featureLimit(premium!.id, "images.max");
    const freeMax = await featureLimit(free!.id, "images.max");
    expect(premiumMax).toBe(30);
    expect(freeMax).toBe(3);
  });

  it("falls back to the free plan when a business has no subscription", async () => {
    const free = await getListingForTenant(hampshireId, "fareham-roofline-roofing");
    const plan = await getActivePlan(free!.id);
    expect(plan.key).toBe("free");
  });
});
