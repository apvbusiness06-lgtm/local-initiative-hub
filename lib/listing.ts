// Slice 5: the listing page's data access. Visibility comes from an
// APPROVED DirectoryPlacement row for this tenant — same rule search.ts
// enforces — so this must run inside withTenant, never a plain findUnique
// on Business by slug (businesses itself carries no RLS; placement is the
// only thing that makes a record visible on a tenant).

import { cache } from "react";
import { Prisma } from "@prisma/client";
import { withTenant } from "./tenant";
import { searchListings, type SearchHit } from "./search";

export interface ListingLocation {
  addressLine1: string | null;
  addressLine2: string | null;
  locality: string | null;
  postcode: string | null;
  phone: string | null;
  email: string | null;
  lat: number | null;
  lng: number | null;
  placeName: string | null;
  placeSlug: string | null;
  offersDelivery: boolean;
  isRemoteOnly: boolean;
}

export interface ListingCategory {
  slug: string;
  name: string;
  schemaType: string | null;
  isPrimary: boolean;
}

export interface ListingService {
  id: string;
  name: string;
  description: string | null;
  priceMinor: number | null;
  currency: string;
  isFromPrice: boolean;
  imageUrl: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
}

export interface ListingMedia {
  id: string;
  url: string;
  altText: string | null;
}

export interface ListingReview {
  id: string;
  provider: string;
  rating: number;
  ratingScaleMax: number;
  title: string | null;
  body: string | null;
  authorName: string | null;
  reviewedAt: Date;
  responseBody: string | null;
}

export interface ListingOpeningHour {
  dayOfWeek: number;
  opensAt: string;
  closesAt: string;
  isClosed: boolean;
}

export interface ListingSpecialHour {
  date: Date;
  opensAt: string | null;
  closesAt: string | null;
  isClosed: boolean;
}

export interface ListingDetail {
  id: string;
  slug: string;
  tradingName: string;
  legalName: string | null;
  summary: string | null;
  description: string | null;
  websiteUrl: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  verified: boolean;
  claimState: string;
  isCanonical: boolean;
  isFeatured: boolean;
  isSponsored: boolean;
  localHeadline: string | null;
  localBlurb: string | null;
  location: ListingLocation | null;
  categories: ListingCategory[];
  services: ListingService[];
  gallery: ListingMedia[];
  reviews: ListingReview[];
  avgRating: number | null;
  reviewCount: number;
  openingHours: ListingOpeningHour[];
  specialHours: ListingSpecialHour[];
  activeOffers: ListingOffer[];
}

export interface ListingOffer {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  type: string;
  percentOff: number | null;
  amountOffMinor: number | null;
  currency: string;
  endsAt: Date;
  terms: string | null;
}

interface RawListingRow {
  id: string;
  slug: string;
  legalName: string | null;
  tradingName: string;
  summary: string | null;
  description: string | null;
  websiteUrl: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  claimState: string;
  verifiedAt: Date | null;
  isCanonical: boolean;
  isFeatured: boolean;
  isSponsored: boolean;
  localHeadline: string | null;
  localBlurb: string | null;
  locationId: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  locality: string | null;
  postcode: string | null;
  phone: string | null;
  email: string | null;
  lat: number | null;
  lng: number | null;
  offersDelivery: boolean | null;
  isRemoteOnly: boolean | null;
  placeName: string | null;
  placeSlug: string | null;
}

