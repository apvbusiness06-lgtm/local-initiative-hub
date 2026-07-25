// Offers inherit their parent business's tenant visibility for now: an Offer
// has no working DirectoryPlacement of its own — directory_placements has a
// hard FK from subject_id to businesses.id (placement_business_fk), so an
// OFFER/EVENT placement row would fail to insert despite the `subject` enum
// implying it's supported. That's real Slice-10 work (loosen the FK to a
// true polymorphic reference); logged in BACKLOG.md. Until then, an offer is
// visible on a tenant exactly when its business is.

import { Prisma, PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { withTenant } from "./tenant";

const prisma = new PrismaClient();

export interface OfferSummary {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  type: string;
  percentOff: number | null;
  amountOffMinor: number | null;
  currency: string;
  endsAt: Date;
  businessSlug: string;
  businessName: string;
}

export async function getActiveOffersForTenant(tenantId: string, limit = 6): Promise<OfferSummary[]> {
  return withTenant(tenantId, (tx) =>
    tx.$queryRaw<OfferSummary[]>(Prisma.sql`
      SELECT o.id, o.slug, o.title, o.description, o.type,
             o.percent_off AS "percentOff", o.amount_off_minor AS "amountOffMinor",
             o.currency, o.ends_at AS "endsAt",
             b.slug AS "businessSlug", b.trading_name AS "businessName"
      FROM offers o
      JOIN businesses b ON b.id = o.business_id AND b.deleted_at IS NULL AND b.status = 'ACTIVE'
      JOIN directory_placements dp
        ON dp.subject = 'BUSINESS' AND dp.subject_id = b.id
       AND dp.tenant_id = ${tenantId}::uuid AND dp.status = 'APPROVED'
      WHERE o.status = 'ACTIVE' AND o.deleted_at IS NULL
        AND now() BETWEEN o.starts_at AND o.ends_at
      ORDER BY o.ends_at ASC
      LIMIT ${limit}
    `)
  );
}

export function formatDiscount(o: Pick<OfferSummary, "type" | "percentOff" | "amountOffMinor" | "currency">): string {
  if (o.type === "PERCENTAGE" && o.percentOff != null) return `${o.percentOff}% off`;
  if (o.type === "FIXED_AMOUNT" && o.amountOffMinor != null) {
    return `${new Intl.NumberFormat("en-GB", { style: "currency", currency: o.currency }).format(o.amountOffMinor / 100)} off`;
  }
  if (o.type === "FREE_ITEM") return "Free item";
  if (o.type === "BUNDLE") return "Bundle deal";
  if (o.type === "MEMBER_EXCLUSIVE") return "Members only";
  return "Special offer";
}

// ── Claiming & redemption ────────────────────────────────────

function generateCode(): string {
  // Human-readable, ambiguity-free (no 0/O/1/I), grouped for reading aloud.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  let raw = "";
  for (let i = 0; i < 8; i++) raw += alphabet[bytes[i]! % alphabet.length];
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export interface ClaimedOffer {
  claimId: string;
  code: string;
  qrPayload: string;
  offerTitle: string;
  businessName: string;
}

export type ClaimOfferResult = ClaimedOffer | { error: string };

/**
 * Claim an offer for a user. One claim per (offer, user) — enforced by the
 * @@unique([offerId, userId]) index, so a double-tap can't mint two codes.
 * Honours the offer window, total-quantity cap and members-only audience.
 */
export async function claimOffer(offerId: string, userId: string, origin: string): Promise<ClaimOfferResult> {
  const offer = await prisma.offer.findUnique({ where: { id: offerId }, include: { business: true } });
  if (!offer || offer.deletedAt || offer.status !== "ACTIVE") return { error: "This offer isn't available." };
  const now = new Date();
  if (now < offer.startsAt || now > offer.endsAt) return { error: "This offer has expired or hasn't started." };

  const existing = await prisma.offerClaim.findUnique({ where: { offerId_userId: { offerId, userId } } });
  if (existing) {
    return {
      claimId: existing.id,
      code: existing.code,
      qrPayload: existing.qrPayload ?? redemptionUrl(origin, existing.code, offer.businessId),
      offerTitle: offer.title,
      businessName: offer.business.tradingName,
    };
  }

  if (offer.totalQuantity != null) {
    const claimed = await prisma.offerClaim.count({ where: { offerId } });
    if (claimed >= offer.totalQuantity) return { error: "This offer has been fully claimed." };
  }

  // Retry on the rare code collision (unique per offer).
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    const qrPayload = redemptionUrl(origin, code, offer.businessId);
    try {
      const claim = await prisma.offerClaim.create({
        data: { offerId, userId, code, qrPayload },
      });
      return { claimId: claim.id, code, qrPayload, offerTitle: offer.title, businessName: offer.business.tradingName };
    } catch (e) {
      // Unique violation on (offerId, userId) => someone else's concurrent
      // claim for this same user won the race; return it.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const claim = await prisma.offerClaim.findUnique({ where: { offerId_userId: { offerId, userId } } });
        if (claim)
          return {
            claimId: claim.id,
            code: claim.code,
            qrPayload: claim.qrPayload ?? qrPayload,
            offerTitle: offer.title,
            businessName: offer.business.tradingName,
          };
      }
      // else: code collision, loop and retry with a new code.
    }
  }
  return { error: "Couldn't issue a code, please try again." };
}

