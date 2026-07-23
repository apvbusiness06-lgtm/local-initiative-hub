// Filters live in the URL so searches are shareable, back-button-correct
// and selectively indexable. This module is the single source of truth for
// that serialisation — never parse search params ad hoc elsewhere.

import type { SearchParams, SortKey } from "./search";

const SORTS: SortKey[] = ["relevance", "distance", "rating", "newest"];

export function parseSearchParams(
  sp: URLSearchParams,
  tenantId: string
): SearchParams {
  const num = (k: string) => {
    const v = sp.get(k);
    if (v == null || v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  const lat = num("lat");
  const lng = num("lng");
  // Reject out-of-range coordinates rather than passing them to PostGIS.
  const geoValid =
    lat != null && lng != null &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

  const sortRaw = sp.get("sort") as SortKey | null;

  const attributes: Record<string, string | boolean> = {};
  for (const [k, v] of sp.entries()) {
    if (!k.startsWith("attr_")) continue;
    const key = k.slice(5);
    attributes[key] = v === "true" ? true : v === "false" ? false : v;
  }

  return {
    tenantId,
    q: sp.get("q")?.trim().slice(0, 120) || undefined,
    lat: geoValid ? lat : undefined,
    lng: geoValid ? lng : undefined,
    // Clamp radius: unbounded values turn a radius query into a table scan.
    radiusMeters: Math.min(Math.max(num("radius") ?? 16000, 500), 80000),
    categorySlugs: sp.getAll("cat").filter(Boolean).slice(0, 5),
    placeId: sp.get("place") || undefined,
    openNow: sp.get("open") === "1",
    minRating: num("rating"),
    verifiedOnly: sp.get("verified") === "1",
    hasOffers: sp.get("offers") === "1",
    attributes: Object.keys(attributes).length ? attributes : undefined,
    sort: sortRaw && SORTS.includes(sortRaw) ? sortRaw : undefined,
    cursor: sp.get("cursor") || undefined,
    limit: Math.min(num("limit") ?? 20, 50),
  };
}

export function buildSearchUrl(p: Partial<SearchParams>, base = "/businesses"): string {
  const sp = new URLSearchParams();
  if (p.q) sp.set("q", p.q);
  if (p.lat != null && p.lng != null) {
    // Truncate to ~11m precision: full float precision is needless
    // location disclosure in a shareable link.
    sp.set("lat", p.lat.toFixed(4));
    sp.set("lng", p.lng.toFixed(4));
  }
  if (p.radiusMeters && p.radiusMeters !== 16000) sp.set("radius", String(p.radiusMeters));
  p.categorySlugs?.forEach((c) => sp.append("cat", c));
  if (p.placeId) sp.set("place", p.placeId);
  if (p.openNow) sp.set("open", "1");
  if (p.minRating) sp.set("rating", String(p.minRating));
  if (p.verifiedOnly) sp.set("verified", "1");
  if (p.hasOffers) sp.set("offers", "1");
  if (p.sort && p.sort !== "relevance") sp.set("sort", p.sort);
  if (p.attributes) {
    for (const [k, v] of Object.entries(p.attributes)) sp.set(`attr_${k}`, String(v));
  }
  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base;
}

/**
 * Filtered result pages are thin and near-duplicate — exactly the doorway
 * pages the spec forbids. Index only the clean category/location routes.
 */
export function shouldIndex(p: SearchParams): boolean {
  const filtered =
    p.openNow || p.hasOffers || p.verifiedOnly || p.minRating != null ||
    p.attributes != null || p.cursor != null || (p.categorySlugs?.length ?? 0) > 1;
  return !filtered && !p.q;
}
