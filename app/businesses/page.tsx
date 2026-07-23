// app/businesses/page.tsx — server component.
// Tenant-branded, URL-driven, SSR for SEO. No client-side data fetch on
// first paint: the results are in the HTML.

import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { resolveTenant } from "@/lib/tenant";
import { searchListings, suggestNearby, type SearchHit, type SortKey } from "@/lib/search";
import { parseSearchParams, buildSearchUrl, shouldIndex } from "@/lib/searchParams";
import { getTenantCategories } from "@/lib/categories";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { Header } from "@/components/Header";
import { ListingCard } from "@/components/ListingCard";

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

const SORTS: { value: SortKey; label: string }[] = [
  { value: "relevance", label: "Most relevant" },
  { value: "distance", label: "Nearest" },
  { value: "rating", label: "Highest rated" },
  { value: "newest", label: "Newest" },
];

export default async function BusinessesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsRecord>;
}) {
  const host = (await headers()).get("host") ?? "";
  const [tenant, user] = await Promise.all([resolveTenant(host), getCurrentUser()]);
  if (!tenant) notFound();

  const sp = toURLSearchParams(await searchParams);
  const params = parseSearchParams(sp, tenant.id);
  const [results, categories] = await Promise.all([
    searchListings(params),
    getTenantCategories(tenant),
  ]);
  const nearby = results.hits.length === 0 ? await suggestNearby(params) : [];
  const selectedCats = new Set(params.categorySlugs ?? []);

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
      <Header tenant={tenant} user={user} />

      <div className="mx-auto max-w-6xl px-5 py-10">
        <header className="mb-8">
          <p className="text-xs uppercase tracking-[0.18em] opacity-60">{tenant.name}</p>
          <h1 className="font-heading mt-2 text-4xl font-semibold tracking-tight">
            {params.q ? `Results for "${params.q}"` : "Local businesses"}
          </h1>
          <p className="mt-2 text-sm opacity-70" aria-live="polite">
            {results.totalApprox.toLocaleString("en-GB")}{" "}
            {results.totalApprox === 1 ? "business" : "businesses"} found
          </p>
        </header>

        <form
          method="get"
          action="/businesses"
          className="mb-8 rounded-xl border border-black/[0.07] bg-white p-4 shadow-[0_1px_2px_rgba(48,43,39,0.04)]"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label htmlFor="q" className="sr-only">
              Keyword
            </label>
            <input
              id="q"
              name="q"
              type="text"
              defaultValue={params.q ?? ""}
              placeholder="Search businesses..."
              className="w-full flex-1 rounded-lg border border-black/10 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/10 sm:max-w-xs"
            />

            <label htmlFor="sort" className="sr-only">
              Sort
            </label>
            <select
              id="sort"
              name="sort"
              defaultValue={params.sort ?? "relevance"}
              className="rounded-lg border border-black/10 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
            >
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>

            <label className="flex items-center gap-2 whitespace-nowrap text-sm">
              <input type="checkbox" name="verified" value="1" defaultChecked={params.verifiedOnly} className="rounded" />
              Verified only
            </label>
            <label className="flex items-center gap-2 whitespace-nowrap text-sm">
              <input type="checkbox" name="open" value="1" defaultChecked={params.openNow} className="rounded" />
              Open now
            </label>

            <button
              type="submit"
              className="shrink-0 rounded-lg px-5 py-2 text-sm font-medium text-white transition"
              style={{ backgroundColor: "var(--primary)" }}
            >
              Apply filters
            </button>
          </div>

          {categories.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-black/[0.06] pt-4">
              {categories.map((c) => (
                <label
                  key={c.slug}
                  className="flex cursor-pointer items-center gap-1.5 rounded-full border border-black/10 px-3 py-1 text-xs transition has-[:checked]:border-[var(--primary)] has-[:checked]:bg-[var(--primary)] has-[:checked]:text-white"
                >
                  <input type="checkbox" name="cat" value={c.slug} defaultChecked={selectedCats.has(c.slug)} className="sr-only" />
                  {c.name}
                </label>
              ))}
            </div>
          )}
        </form>

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
