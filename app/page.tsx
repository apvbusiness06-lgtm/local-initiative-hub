import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { resolveTenant } from "@/lib/tenant";
import { searchListings } from "@/lib/search";
import { getTenantCategories } from "@/lib/categories";
import { getActiveOffersForTenant, formatDiscount } from "@/lib/offers";
import { getUpcomingEventsForTenant } from "@/lib/events";
import { getPublishedContent } from "@/lib/content";
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

// Search and category browse are the only two things Slice 4 shipped;
// events/offers/blog below are real, DB-backed sections (their own read
// layers — lib/offers.ts, lib/events.ts, lib/content.ts), not the reference
// design's full Slice 10/13 scope (no claim/QR redemption, no RSVP, no
// editor). Each links to a real destination: the offer/event's business
// listing, or the blog post itself — never a page that doesn't exist yet.
export default async function HomePage() {
  const host = (await headers()).get("host") ?? "";
  const tenant = await resolveTenant(host);
  if (!tenant) notFound();

  const [currentUser, categories, recent, offers, events, posts] = await Promise.all([
    getCurrentUser(),
    getTenantCategories(tenant, 8),
    searchListings({ tenantId: tenant.id, sort: "newest", limit: 3 }),
    getActiveOffersForTenant(tenant.id, 3),
    getUpcomingEventsForTenant(tenant.id, 3),
    getPublishedContent(3),
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

      {/* ── Deals & offers ────────────────────────────────────── */}
      {offers.length > 0 && (
        <section className="mx-auto max-w-6xl px-5 py-14">
          <h2 className="font-heading text-2xl font-semibold tracking-tight">Deals & offers</h2>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {offers.map((o) => (
              <a
                key={o.id}
                href={`/offers/${o.slug}`}
                className="rounded-xl border border-black/[0.07] bg-white p-5 shadow-[0_1px_2px_rgba(48,43,39,0.04)] transition hover:shadow-[0_4px_16px_rgba(48,43,39,0.08)]"
              >
                <span
                  className="inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white"
                  style={{ backgroundColor: "var(--primary)" }}
                >
                  {formatDiscount(o)}
                </span>
                <h3 className="mt-2 text-sm font-semibold">{o.title}</h3>
                <p className="mt-1 text-xs opacity-60">{o.businessName}</p>
              </a>
            ))}
          </div>
        </section>
      )}

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

      {/* ── Upcoming events ───────────────────────────────────── */}
      {events.length > 0 && (
        <section className="mx-auto max-w-6xl px-5 pb-16">
          <h2 className="font-heading text-2xl font-semibold tracking-tight">What&apos;s on</h2>
          <ul className="mt-6 space-y-3">
            {events.map((e) => (
              <li key={e.id}>
                <a
                  href={`/events/${e.slug}`}
                  className="flex flex-col gap-1 rounded-xl border border-black/[0.07] bg-white p-4 shadow-[0_1px_2px_rgba(48,43,39,0.04)] transition hover:shadow-[0_4px_16px_rgba(48,43,39,0.08)] sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <h3 className="text-sm font-semibold">{e.title}</h3>
                    <p className="mt-0.5 text-xs opacity-60">
                      {e.venueName}
                      {e.businessName ? ` · ${e.businessName}` : ""}
                    </p>
                  </div>
                  <p className="text-xs font-medium opacity-70">
                    {e.startsAt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} ·{" "}
                    {e.startsAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Community & guides ────────────────────────────────── */}
      {posts.length > 0 && (
        <section className="mx-auto max-w-6xl px-5 pb-16">
          <div className="flex items-center justify-between">
            <h2 className="font-heading text-2xl font-semibold tracking-tight">Community & guides</h2>
            <Link href="/blog" className="text-sm font-medium underline" style={{ color: "var(--primary)" }}>
              See all
            </Link>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {posts.map((p) => (
              <a
                key={p.slug}
                href={`/blog/${p.slug}`}
                className="rounded-xl border border-black/[0.07] bg-white p-5 shadow-[0_1px_2px_rgba(48,43,39,0.04)] transition hover:shadow-[0_4px_16px_rgba(48,43,39,0.08)]"
              >
                <h3 className="text-sm font-semibold">{p.title}</h3>
                {p.excerpt && <p className="mt-1.5 text-xs opacity-70">{p.excerpt}</p>}
              </a>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
