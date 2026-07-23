// Directory search: full-text + geospatial + filters, tenant-scoped.
//
// Design notes:
//  - Ranking is computed in SQL so pagination is stable and correct.
//  - Sponsored results occupy a reserved slot and are NOT boosted into the
//    organic ranking. Relevance stays honest; the label stays truthful.
//  - Cursor pagination, not OFFSET: offsets drift as data changes and
//    degrade badly past a few thousand rows.

import { Prisma } from "@prisma/client";
import { withTenant } from "./tenant";

export type SortKey = "relevance" | "distance" | "rating" | "newest";

export interface SearchParams {
  tenantId: string;
  q?: string;
  lat?: number;
  lng?: number;
  radiusMeters?: number;
  categorySlugs?: string[];
  placeId?: string;
  openNow?: boolean;
  minRating?: number;
  verifiedOnly?: boolean;
  hasOffers?: boolean;
  attributes?: Record<string, string | boolean>;
  sort?: SortKey;
  cursor?: string;
  limit?: number;
}

export interface SearchHit {
  id: string;
  slug: string;
  tradingName: string;
  summary: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  verified: boolean;
  distanceMeters: number | null;
  avgRating: number | null;
  reviewCount: number;
  isSponsored: boolean;
  lat: number | null;
  lng: number | null;
  rank: number;
}

export interface SearchResult {
  hits: SearchHit[];
  sponsored: SearchHit[];
  nextCursor: string | null;
  totalApprox: number;
}

const MAX_LIMIT = 50;
const DEFAULT_RADIUS = 16_000; // ~10 miles

function encodeCursor(v: { rank: number; id: string }): string {
  return Buffer.from(JSON.stringify(v)).toString("base64url");
}

function decodeCursor(c?: string): { rank: number; id: string } | null {
  if (!c) return null;
  try {
    const p = JSON.parse(Buffer.from(c, "base64url").toString());
    return typeof p.rank === "number" && typeof p.id === "string" ? p : null;
  } catch {
    return null;
  }
}

