// Offers inherit their parent business's tenant visibility for now: an Offer
// has no working DirectoryPlacement of its own — directory_placements has a
// hard FK from subject_id to businesses.id (placement_business_fk), so an
// OFFER/EVENT placement row would fail to insert despite the `subject` enum
// implying it's supported. That's real Slice-10 work (loosen the FK to a
// true polymorphic reference); logged in BACKLOG.md. Until then, an offer is
// visible on a tenant exactly when its business is.

import { Prisma } from "@prisma/client";
import { withTenant } from "./tenant";

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
