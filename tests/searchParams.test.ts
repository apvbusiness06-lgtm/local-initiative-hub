import { describe, expect, it } from "vitest";
import { parseSearchParams, buildSearchUrl, shouldIndex } from "@/lib/searchParams";

const TENANT = "11111111-1111-1111-1111-111111111111";

function parse(query: string) {
  return parseSearchParams(new URLSearchParams(query), TENANT);
}

describe("parseSearchParams — round trip", () => {
  it("carries the tenant id through untouched", () => {
    expect(parse("").tenantId).toBe(TENANT);
  });

  it("round-trips q, lat/lng, radius, sort and flags through buildSearchUrl", () => {
    const original = parse(
      "q=plumber&lat=51.06&lng=-1.31&radius=5000&sort=rating&open=1&verified=1&offers=1&rating=4"
    );
    const url = buildSearchUrl(original);
    const roundTripped = parseSearchParams(new URLSearchParams(url.split("?")[1]), TENANT);

    expect(roundTripped.q).toBe("plumber");
    expect(roundTripped.lat).toBeCloseTo(51.06, 3);
    expect(roundTripped.lng).toBeCloseTo(-1.31, 3);
    expect(roundTripped.radiusMeters).toBe(5000);
    expect(roundTripped.sort).toBe("rating");
    expect(roundTripped.openNow).toBe(true);
    expect(roundTripped.verifiedOnly).toBe(true);
    expect(roundTripped.hasOffers).toBe(true);
    expect(roundTripped.minRating).toBe(4);
  });

  it("round-trips category slugs and attribute filters", () => {
    const original = parse("cat=plumbers&cat=electricians&attr_wheelchair_access=true&attr_price_band=%C2%A3%C2%A3");
    const url = buildSearchUrl(original);
    const roundTripped = parseSearchParams(new URLSearchParams(url.split("?")[1]), TENANT);

    expect(roundTripped.categorySlugs).toEqual(["plumbers", "electricians"]);
    expect(roundTripped.attributes).toEqual({ wheelchair_access: true, price_band: "££" });
  });

  it("omits defaults from the URL (radius 16000, sort relevance)", () => {
    const url = buildSearchUrl({ q: "cafe" });
    expect(url).not.toContain("radius=");
    expect(url).not.toContain("sort=");
  });
});

describe("parseSearchParams — validation", () => {
  it("defaults q to undefined when absent", () => {
    expect(parse("").q).toBeUndefined();
  });

  it("trims whitespace and caps query length at 120 chars", () => {
    const long = "a".repeat(200);
    expect(parse(`q=${"  padded  "}`).q).toBe("padded");
    expect(parse(`q=${long}`).q?.length).toBe(120);
  });

  it("treats an empty q as absent", () => {
    expect(parse("q=").q).toBeUndefined();
  });

  it("rejects latitude above 90", () => {
    expect(parse("lat=91&lng=0").lat).toBeUndefined();
    expect(parse("lat=91&lng=0").lng).toBeUndefined();
  });

  it("rejects latitude below -90", () => {
    expect(parse("lat=-91&lng=0").lat).toBeUndefined();
  });

  it("rejects longitude above 180", () => {
    expect(parse("lat=0&lng=181").lng).toBeUndefined();
  });

  it("rejects longitude below -180", () => {
    expect(parse("lat=0&lng=-181").lng).toBeUndefined();
  });

  it("accepts boundary coordinates", () => {
    const p = parse("lat=90&lng=180");
    expect(p.lat).toBe(90);
    expect(p.lng).toBe(180);
  });

  it("drops lat/lng entirely when only one is present", () => {
    expect(parse("lat=51.5").lat).toBeUndefined();
    expect(parse("lng=-1.3").lng).toBeUndefined();
  });

  it("ignores non-numeric lat/lng", () => {
    expect(parse("lat=abc&lng=xyz").lat).toBeUndefined();
  });

  it("clamps radius below the 500m floor", () => {
    expect(parse("radius=10").radiusMeters).toBe(500);
  });

  it("clamps radius above the 80km ceiling", () => {
    expect(parse("radius=999999").radiusMeters).toBe(80_000);
  });

  it("defaults radius to 16000m when absent", () => {
    expect(parse("").radiusMeters).toBe(16_000);
  });

  it("caps category slugs at 5", () => {
    const p = parse("cat=a&cat=b&cat=c&cat=d&cat=e&cat=f&cat=g");
    expect(p.categorySlugs).toHaveLength(5);
  });

  it("filters out empty category slugs", () => {
    expect(parse("cat=&cat=plumbers").categorySlugs).toEqual(["plumbers"]);
  });

  it("rejects an unknown sort value", () => {
    expect(parse("sort=popularity_bogus").sort).toBeUndefined();
  });

  it("accepts every known sort value", () => {
    for (const s of ["relevance", "distance", "rating", "newest"]) {
      expect(parse(`sort=${s}`).sort).toBe(s);
    }
  });

  it("caps limit at 50 even when a larger value is requested", () => {
    expect(parse("limit=500").limit).toBe(50);
  });

  it("defaults limit to 20", () => {
    expect(parse("").limit).toBe(20);
  });

  it("parses boolean attribute values from the true/false literals", () => {
    const p = parse("attr_offers_delivery=true&attr_wheelchair_access=false");
    expect(p.attributes).toEqual({ offers_delivery: true, wheelchair_access: false });
  });

  it("treats non-boolean attribute values as strings", () => {
    expect(parse("attr_price_band=%C2%A3%C2%A3%C2%A3").attributes).toEqual({ price_band: "£££" });
  });

  it("returns undefined attributes when none are present", () => {
    expect(parse("q=cafe").attributes).toBeUndefined();
  });

  it("treats open/verified/offers as booleans keyed on the literal '1'", () => {
    expect(parse("open=1").openNow).toBe(true);
    expect(parse("open=0").openNow).toBe(false);
    expect(parse("").openNow).toBe(false);
  });

  it("passes a malformed cursor through untouched — search.ts is responsible for rejecting it", () => {
    expect(parse("cursor=not-valid-base64!!").cursor).toBe("not-valid-base64!!");
  });
});

describe("shouldIndex", () => {
  it("indexes a bare category/location browse with no filters", () => {
    expect(shouldIndex(parse(""))).toBe(true);
    expect(shouldIndex(parse("cat=plumbers"))).toBe(true);
  });

  it("does not index a keyword search", () => {
    expect(shouldIndex(parse("q=plumber"))).toBe(false);
  });

  it("does not index filtered permutations (open, offers, verified, rating, multi-category, cursor)", () => {
    expect(shouldIndex(parse("open=1"))).toBe(false);
    expect(shouldIndex(parse("offers=1"))).toBe(false);
    expect(shouldIndex(parse("verified=1"))).toBe(false);
    expect(shouldIndex(parse("rating=4"))).toBe(false);
    expect(shouldIndex(parse("cat=a&cat=b"))).toBe(false);
    expect(shouldIndex(parse("cursor=abc"))).toBe(false);
  });
});
