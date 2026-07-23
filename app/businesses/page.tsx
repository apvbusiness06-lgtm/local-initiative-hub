// app/businesses/page.tsx — server component.
// Tenant-branded, URL-driven, SSR for SEO. No client-side data fetch on
// first paint: the results are in the HTML.

import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { resolveTenant } from "@/lib/tenant";
import { searchListings, suggestNearby, type SearchHit } from "@/lib/search";
import { parseSearchParams, buildSearchUrl, shouldIndex } from "@/lib/searchParams";

type SearchParamsRecord = Record<string, string | string[] | undefined>;

function toURLSearchParams(searchParams: SearchParamsRecord): URLSearchParams {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (v == null) continue;
    Array.isArray(v) ? v.forEach((x) => sp.append(k, x)) : sp.set(k, v);
  }
  return sp;
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SearchParamsRecord>;
}): Promise<Metadata> {
  const host = (await headers()).get("host") ?? "";
  const tenant = await resolveTenant(host);
  if (!tenant) return {};

  const sp = toURLSearchParams(await searchParams);
  const params = parseSearchParams(sp, tenant.id);
  const indexable = shouldIndex(params);

  const title = params.q
    ? `${params.q} — ${tenant.name}`
    : `Local businesses — ${tenant.name}`;

  return {
    title,
    description: `Find trusted local businesses across ${tenant.name}.`,
    // Filtered permutations are noindex,follow — crawlable but not indexed,
    // so link equity flows without creating doorway pages.
    robots: indexable ? { index: true, follow: true } : { index: false, follow: true },
    alternates: { canonical: buildSearchUrl(indexable ? params : {}) },
  };
}

export default async function BusinessesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsRecord>;
}) {
  const host = (await headers()).get("host") ?? "";
  const tenant = await resolveTenant(host);
  if (!tenant) notFound();

  const sp = toURLSearchParams(await searchParams);
  const params = parseSearchParams(sp, tenant.id);
  const results = await searchListings(params);
  const nearby = results.hits.length === 0 ? await suggestNearby(params) : [];

  return (
    <main
      className="min-h-screen"
      style={
        {
          "--ink": tenant.branding.colorInk,
          "--primary": tenant.branding.colorPrimary,
          "--surface": tenant.branding.colorSurface,
          backgroundColor: "var(--surface)",
          color: "var(--ink)",
        } as React.CSSProperties
      }
    >
      <div className="mx-auto max-w-6xl px-5 py-10">
        <header className="mb-8">
          <p className="text-xs uppercase tracking-[0.18em] opacity-60">
            {tenant.name}
          </p>
          <h1
            className="mt-2 text-4xl font-semibold tracking-tight"
            style={{ fontFamily: tenant.branding.fontHeading }}
          >
            {params.q ? `Results for "${params.q}"` : "Local businesses"}
          </h1>
          <p className="mt-2 text-sm opacity-70" aria-live="polite">
            {results.totalApprox.toLocaleString("en-GB")}{" "}
            {results.totalApprox === 1 ? "business" : "businesses"} found
          </p>
        </header>

        {results.sponsored.length > 0 && (
          <section aria-label="Sponsored results" className="mb-6 space-y-3">
            {results.sponsored.map((hit) => (
              <ListingCard key={hit.id} hit={hit} sponsored />
            ))}
          </section>
        )}

        {results.hits.length > 0 ? (
          <ol className="space-y-3">
            {results.hits.map((hit) => (
              <li key={hit.id}>
                <ListingCard hit={hit} />
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState query={params.q} nearby={nearby} />
        )}

        {/* Real link, not a JS-only button: works without hydration and
            is crawlable. */}
        {results.nextCursor && (
          <nav className="mt-8 flex justify-center">
            <a
              href={buildSearchUrl({ ...params, cursor: results.nextCursor })}
              rel="next"
              className="rounded-lg border px-6 py-3 text-sm font-medium transition hover:bg-white"
              style={{ borderColor: "var(--primary)", color: "var(--primary)" }}
            >
              Show more businesses
            </a>
          </nav>
        )}
      </div>
    </main>
  );
}

function ListingCard({ hit, sponsored }: { hit: SearchHit; sponsored?: boolean }) {
  const miles = hit.distanceMeters != null ? hit.distanceMeters / 1609.34 : null;

  return (
    <article className="rounded-xl border border-black/[0.07] bg-white p-5 shadow-[0_1px_2px_rgba(48,43,39,0.04)] transition hover:shadow-[0_4px_16px_rgba(48,43,39,0.08)]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">
            <a href={`/listing/${hit.slug}`} className="hover:underline">
              {hit.tradingName}
            </a>
          </h2>
          {hit.summary && (
            <p className="mt-1 line-clamp-2 text-sm opacity-75">{hit.summary}</p>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {sponsored && (
            // Disclosure is required and must not be visually suppressed.
            <span className="rounded border border-black/10 px-2 py-0.5 text-[11px] uppercase tracking-wider opacity-70">
              Sponsored
            </span>
          )}
          {hit.verified && (
            <span
              className="text-[11px] font-medium uppercase tracking-wider"
              style={{ color: "var(--primary)" }}
            >
              ✓ Verified
            </span>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm opacity-70">
        {hit.avgRating != null && hit.reviewCount > 0 && (
          <span>
            {hit.avgRating.toFixed(1)} ★{" "}
            <span className="opacity-70">
              ({hit.reviewCount} {hit.reviewCount === 1 ? "review" : "reviews"})
            </span>
          </span>
        )}
        {miles != null && <span>{miles.toFixed(1)} miles away</span>}
      </div>
    </article>
  );
}

function EmptyState({ query, nearby }: { query?: string; nearby: SearchHit[] }) {
  return (
    <div className="rounded-xl border border-black/[0.07] bg-white p-10 text-center">
      <h2 className="text-lg font-semibold">
        {query ? `No matches for "${query}"` : "No businesses found"}
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm opacity-70">
        Try a different search term, or widen your search area.
      </p>

      {nearby.length > 0 && (
        <div className="mt-8 text-left">
          <h3 className="mb-3 text-sm font-medium uppercase tracking-wider opacity-60">
            Nearby alternatives
          </h3>
          <ul className="space-y-3">
            {nearby.map((hit) => (
              <li key={hit.id}>
                <ListingCard hit={hit} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
