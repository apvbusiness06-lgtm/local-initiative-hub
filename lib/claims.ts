// Slice 6 — claim flow. Ownership is separate from the listing (README:
// "an imported listing exists with no owner"), so this is the only path that
// creates a BusinessOwner. Two-factor by design:
//
//   1. Possession: a single-use, expiring, hashed token is emailed to the
//      business's ON-FILE public email. Clicking it proves the claimant
//      controls that inbox — the same "leaked DB row is never a usable
//      token" property as lib/auth/tokens.ts.
//   2. Authority: a tenant admin (or platform super-admin) then approves in
//      the queue. Approval — never the token click — grants ownership and
//      writes the audit record.
//
// A business with no on-file email can't be verified by possession, so it
// falls back to ADMIN_REVIEW: no token, straight to the queue with evidence
// noting manual verification is required.

import { PrismaClient, Prisma, type ClaimMethod, type ClaimStatus } from "@prisma/client";
import { generateRawToken, hashRawToken } from "@/lib/auth/tokens";

const prisma = new PrismaClient();

const CLAIM_TOKEN_TTL_MS = 1000 * 60 * 60 * 48; // 48h to receive + click the email

export interface StartedClaim {
  claimId: string;
  method: ClaimMethod;
  // Present only when possession-verifiable: the raw token to email, and the
  // masked destination address to show the claimant ("we've emailed h***@…").
  rawToken?: string;
  emailTo?: string;
  maskedEmail?: string;
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "the business's email";
  const head = local.slice(0, 1);
  return `${head}${"*".repeat(Math.max(1, local.length - 1))}@${domain}`;
}

/** The domain of a business's on-file public email, if any (for EMAIL_DOMAIN evidence). */
export function businessContactEmail(location: { email: string | null } | null): string | null {
  const email = location?.email?.trim().toLowerCase();
  return email && email.includes("@") ? email : null;
}

/**
 * Start (or resume) a claim. Idempotent per (business, user): a user who
 * re-starts a pending claim gets a fresh token, not a duplicate row — an
 * abandoned claim shouldn't block a retry.
 */
export async function startClaim(businessId: string, userId: string): Promise<StartedClaim> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    include: { locations: { where: { isPrimary: true }, take: 1 } },
  });
  if (!business) throw new Error("Business not found");
  if (business.claimState === "CLAIMED") throw new Error("This listing is already claimed");

  const contactEmail = businessContactEmail(business.locations[0] ?? null);
  const method: ClaimMethod = contactEmail ? "EMAIL_DOMAIN" : "ADMIN_REVIEW";

  // Reuse any still-open claim by this user; otherwise create one.
  const existing = await prisma.listingClaim.findFirst({
    where: { businessId, userId, status: { in: ["STARTED", "EVIDENCE_SUBMITTED"] } },
  });

  if (method === "ADMIN_REVIEW") {
    const claim = existing
      ? await prisma.listingClaim.update({
          where: { id: existing.id },
          data: {
            method,
            status: "EVIDENCE_SUBMITTED",
            tokenHash: null,
            expiresAt: null,
            evidence: { kind: "admin_review", note: "No on-file email; manual verification required." },
          },
        })
      : await prisma.listingClaim.create({
          data: {
            businessId,
            userId,
            method,
            status: "EVIDENCE_SUBMITTED",
            evidence: { kind: "admin_review", note: "No on-file email; manual verification required." },
          },
        });
    return { claimId: claim.id, method };
  }

  const rawToken = generateRawToken();
  const tokenHash = hashRawToken(rawToken);
  const expiresAt = new Date(Date.now() + CLAIM_TOKEN_TTL_MS);

  const claim = existing
    ? await prisma.listingClaim.update({
        where: { id: existing.id },
        data: { method, status: "STARTED", tokenHash, expiresAt, evidence: Prisma.DbNull },
      })
    : await prisma.listingClaim.create({
        data: { businessId, userId, method, status: "STARTED", tokenHash, expiresAt },
      });

  return {
    claimId: claim.id,
    method,
    rawToken,
    emailTo: contactEmail!,
    maskedEmail: maskEmail(contactEmail!),
  };
}

export type ClaimTokenResult =
  | { ok: true; claimId: string; businessId: string }
  | { ok: false; reason: "invalid" | "expired" | "already_used" };

/**
 * Validate a claim-link token. Single-use and expiring: a token whose claim
 * has already advanced past STARTED (submitted, approved, rejected) or whose
 * expiry has passed fails — the two acceptance cases in the brief.
 */
export async function consumeClaimToken(rawToken: string): Promise<ClaimTokenResult> {
  const tokenHash = hashRawToken(rawToken);
  const claim = await prisma.listingClaim.findUnique({ where: { tokenHash } });
  if (!claim) return { ok: false, reason: "invalid" };

  if (claim.status !== "STARTED") return { ok: false, reason: "already_used" };
  if (!claim.expiresAt || claim.expiresAt.getTime() < Date.now()) {
    await prisma.listingClaim.update({ where: { id: claim.id }, data: { status: "EXPIRED" } }).catch(() => {});
    return { ok: false, reason: "expired" };
  }

  // Possession proven. Advance to the admin queue. The token hash is left in
  // place (it's a hash, not the token) so a replayed link is reported as
  // "already used" rather than "invalid"; single-use is enforced by the
  // status guard above — only a STARTED claim can be consumed.
  await prisma.listingClaim.update({
    where: { id: claim.id },
    data: {
      status: "EVIDENCE_SUBMITTED",
      evidence: { kind: "email_possession", verifiedAt: new Date().toISOString() },
    },
  });
  return { ok: true, claimId: claim.id, businessId: claim.businessId };
}

