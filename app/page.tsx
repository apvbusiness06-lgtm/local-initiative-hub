import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { resolveTenant } from "@/lib/tenant";
import { searchListings } from "@/lib/search";
import { getTenantCategories } from "@/lib/categories";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { Header } from "@/components/Header";
import { ListingCard } from "@/components/ListingCard";

export async function generateMetadata(): Promise<Metadata> {
  const host = (await headers()).get("host") ?? "";
  const tenant = await resolveTenant(host);
  if (!tenant) return {};
  return {
    title: tenant.name,
    description: `Find trusted local businesses across ${tenant.name}.`,
  };
}

// Only two things a visitor can do here work end to end (search, browse
// by category) — everything else in the reference hero design (events,
// offers, spotlight) waits until those slices exist. A CTA to a page that
// doesn't work yet is worse than no CTA.
export default async function HomePage() {
  const host = (await headers()).get("host") ?? "";
  const tenant = await resolveTenant(host);
  if (!tenant) notFound();

  const [currentUser, categories, recent] = await Promise.all([
    getCurrentUser(),
    getTenantCategories(tenant, 8),
    searchListings({ tenantId: tenant.id, sort: "newest", limit: 3 }),
  ]);

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
      <Header tenant={tenant} user={currentUser} />

      {/* ── Hero ──────────────────────────────────────────────── */}
      <section className="hero-texture border-b border-black/[0.06]">
        <div className="mx-auto max-w-3xl px-5 py-20 text-center">
          {tenant.branding.positioningBadge && (
            <span
              className="inline-block rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-wide"
              style={{ borderColor: "var(--primary)", color: "var(--primary)" }}
            >
              {tenant.branding.positioningBadge}
            </span>
          )}
          <h1 className="font-heading mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
            Find trusted local businesses near you
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base opacity-70">
            Search {tenant.name} for the trades, services and independents people in
            your area recommend.
          </p>

          <form
            action="/businesses"
            method="get"
            className="mx-auto mt-8 flex max-w-xl flex-col gap-2 rounded-xl border border-black/[0.07] bg-white p-2 shadow-sm sm:flex-row"
          >
            <label htmlFor="q" className="sr-only">
              Service or business name
            </label>
            <input
              id="q"
              name="q"
              type="text"
              placeholder="What are you looking for?"
              className="w-full flex-1 rounded-lg border-0 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
            />
            <button
              type="submit"
              className="shrink-0 rounded-lg px-6 py-3 text-sm font-medium text-white transition"
              style={{ backgroundColor: "var(--primary)" }}
            >
              Find Local Businesses
            </button>
          </form>

          <p className="mt-6">
            <a href="/businesses" className="text-sm font-medium underline underline-offset-4" style={{ color: "var(--primary)" }}>
              Browse all businesses
            </a>
          </p>
        </div>
      </section>

      {/* ── Category grid ────────────────────────────────────── */}
      {categories.length > 0 && (
        <section className="mx-auto max-w-6xl px-5 py-14">
          <h2 className="font-heading text-2xl font-semibold tracking-tight">Browse by category</h2>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {categories.map((c) => (
              <a
                key={c.slug}
                href={`/businesses?cat=${c.slug}`}
                className="rounded-xl border border-black/[0.07] bg-white p-4 text-sm font-medium transition hover:shadow-[0_4px_16px_rgba(48,43,39,0.08)]"
              >
                {c.name}
              </a>
            ))}
          </div>
        </section>
      )}

      {/* ── Recently added ───────────────────────────────────── */}
      {recent.hits.length > 0 && (
        <section className="mx-auto max-w-6xl px-5 pb-16">
          <div className="flex items-center justify-between">
            <h2 className="font-heading text-2xl font-semibold tracking-tight">Recently added</h2>
            <a href="/businesses?sort=newest" className="text-sm font-medium underline" style={{ color: "var(--primary)" }}>
              See all
            </a>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recent.hits.map((hit) => (
              <ListingCard key={hit.id} hit={hit} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
