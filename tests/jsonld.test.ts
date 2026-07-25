// Slice 5: JSON-LD must use the category's schema.org type and must NOT
// fabricate a rating — aggregateRating is emitted only when approved reviews
// exist. Pure function, no DB.
import { describe, expect, it } from "vitest";
import { buildLocalBusinessJsonLd, type JsonLdBusinessInput } from "@/lib/jsonld";

function baseInput(overrides: Partial<JsonLdBusinessInput> = {}): JsonLdBusinessInput {
  return {
    name: "Winchester Warm Plumbing",
    description: "Family-run plumbing and heating.",
    url: "https://hampshire.example/listing/winchester-warm-plumbing",
    telephone: "01962 000000",
    email: "hello@example.com",
    websiteUrl: "https://example.com",
    image: "https://example.com/cover.jpg",
    schemaType: "Plumber",
    address: {
      streetAddress: "12 Jewry Street",
      addressLocality: "Winchester",
      addressRegion: null,
      postalCode: "SO23 9BH",
    },
    geo: { latitude: 51.0632, longitude: -1.308 },
    openingHours: [
      { dayOfWeek: 1, opensAt: "09:00", closesAt: "17:30", isClosed: false },
      { dayOfWeek: 0, opensAt: "00:00", closesAt: "00:00", isClosed: true },
    ],
    aggregateRating: null,
    ...overrides,
  };
}

describe("buildLocalBusinessJsonLd", () => {
  it("uses the category's schema.org @type", () => {
    const ld = buildLocalBusinessJsonLd(baseInput());
    expect(ld["@type"]).toBe("Plumber");
    expect(ld["@context"]).toBe("https://schema.org");
  });

  it("omits aggregateRating entirely when there are no reviews", () => {
    const ld = buildLocalBusinessJsonLd(baseInput({ aggregateRating: null }));
    expect(ld.aggregateRating).toBeUndefined();
  });

  it("omits aggregateRating when review count is zero", () => {
    const ld = buildLocalBusinessJsonLd(baseInput({ aggregateRating: { ratingValue: 0, reviewCount: 0 } }));
    expect(ld.aggregateRating).toBeUndefined();
  });

  it("emits aggregateRating when approved reviews exist", () => {
    const ld = buildLocalBusinessJsonLd(baseInput({ aggregateRating: { ratingValue: 4.5, reviewCount: 2 } }));
    expect(ld.aggregateRating).toMatchObject({
      "@type": "AggregateRating",
      ratingValue: 4.5,
      reviewCount: 2,
    });
  });

  it("only lists open days in openingHoursSpecification", () => {
    const ld = buildLocalBusinessJsonLd(baseInput());
    const spec = ld.openingHoursSpecification as { dayOfWeek: string }[];
    expect(spec).toHaveLength(1);
    expect(spec[0]?.dayOfWeek).toBe("https://schema.org/Monday");
  });

  it("falls back to LocalBusiness when schemaType is empty", () => {
    const ld = buildLocalBusinessJsonLd(baseInput({ schemaType: "" }));
    expect(ld["@type"]).toBe("LocalBusiness");
  });

  it("omits geo and address when absent", () => {
    const ld = buildLocalBusinessJsonLd(baseInput({ geo: null, address: null }));
    expect(ld.geo).toBeUndefined();
    expect(ld.address).toBeUndefined();
  });
});