/** The tenant whose admins may review this business's claims (its canonical placement). */
export async function reviewingTenantForBusiness(businessId: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ tenant_id: string | null }[]>`
    SELECT canonical_tenant_for_subject('BUSINESS'::"PlacementSubject", ${businessId}::uuid) AS tenant_id
  `;
  return rows[0]?.tenant_id ?? null;
}

export interface ClaimDecisionResult {
  ok: boolean;
  error?: string;
}

/**
 * Approve a claim: grant ownership and record it. Everything runs in one
 * transaction and writes an AuditLog with before/after (acceptance
 * criterion). Guarded against double-approval: a claim not currently in
 * EVIDENCE_SUBMITTED is a no-op error, so a replayed approval can't
 * re-grant.
 */
export async function approveClaim(claimId: string, reviewerUserId: string): Promise<ClaimDecisionResult> {
  return prisma.$transaction(async (tx) => {
    const claim = await tx.listingClaim.findUnique({ where: { id: claimId }, include: { business: true } });
    if (!claim) return { ok: false, error: "Claim not found" };
    if (claim.status !== "EVIDENCE_SUBMITTED") {
      return { ok: false, error: `Claim is ${claim.status.toLowerCase()}, not awaiting review` };
    }

    const before = { claimState: claim.business.claimState, verified: claim.business.verifiedAt != null };

    await tx.businessOwner.upsert({
      where: { businessId_userId: { businessId: claim.businessId, userId: claim.userId } },
      update: {},
      create: { businessId: claim.businessId, userId: claim.userId },
    });

    await tx.business.update({
      where: { id: claim.businessId },
      data: { claimState: "CLAIMED", verifiedAt: claim.business.verifiedAt ?? new Date() },
    });

    await tx.listingClaim.update({
      where: { id: claim.id },
      data: { status: "APPROVED", reviewedBy: reviewerUserId, reviewedAt: new Date() },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: reviewerUserId,
        action: "claim.approved",
        subject: "business",
        subjectId: claim.businessId,
        before,
        after: { claimState: "CLAIMED", verified: true, ownerUserId: claim.userId },
      },
    });

    return { ok: true };
  });
}

/** Reject a claim: record the decision, grant no access. */
export async function rejectClaim(
  claimId: string,
  reviewerUserId: string,
  reason: string
): Promise<ClaimDecisionResult> {
  return prisma.$transaction(async (tx) => {
    const claim = await tx.listingClaim.findUnique({ where: { id: claimId } });
    if (!claim) return { ok: false, error: "Claim not found" };
    if (claim.status !== "EVIDENCE_SUBMITTED") {
      return { ok: false, error: `Claim is ${claim.status.toLowerCase()}, not awaiting review` };
    }

    await tx.listingClaim.update({
      where: { id: claim.id },
      data: { status: "REJECTED", reviewedBy: reviewerUserId, reviewedAt: new Date(), rejectionReason: reason.slice(0, 500) },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: reviewerUserId,
        action: "claim.rejected",
        subject: "business",
        subjectId: claim.businessId,
        before: { status: "EVIDENCE_SUBMITTED" },
        after: { status: "REJECTED", reason: reason.slice(0, 500) },
      },
    });

    return { ok: true };
  });
}

export interface PendingClaim {
  id: string;
  status: ClaimStatus;
  method: ClaimMethod | null;
  createdAt: Date;
  businessId: string;
  businessName: string;
  businessSlug: string;
  claimantEmail: string;
  evidenceKind: string | null;
}

/** Claims awaiting review for the businesses a given tenant is canonical for. */
export async function pendingClaimsForTenant(tenantId: string): Promise<PendingClaim[]> {
  return prisma.$queryRaw<PendingClaim[]>(Prisma.sql`
    SELECT lc.id, lc.status, lc.method, lc.created_at AS "createdAt",
           b.id AS "businessId", b.trading_name AS "businessName", b.slug AS "businessSlug",
           u.email AS "claimantEmail",
           lc.evidence->>'kind' AS "evidenceKind"
    FROM listing_claims lc
    JOIN businesses b ON b.id = lc.business_id
    JOIN users u ON u.id = lc.user_id
    WHERE lc.status = 'EVIDENCE_SUBMITTED'
      AND canonical_tenant_for_subject('BUSINESS'::"PlacementSubject", b.id) = ${tenantId}::uuid
    ORDER BY lc.created_at ASC
  `);
}

/** Does this user own this business? (drives portal access in Slice 7) */
export async function userOwnsBusiness(userId: string, businessId: string): Promise<boolean> {
  const owner = await prisma.businessOwner.findUnique({
    where: { businessId_userId: { businessId, userId } },
  });
  return !!owner;
}
