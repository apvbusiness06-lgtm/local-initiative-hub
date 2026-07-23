import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { resolveTenant } from "@/lib/tenant";

export async function generateMetadata(): Promise<Metadata> {
  const host = (await headers()).get("host") ?? "";
  const tenant = await resolveTenant(host);
  if (!tenant) return {};
  return {
    title: tenant.name,
    description: `Find trusted local businesses across ${tenant.name}.`,
  };
}

// Deliberately minimal: only two things a visitor can do here actually work
// end to end (search, browse). Everything else in the reference hero design
// (events, offers, spotlight) waits until those slices exist — a CTA to a
// page that doesn't work yet is worse than no CTA.
export default async function HomePage() {
  const host = (await headers()).get("host") ?? "";
  const tenant = await resolveTenant(host);
  if (!tenant) notFound();

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
      <div className="mx-auto max-w-3xl px-5 py-20 text-center">
        <p className="text-xs uppercase tracking-[0.18em] opacity-60">
          {tenant.name}
        </p>
        <h1
          className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl"
          style={{ fontFamily: tenant.branding.fontHeading }}
        >
          Find trusted local businesses near you
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-base opacity-70">
          Search {tenant.name} for the trades, services and independents
          people in your area recommend.
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
          <a
            href="/businesses"
            className="text-sm font-medium underline underline-offset-4"
            style={{ color: "var(--primary)" }}
          >
            Browse all businesses
          </a>
        </p>
      </div>
    </main>
  );
}
