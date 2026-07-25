// Slice 11 acceptance:
//   - syncing the same payload twice creates no duplicates (structural dedup);
//   - an expired token surfaces reconnect rather than failing silently.
// Plus first-party rate limiting, no-gating moderation, and scale-aware
// aggregation. Against the DB with throwaway rows.
import { afterEach, afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { generateRawToken } from "@/lib/auth/tokens";
import { withTenant } from "@/lib/tenant";
import {
  submitFirstPartyReview,
  syncProviderReviews,
  MockGoogleProvider,
  combinedScore,
  aggregatesByProvider,
  type NormalizedReview,
  type ProviderConnection,
} from "@/lib/reviews";

const prisma = new PrismaClient();

let businessId: string;
let connectionId: string;
let userId: string;

beforeEach(async () => {
  const suffix = generateRawToken().slice(0, 8).toLowerCase();
  businessId = (
    await prisma.business.create({
      data: { slug: `rev-biz-${suffix}`, tradingName: `Rev ${suffix}`, status: "ACTIVE", sourceKind: "test" },
    })
  ).id;
  userId = (await prisma.user.create({ data: { email: `reviewer-${suffix}@example.com` } })).id;
  // integration_connections carries RLS; create it under a tenant.
  const tenantId = (await prisma.tenant.findUniqueOrThrow({ where: { slug: "hampshire" } })).id;
  connectionId = (
    await withTenant(tenantId, (tx) =>
      tx.integrationConnection.create({
        data: { tenantId, provider: "google_business_profile", status: "CONNECTED", externalAccountId: `acct-${suffix}` },
      })
    )
  ).id;
});

afterEach(async () => {
  const tenantId = (await prisma.tenant.findUniqueOrThrow({ where: { slug: "hampshire" } })).id;
  await prisma.reviewSyncRun.deleteMany({ where: { connectionId } });
  await prisma.review.deleteMany({ where: { businessId } });
  await withTenant(tenantId, (tx) => tx.integrationConnection.deleteMany({ where: { id: connectionId } }));
  await prisma.business.deleteMany({ where: { id: businessId } });
  await prisma.user.deleteMany({ where: { id: userId } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

const samplePayload: NormalizedReview[] = [
  { providerReviewId: "g-1", rating: 5, ratingScaleMax: 5, body: "Great!", authorName: "Ada", reviewedAt: new Date("2026-01-02") },
  { providerReviewId: "g-2", rating: 4, ratingScaleMax: 5, body: "Good", authorName: "Bo", reviewedAt: new Date("2026-01-03") },
];

function connection(over: Partial<ProviderConnection> = {}): ProviderConnection {
  return { id: connectionId, externalAccountId: null, tokenExpiresAt: null, ...over };
}

describe("provider sync dedup", () => {
  it("syncing the same payload twice creates no duplicates", async () => {
    const provider = new MockGoogleProvider(samplePayload);
    const conn = connection({ externalAccountId: "acct-1" });

    const first = await syncProviderReviews(businessId, provider, conn);
    expect(first).toMatchObject({ ok: true, created: 2, duplicates: 0 });

    const second = await syncProviderReviews(businessId, provider, conn);
    expect(second).toMatchObject({ ok: true, created: 0, duplicates: 2 });

    expect(await prisma.review.count({ where: { businessId, provider: "GOOGLE" } })).toBe(2);
  });
});

describe("token expiry surfaces reconnect", () => {
  it("returns reconnect_required for an expired connection token, without throwing", async () => {
    const provider = new MockGoogleProvider(samplePayload);
    const res = await syncProviderReviews(businessId, provider, connection({ tokenExpiresAt: new Date(Date.now() - 1000) }));
    expect(res).toMatchObject({ ok: false, reason: "reconnect_required" });
    // nothing synced
    expect(await prisma.review.count({ where: { businessId } })).toBe(0);
  });
});

describe("first-party submission", () => {
  it("goes to moderation (PENDING), never visible immediately", async () => {
    const res = await submitFirstPartyReview({ businessId, userId, rating: 5, body: "Loved it" });
    expect(res).toMatchObject({ ok: true, moderation: "pending" });
    const review = await prisma.review.findFirstOrThrow({ where: { businessId, userId } });
    expect(review.moderationState).toBe("PENDING");
  });

  it("no gating: a 1-star review is accepted the same as a 5-star", async () => {
    const res = await submitFirstPartyReview({ businessId, userId, rating: 1, body: "Poor" });
    expect(res.ok).toBe(true);
  });

  it("blocks a second review of the same business by the same user", async () => {
    await submitFirstPartyReview({ businessId, userId, rating: 5 });
    const second = await submitFirstPartyReview({ businessId, userId, rating: 4 });
    expect(second).toMatchObject({ ok: false });
  });

  it("rejects an out-of-range rating", async () => {
    const res = await submitFirstPartyReview({ businessId, userId, rating: 9 });
    expect(res.ok).toBe(false);
  });
});

describe("aggregation is scale-aware", () => {
  it("combinedScore only averages one rating scale", async () => {
    // Two approved 5-scale reviews (4 and 5) + one 10-scale review (9).
    await prisma.review.createMany({
      data: [
        { businessId, provider: "GOOGLE", providerReviewId: "a", rating: 4, ratingScaleMax: 5, reviewedAt: new Date(), moderationState: "APPROVED" },
        { businessId, provider: "GOOGLE", providerReviewId: "b", rating: 5, ratingScaleMax: 5, reviewedAt: new Date(), moderationState: "APPROVED" },
        { businessId, provider: "TRUSTPILOT", providerReviewId: "c", rating: 9, ratingScaleMax: 10, reviewedAt: new Date(), moderationState: "APPROVED" },
      ],
    });
    const five = await combinedScore(businessId, 5);
    expect(five).toEqual({ average: 4.5, count: 2 }); // the 10-scale review is excluded

    const sources = await aggregatesByProvider(businessId);
    // one 5-scale group and one 10-scale group
    expect(sources.some((s) => s.scaleMax === 5 && s.count === 2)).toBe(true);
    expect(sources.some((s) => s.scaleMax === 10 && s.count === 1)).toBe(true);
  });
});