// Wrapped in React's request-scoped cache: generateMetadata and the page
// body both need this, and without memoisation that's two full round trips
// (placement join + five parallel queries) per request instead of one.
export const getListingForTenant = cache(async (tenantId: string, slug: string): Promise<ListingDetail | null> => {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx.$queryRaw<RawListingRow[]>(Prisma.sql`
      SELECT
        b.id, b.slug, b.legal_name AS "legalName", b.trading_name AS "tradingName",
        b.summary, b.description, b.website_url AS "websiteUrl",
        b.logo_url AS "logoUrl", b.cover_url AS "coverUrl",
        b.claim_state AS "claimState", b.verified_at AS "verifiedAt",
        dp.is_canonical AS "isCanonical", dp.is_featured AS "isFeatured", dp.is_sponsored AS "isSponsored",
        dp.local_headline AS "localHeadline", dp.local_blurb AS "localBlurb",
        l.id AS "locationId", l.address_line1 AS "addressLine1", l.address_line2 AS "addressLine2",
        l.locality, l.postcode, l.phone, l.email,
        ST_Y(l.point::geometry) AS lat, ST_X(l.point::geometry) AS lng,
        l.offers_delivery AS "offersDelivery", l.is_remote_only AS "isRemoteOnly",
        p.name AS "placeName", p.slug AS "placeSlug"
      FROM businesses b
      JOIN directory_placements dp ON dp.subject = 'BUSINESS' AND dp.subject_id = b.id
      LEFT JOIN business_locations l ON l.business_id = b.id AND l.is_primary = true AND l.deleted_at IS NULL
      LEFT JOIN places p ON p.id = l.place_id
      WHERE b.slug = ${slug}
        AND b.deleted_at IS NULL
        AND b.status = 'ACTIVE'
        AND dp.tenant_id = ${tenantId}::uuid
        AND dp.status = 'APPROVED'
      LIMIT 1
    `);
    const row = rows[0];
    if (!row) return null;

    const [categories, services, activeOffers, gallery, reviews, ratingAgg, openingHours, specialHours] = await Promise.all([
      tx.businessCategory.findMany({
        where: { businessId: row.id },
        include: { category: true },
        orderBy: { isPrimary: "desc" },
      }),
      tx.serviceProduct.findMany({ where: { businessId: row.id }, orderBy: { sortOrder: "asc" } }),
      // Business visibility on this tenant is already confirmed by the join
      // above; an offer has no placement of its own to check (see lib/offers.ts).
      tx.offer.findMany({
        where: {
          businessId: row.id,
          status: "ACTIVE",
          deletedAt: null,
          startsAt: { lte: new Date() },
          endsAt: { gte: new Date() },
        },
        orderBy: { endsAt: "asc" },
      }),
      tx.mediaAsset.findMany({
        where: { businessId: row.id, kind: "GALLERY" },
        orderBy: { sortOrder: "asc" },
      }),
      tx.review.findMany({
        where: { businessId: row.id, moderationState: "APPROVED" },
        include: { response: true },
        orderBy: { reviewedAt: "desc" },
        take: 20,
      }),
      tx.review.aggregate({
        where: { businessId: row.id, moderationState: "APPROVED" },
        _avg: { rating: true },
        _count: true,
      }),
      row.locationId
        ? tx.openingHour.findMany({ where: { locationId: row.locationId }, orderBy: { dayOfWeek: "asc" } })
        : Promise.resolve([]),
      row.locationId
        ? tx.specialHour.findMany({
            where: { locationId: row.locationId, date: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
            orderBy: { date: "asc" },
          })
        : Promise.resolve([]),
    ]);

    const listing: ListingDetail = {
      id: row.id,
      slug: row.slug,
      tradingName: row.tradingName,
      legalName: row.legalName,
      summary: row.summary,
      description: row.description,
      websiteUrl: row.websiteUrl,
      logoUrl: row.logoUrl,
      coverUrl: row.coverUrl,
      verified: row.verifiedAt != null,
      claimState: row.claimState,
      isCanonical: row.isCanonical,
      isFeatured: row.isFeatured,
      isSponsored: row.isSponsored,
      localHeadline: row.localHeadline,
      localBlurb: row.localBlurb,
      location: row.locationId
        ? {
            addressLine1: row.addressLine1,
            addressLine2: row.addressLine2,
            locality: row.locality,
            postcode: row.postcode,
            phone: row.phone,
            email: row.email,
            lat: row.lat,
            lng: row.lng,
            placeName: row.placeName,
            placeSlug: row.placeSlug,
            offersDelivery: row.offersDelivery ?? false,
            isRemoteOnly: row.isRemoteOnly ?? false,
          }
        : null,
      categories: categories.map((c) => ({
        slug: c.category.slug,
        name: c.category.name,
        schemaType: c.category.schemaType,
        isPrimary: c.isPrimary,
      })),
      services: services.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        priceMinor: s.priceMinor,
        currency: s.currency,
        isFromPrice: s.isFromPrice,
        imageUrl: s.imageUrl,
        ctaLabel: s.ctaLabel,
        ctaUrl: s.ctaUrl,
      })),
      gallery: gallery.map((m) => ({ id: m.id, url: m.url, altText: m.altText })),
      reviews: reviews.map((r) => ({
        id: r.id,
        provider: r.provider,
        rating: r.rating,
        ratingScaleMax: r.ratingScaleMax,
        title: r.title,
        body: r.body,
        authorName: r.authorName,
        reviewedAt: r.reviewedAt,
        // Only a published response is a business's real public reply.
        responseBody: r.response?.publishedAt ? r.response.body : null,
      })),
      avgRating: ratingAgg._avg.rating,
      reviewCount: ratingAgg._count,
      openingHours: openingHours.map((h) => ({
        dayOfWeek: h.dayOfWeek,
        opensAt: h.opensAt,
        closesAt: h.closesAt,
        isClosed: h.isClosed,
      })),
      specialHours: specialHours.map((s) => ({
        date: s.date,
        opensAt: s.opensAt,
        closesAt: s.closesAt,
        isClosed: s.isClosed,
      })),
      activeOffers: activeOffers.map((o) => ({
        id: o.id,
        slug: o.slug,
        title: o.title,
        description: o.description,
        type: o.type,
        percentOff: o.percentOff,
        amountOffMinor: o.amountOffMinor,
        currency: o.currency,
        endsAt: o.endsAt,
        terms: o.terms,
      })),
    };
    return listing;
  });
});

/** Same-category listings on this tenant, excluding the current business. */
export async function getSimilarBusinesses(
  tenantId: string,
  categorySlugs: string[],
  excludeBusinessId: string,
  limit = 4
): Promise<SearchHit[]> {
  if (!categorySlugs.length) return [];
  const result = await searchListings({
    tenantId,
    categorySlugs: categorySlugs.slice(0, 1), // primary category only — keep results tightly relevant
    sort: "rating",
    limit: limit + 1,
  });
  return result.hits.filter((h) => h.id !== excludeBusinessId).slice(0, limit);
}
