// Structured data for a single listing page. One builder for every listing —
// free or premium — because the entitlement layer decides what content
// exists, not this module. Never fabricates a rating: aggregateRating is
// omitted entirely unless there's at least one approved review.

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface JsonLdBusinessInput {
  name: string;
  description: string | null;
  url: string;
  telephone: string | null;
  email: string | null;
  websiteUrl: string | null;
  image: string | null;
  schemaType: string;
  address: {
    streetAddress: string | null;
    addressLocality: string | null;
    addressRegion: string | null;
    postalCode: string | null;
  } | null;
  geo: { latitude: number; longitude: number } | null;
  openingHours: { dayOfWeek: number; opensAt: string; closesAt: string; isClosed: boolean }[];
  aggregateRating: { ratingValue: number; reviewCount: number } | null;
}

export function buildLocalBusinessJsonLd(input: JsonLdBusinessInput): Record<string, unknown> {
  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": input.schemaType || "LocalBusiness",
    name: input.name,
    url: input.url,
  };

  if (input.description) jsonLd.description = input.description;
  if (input.image) jsonLd.image = input.image;
  if (input.telephone) jsonLd.telephone = input.telephone;
  if (input.email) jsonLd.email = input.email;
  if (input.websiteUrl) jsonLd.sameAs = [input.websiteUrl];

  if (input.address) {
    const a = input.address;
    jsonLd.address = {
      "@type": "PostalAddress",
      ...(a.streetAddress ? { streetAddress: a.streetAddress } : {}),
      ...(a.addressLocality ? { addressLocality: a.addressLocality } : {}),
      ...(a.addressRegion ? { addressRegion: a.addressRegion } : {}),
      ...(a.postalCode ? { postalCode: a.postalCode } : {}),
      addressCountry: "GB",
    };
  }

  if (input.geo) {
    jsonLd.geo = {
      "@type": "GeoCoordinates",
      latitude: input.geo.latitude,
      longitude: input.geo.longitude,
    };
  }

  const openDays = input.openingHours.filter((h) => !h.isClosed);
  if (openDays.length) {
    jsonLd.openingHoursSpecification = openDays.map((h) => ({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: `https://schema.org/${DAY_NAMES[h.dayOfWeek]}`,
      opens: h.opensAt,
      closes: h.closesAt,
    }));
  }

  if (input.aggregateRating && input.aggregateRating.reviewCount > 0) {
    jsonLd.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: Number(input.aggregateRating.ratingValue.toFixed(1)),
      reviewCount: input.aggregateRating.reviewCount,
      bestRating: 5,
      worstRating: 1,
    };
  }

  return jsonLd;
}