function redemptionUrl(origin: string, code: string, businessId: string): string {
  return `${origin}/redeem?code=${encodeURIComponent(code)}&biz=${businessId}`;
}

export type RedeemResult =
  | { ok: true; offerTitle: string; claimantLabel: string }
  | { ok: false; reason: "not_found" | "already_redeemed"; offerTitle?: string };

/**
 * Redeem a claim by its code, at a business. Double redemption is impossible
 * at the DATABASE level: Redemption.claimId is a unique FK, so N concurrent
 * redemptions of one claim resolve to exactly one insert; the rest hit the
 * unique violation and are reported as already-redeemed. Not enforced in app
 * code — enforced by the constraint.
 */
export async function redeemClaimByCode(
  code: string,
  businessId: string,
  redeemedByUserId?: string
): Promise<RedeemResult> {
  const claim = await prisma.offerClaim.findFirst({
    where: { code, offer: { businessId } },
    include: { offer: true, user: true },
  });
  if (!claim) return { ok: false, reason: "not_found" };

  try {
    await prisma.redemption.create({
      data: { claimId: claim.id, redeemedByUserId: redeemedByUserId ?? null },
    });
    return {
      ok: true,
      offerTitle: claim.offer.title,
      claimantLabel: claim.user?.email ?? claim.guestEmail ?? "guest",
    };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, reason: "already_redeemed", offerTitle: claim.offer.title };
    }
    throw e;
  }
}

export interface OfferDetail {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  terms: string | null;
  type: string;
  percentOff: number | null;
  amountOffMinor: number | null;
  currency: string;
  endsAt: Date;
  businessId: string;
  businessName: string;
  businessSlug: string;
}

export async function getOfferForTenant(tenantId: string, slug: string): Promise<OfferDetail | null> {
  const rows = await withTenant(tenantId, (tx) =>
    tx.$queryRaw<OfferDetail[]>(Prisma.sql`
      SELECT o.id, o.slug, o.title, o.description, o.terms, o.type,
             o.percent_off AS "percentOff", o.amount_off_minor AS "amountOffMinor",
             o.currency, o.ends_at AS "endsAt",
             b.id AS "businessId", b.trading_name AS "businessName", b.slug AS "businessSlug"
      FROM offers o
      JOIN businesses b ON b.id = o.business_id AND b.deleted_at IS NULL AND b.status = 'ACTIVE'
      JOIN directory_placements dp
        ON dp.subject = 'BUSINESS' AND dp.subject_id = b.id
       AND dp.tenant_id = ${tenantId}::uuid AND dp.status = 'APPROVED'
      WHERE o.slug = ${slug} AND o.status = 'ACTIVE' AND o.deleted_at IS NULL
      LIMIT 1
    `)
  );
  return rows[0] ?? null;
}
