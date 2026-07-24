// Slice 6 acceptance criteria:
//   - a used or expired token fails;
//   - approval writes an AuditLog row with before/after;
//   - rejected claimants gain no access.
// Runs against the seeded DB. Uses a throwaway business + user created and
// torn down here so it never mutates seed rows other tests assert on.
import { afterAll, beforeEach, afterEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { generateRawToken, hashRawToken } from "@/lib/auth/tokens";
import {
  startClaim,
  consumeClaimToken,
  approveClaim,
  rejectClaim,
  userOwnsBusiness,
} from "@/lib/claims";

const prisma = new PrismaClient();

let businessId: string;
let claimantId: string;
let reviewerId: string;

async function makeBusiness(email: string | null) {
  const suffix = generateRawToken().slice(0, 8).toLowerCase();
  const business = await prisma.business.create({
    data: {
      slug: `claim-test-${suffix}`,
      tradingName: `Claim Test ${suffix}`,
      status: "ACTIVE",
      claimState: "UNCLAIMED",
      sourceKind: "test",
      locations: { create: { isPrimary: true, email, locality: "Testville" } },
    },
  });
  return business.id;
}

beforeEach(async () => {
  reviewerId = (await prisma.user.findUniqueOrThrow({ where: { email: "super-admin@demo.local-initiative.test" } })).id;
  const suffix = generateRawToken().slice(0, 8).toLowerCase();
  claimantId = (
    await prisma.user.create({
      data: { email: `claimant-${suffix}@example.com`, emailVerifiedAt: new Date() },
    })
  ).id;
  businessId = await makeBusiness("owner@claimtest.example.com");
});

afterEach(async () => {
  await prisma.auditLog.deleteMany({ where: { subjectId: businessId } });
  await prisma.listingClaim.deleteMany({ where: { businessId } });
  await prisma.businessOwner.deleteMany({ where: { businessId } });
  await prisma.businessLocation.deleteMany({ where: { businessId } });
  await prisma.business.deleteMany({ where: { id: businessId } });
  await prisma.user.deleteMany({ where: { id: claimantId } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("startClaim", () => {
  it("uses EMAIL_DOMAIN and returns a token when the business has an on-file email", async () => {
    const started = await startClaim(businessId, claimantId);
    expect(started.method).toBe("EMAIL_DOMAIN");
    expect(started.rawToken).toBeTruthy();
    expect(started.maskedEmail).toContain("@claimtest.example.com");
  });

  it("falls back to ADMIN_REVIEW (no token) when there's no on-file email", async () => {
    const noEmailBusiness = await makeBusiness(null);
    const started = await startClaim(noEmailBusiness, claimantId);
    expect(started.method).toBe("ADMIN_REVIEW");
    expect(started.rawToken).toBeUndefined();
    // lands straight in the queue as submitted evidence
    const claim = await prisma.listingClaim.findFirstOrThrow({ where: { businessId: noEmailBusiness } });
    expect(claim.status).toBe("EVIDENCE_SUBMITTED");
    await prisma.listingClaim.deleteMany({ where: { businessId: noEmailBusiness } });
    await prisma.businessLocation.deleteMany({ where: { businessId: noEmailBusiness } });
    await prisma.business.delete({ where: { id: noEmailBusiness } });
  });

  it("refuses to start on an already-claimed listing", async () => {
    await prisma.business.update({ where: { id: businessId }, data: { claimState: "CLAIMED" } });
    await expect(startClaim(businessId, claimantId)).rejects.toThrow(/already claimed/i);
  });
});

describe("consumeClaimToken", () => {
  it("rejects an unknown token", async () => {
    const res = await consumeClaimToken(generateRawToken());
    expect(res).toEqual({ ok: false, reason: "invalid" });
  });

  it("advances a valid token to the review queue exactly once (single-use)", async () => {
    const started = await startClaim(businessId, claimantId);
    const first = await consumeClaimToken(started.rawToken!);
    expect(first.ok).toBe(true);

    const claim = await prisma.listingClaim.findFirstOrThrow({ where: { businessId } });
    expect(claim.status).toBe("EVIDENCE_SUBMITTED");

    // Replay of the same link fails — the acceptance "a used token fails".
    const second = await consumeClaimToken(started.rawToken!);
    expect(second).toEqual({ ok: false, reason: "already_used" });
  });

  it("rejects an expired token", async () => {
    const started = await startClaim(businessId, claimantId);
    // Force expiry into the past.
    await prisma.listingClaim.updateMany({
      where: { businessId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const res = await consumeClaimToken(started.rawToken!);
    expect(res).toEqual({ ok: false, reason: "expired" });

    const claim = await prisma.listingClaim.findFirstOrThrow({ where: { businessId } });
    expect(claim.status).toBe("EXPIRED");
  });
});

describe("approveClaim", () => {
  it("grants ownership, marks the business claimed, and writes an AuditLog with before/after", async () => {
    const started = await startClaim(businessId, claimantId);
    await consumeClaimToken(started.rawToken!);
    const claim = await prisma.listingClaim.findFirstOrThrow({ where: { businessId } });

    expect(await userOwnsBusiness(claimantId, businessId)).toBe(false);

    const result = await approveClaim(claim.id, reviewerId);
    expect(result.ok).toBe(true);

    expect(await userOwnsBusiness(claimantId, businessId)).toBe(true);
    const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });
    expect(business.claimState).toBe("CLAIMED");

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { subject: "business", subjectId: businessId, action: "claim.approved" },
    });
    expect(audit.before).toMatchObject({ claimState: "UNCLAIMED" });
    expect(audit.after).toMatchObject({ claimState: "CLAIMED", ownerUserId: claimantId });
  });

  it("is a no-op on a claim that isn't awaiting review (no double-grant)", async () => {
    const started = await startClaim(businessId, claimantId);
    await consumeClaimToken(started.rawToken!);
    const claim = await prisma.listingClaim.findFirstOrThrow({ where: { businessId } });

    await approveClaim(claim.id, reviewerId);
    const second = await approveClaim(claim.id, reviewerId);
    expect(second.ok).toBe(false);
    // still exactly one owner
    const owners = await prisma.businessOwner.count({ where: { businessId } });
    expect(owners).toBe(1);
  });
});

describe("rejectClaim", () => {
  it("records the rejection and grants no access", async () => {
    const started = await startClaim(businessId, claimantId);
    await consumeClaimToken(started.rawToken!);
    const claim = await prisma.listingClaim.findFirstOrThrow({ where: { businessId } });

    const result = await rejectClaim(claim.id, reviewerId, "Could not verify ownership");
    expect(result.ok).toBe(true);

    expect(await userOwnsBusiness(claimantId, businessId)).toBe(false);
    const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });
    expect(business.claimState).toBe("UNCLAIMED");

    const updated = await prisma.listingClaim.findUniqueOrThrow({ where: { id: claim.id } });
    expect(updated.status).toBe("REJECTED");
    expect(updated.rejectionReason).toBe("Could not verify ownership");

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { subject: "business", subjectId: businessId, action: "claim.rejected" },
    });
    expect(audit.after).toMatchObject({ status: "REJECTED" });
  });
});

// hashRawToken parity: the token the user receives hashes to what's stored.
describe("token hashing", () => {
  it("matches the stored hash for the emailed raw token", async () => {
    const started = await startClaim(businessId, claimantId);
    const claim = await prisma.listingClaim.findFirstOrThrow({ where: { businessId } });
    expect(claim.tokenHash).toBe(hashRawToken(started.rawToken!));
  });
});