export async function searchListings(params: SearchParams): Promise<SearchResult> {
  const limit = Math.min(params.limit ?? 20, MAX_LIMIT);
  const sort: SortKey = params.sort ?? (params.q ? "relevance" : "distance");
  const cursor = decodeCursor(params.cursor);
  const hasGeo = params.lat != null && params.lng != null;
  const radius = params.radiusMeters ?? DEFAULT_RADIUS;

  // ── Predicates ────────────────────────────────────────────
  const where: Prisma.Sql[] = [
    Prisma.sql`b.deleted_at IS NULL`,
    Prisma.sql`b.status = 'ACTIVE'`,
    // Placement is what makes a listing visible on this tenant.
    Prisma.sql`dp.tenant_id = ${params.tenantId}::uuid`,
    Prisma.sql`dp.status = 'APPROVED'`,
  ];

  if (params.q) {
    // websearch_to_tsquery handles quoted phrases and OR/- from user input
    // without throwing on malformed syntax the way to_tsquery does.
    where.push(
      Prisma.sql`b.search_vector @@ websearch_to_tsquery('english', ${params.q})`
    );
  }

  if (hasGeo) {
    where.push(Prisma.sql`
      ST_DWithin(
        l.point,
        ST_SetSRID(ST_MakePoint(${params.lng}, ${params.lat}), 4326)::geography,
        ${radius}
      )`);
  }

  if (params.placeId) {
    where.push(Prisma.sql`l.place_id = ${params.placeId}::uuid`);
  }

  if (params.categorySlugs?.length) {
    where.push(Prisma.sql`EXISTS (
      SELECT 1 FROM business_categories bc
      JOIN categories c ON c.id = bc.category_id
      WHERE bc.business_id = b.id AND c.slug = ANY(${params.categorySlugs})
    )`);
  }

  if (params.verifiedOnly) {
    where.push(Prisma.sql`b.verified_at IS NOT NULL`);
  }

  if (params.hasOffers) {
    where.push(Prisma.sql`EXISTS (
      SELECT 1 FROM offers o
      WHERE o.business_id = b.id
        AND o.status = 'ACTIVE'
        AND o.deleted_at IS NULL
        AND now() BETWEEN o.starts_at AND o.ends_at
    )`);
  }

  if (params.openNow) {
    // Evaluated in the tenant timezone, with special hours overriding.
    where.push(Prisma.sql`EXISTS (
      SELECT 1 FROM opening_hours oh
      WHERE oh.location_id = l.id
        AND oh.is_closed = false
        AND oh.day_of_week = EXTRACT(DOW FROM now() AT TIME ZONE 'Europe/London')
        AND (now() AT TIME ZONE 'Europe/London')::time
            BETWEEN oh.opens_at::time AND oh.closes_at::time
    ) AND NOT EXISTS (
      SELECT 1 FROM special_hours sh
      WHERE sh.location_id = l.id
        AND sh.date = (now() AT TIME ZONE 'Europe/London')::date
        AND sh.is_closed = true
    )`);
  }

  if (params.attributes) {
    for (const [key, value] of Object.entries(params.attributes)) {
      where.push(Prisma.sql`EXISTS (
        SELECT 1 FROM business_attribute_values bav
        JOIN attributes a ON a.id = bav.attribute_id
        WHERE bav.business_id = b.id
          AND a.key = ${key}
          AND bav.value = ${JSON.stringify(value)}::jsonb
      )`);
    }
  }

  if (params.minRating != null) {
    where.push(Prisma.sql`COALESCE(r.avg_rating, 0) >= ${params.minRating}`);
  }

  // ── Rank expression ───────────────────────────────────────
  const distanceExpr = hasGeo
    ? Prisma.sql`ST_Distance(l.point, ST_SetSRID(ST_MakePoint(${params.lng}, ${params.lat}), 4326)::geography)`
    : Prisma.sql`NULL::float8`;

  // Higher rank = better, so cursor comparison is uniformly "less than".
  let rankExpr: Prisma.Sql;
  switch (sort) {
    case "distance":
      rankExpr = hasGeo
        ? Prisma.sql`(1.0 / (1.0 + ${distanceExpr} / 1000.0))`
        : Prisma.sql`0.0::float8`;
      break;
    case "rating":
      rankExpr = Prisma.sql`COALESCE(r.avg_rating, 0)::float8`;
      break;
    case "newest":
      rankExpr = Prisma.sql`EXTRACT(EPOCH FROM b.created_at)::float8`;
      break;
    default:
      // Text relevance, nudged by proximity and rating — modest weights so
      // a highly-rated distant business can't outrank an exact local match.
      rankExpr = params.q
        ? Prisma.sql`(
            ts_rank(b.search_vector, websearch_to_tsquery('english', ${params.q})) * 10.0
            + ${hasGeo ? Prisma.sql`(1.0 / (1.0 + ${distanceExpr} / 1000.0)) * 2.0` : Prisma.sql`0.0`}
            + COALESCE(r.avg_rating, 0) * 0.3
          )::float8`
        : Prisma.sql`(
            ${hasGeo ? Prisma.sql`(1.0 / (1.0 + ${distanceExpr} / 1000.0)) * 2.0` : Prisma.sql`0.0`}
            + COALESCE(r.avg_rating, 0) * 0.3
          )::float8`;
  }

  if (cursor) {
    where.push(
      Prisma.sql`(${rankExpr}, b.id) < (${cursor.rank}::float8, ${cursor.id}::uuid)`
    );
  }

  const whereSql = Prisma.join(where, " AND ");

  // Aggregate reviews once in a lateral join rather than a correlated
  // subquery per output column.
  const fromSql = Prisma.sql`
    FROM businesses b
    JOIN directory_placements dp
      ON dp.subject = 'BUSINESS' AND dp.subject_id = b.id
    JOIN business_locations l
      ON l.business_id = b.id AND l.is_primary = true AND l.deleted_at IS NULL
    LEFT JOIN LATERAL (
      SELECT AVG(rating)::float8 AS avg_rating, COUNT(*)::int AS review_count
      FROM reviews rv
      WHERE rv.business_id = b.id AND rv.moderation_state = 'APPROVED'
    ) r ON true
  `;

  const selectSql = Prisma.sql`
    SELECT
      b.id, b.slug, b.trading_name AS "tradingName", b.summary,
      b.logo_url AS "logoUrl", b.cover_url AS "coverUrl",
      (b.verified_at IS NOT NULL) AS verified,
      ${distanceExpr} AS "distanceMeters",
      r.avg_rating AS "avgRating",
      COALESCE(r.review_count, 0) AS "reviewCount",
      dp.is_sponsored AS "isSponsored",
      ST_Y(l.point::geometry) AS lat,
      ST_X(l.point::geometry) AS lng,
      ${rankExpr} AS rank
  `;

  const [organic, sponsored, count] = await withTenant(params.tenantId, async (tx) => {
    // Organic results exclude sponsored so a paid slot never displaces
    // an organic position.
    const organicRows = await tx.$queryRaw<SearchHit[]>(Prisma.sql`
      ${selectSql} ${fromSql}
      WHERE ${whereSql} AND dp.is_sponsored = false
      ORDER BY rank DESC, b.id DESC
      LIMIT ${limit + 1}
    `);

    // Sponsored only on the first page, capped, and always labelled.
    const sponsoredRows = cursor
      ? []
      : await tx.$queryRaw<SearchHit[]>(Prisma.sql`
          ${selectSql} ${fromSql}
          WHERE ${whereSql}
            AND dp.is_sponsored = true
            AND (dp.featured_to IS NULL OR dp.featured_to > now())
          ORDER BY rank DESC, b.id DESC
          LIMIT 2
        `);

    const countRows = await tx.$queryRaw<{ n: bigint }[]>(Prisma.sql`
      SELECT COUNT(*)::bigint AS n ${fromSql} WHERE ${whereSql}
    `);

    return [organicRows, sponsoredRows, Number(countRows[0]?.n ?? 0)] as const;
  });

  const hasMore = organic.length > limit;
  const hits = hasMore ? organic.slice(0, limit) : organic;
  const last = hits[hits.length - 1];

  return {
    hits,
    sponsored,
    nextCursor: hasMore && last ? encodeCursor({ rank: last.rank, id: last.id }) : null,
    totalApprox: count,
  };
}

/**
 * Nearby alternatives for zero-result searches: same query, widened radius.
 */
export async function suggestNearby(params: SearchParams): Promise<SearchHit[]> {
  const widened = await searchListings({
    ...params,
    radiusMeters: (params.radiusMeters ?? DEFAULT_RADIUS) * 4,
    cursor: undefined,
    limit: 6,
  });
  return widened.hits;
}
