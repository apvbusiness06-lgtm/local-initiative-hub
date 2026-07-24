// Slice 10 acceptance: concurrent redemption of one claim succeeds exactly
// once — enforced by Redemption.claimId's unique FK at the database level,
// not by application logic. Verified under parallel load.
import { afterEach, afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { generateRawToken } from "@/lib/auth/tokens";
import { claimOffer, redeemClaimByCode } from "@/lib/offers";

const prisma = new PrismaClient();

let businessId: string;
let offerId: string;
let userId: string;

beforeEach(async () => {
  const suffix = generateRawToken().slice(0, 8).toLowerCase();
  businessId = (
    await prisma.business.create({
      data: { slug: `redeem-biz-${suffix}`, tradingName: `Redeem ${suffix}`, status: "ACTIVE", sourceKind: "test" },
    })
  ).id;
  offerId = (
    await prisma.offer.create({
      data: {
        businessId,
        slug: `redeem-offer-${suffix}`,
        title: "10% off",
        type: "PERCENTAGE",
        percentOff: 10,
        startsAt: new Date(Date.now() - 1000),
        endsAt: new Date(Date.now() + 86_400_000),
        status: "ACTIVE",
      },
    })
  ).id;
  userId = (await prisma.user.create({ data: { email: `redeemer-${suffix}@example.com` } })).id;
});

afterEach(async () => {
  await prisma.redemption.deleteMany({ where: { claim: { offerId } } });
  await prisma.offerClaim.deleteMany({ where: { offerId } });
  await prisma.offer.deleteMany({ where: { id: offerId } });
  await prisma.business.deleteMany({ where: { id: businessId } });
  await prisma.user.deleteMany({ where: { id: userId } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("claimOffer", () => {
  it("issues a unique code and QR payload", async () => {
    const res = await claimOffer(offerId, userId, "https://example.test");
    expect("code" in res).toBe(true);
    if ("code" in res) {
      expect(res.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      expect(res.qrPayload).toContain("/redeem?code=");
    }
  });

  it("is idempotent per (offer, user) — a second claim returns the same code", async () => {
    const first = await claimOffer(offerId, userId, "https://example.test");
    const second = await claimOffer(offerId, userId, "https://example.test");
    expect("code" in first && "code" in second).toBe(true);
    if ("code" in first && "code" in second) expect(second.code).toBe(first.code);
    expect(await prisma.offerClaim.count({ where: { offerId } })).toBe(1);
  });
});

describe("concurrent redemption resolves to exactly one success", () => {
  it("fires 10 parallel redemptions of one claim; exactly one wins", async () => {
    const claim = await claimOffer(offerId, userId, "https://example.test");
    if (!("code" in claim)) throw new Error("claim failed");

    const attempts = await Promise.all(
      Array.from({ length: 10 }, () => redeemClaimByCode(claim.code, businessId)),
    );

    const successes = attempts.filter((a) => a.ok);
    const alreadyRedeemed = attempts.filter((a) => !a.ok && a.reason === "already_redeemed");
    expect(successes).toHaveLength(1);
    expect(alreadyRedeemed).toHaveLength(9);

    // Exactly one Redemption row exists for the claim.
    expect(await prisma.redemption.count({ where: { claimId: claim.claimId } })).toBe(1);
  });

  it("reports not_found for an unknown code", async () => {
    const res = await redeemClaimByCode("ZZZZ-ZZZZ", businessId);
    expect(res).toMatchObject({ ok: false, reason: "not_found" });
  });
});
