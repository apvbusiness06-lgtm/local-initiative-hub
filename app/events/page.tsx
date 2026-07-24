import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { resolveTenant } from "@/lib/tenant";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getUpcomingEventsForTenant } from "@/lib/events";
import { Header } from "@/components/Header";

export async function generateMetadata(): Promise<Metadata> {
  const host = (await headers()).get("host") ?? "";
  const tenant = await resolveTenant(host);
  return tenant ? { title: `What's on — ${tenant.name}` } : {};
}

export default async function EventsPage() {
  const host = (await headers()).get("host") ?? "";
  const [tenant, user] = await Promise.all([resolveTenant(host), getCurrentUser()]);
  if (!tenant) notFound();

  const events = await getUpcomingEventsForTenant(tenant.id, 30);

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
      <div className="mx-auto max-w-3xl px-5 py-10">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">What&apos;s on</h1>
        <p className="mt-1 text-sm opacity-70">Upcoming events across {tenant.name}.</p>

        {events.length > 0 ? (
          <ul className="mt-8 space-y-3">
            {events.map((e) => (
              <li key={`${e.id}-${e.startsAt.toISOString()}`}>
                <Link
                  href={`/events/${e.slug}`}
                  className="flex flex-col gap-1 rounded-xl border border-black/[0.07] bg-white p-5 shadow-[0_1px_2px_rgba(48,43,39,0.04)] transition hover:shadow-[0_4px_16px_rgba(48,43,39,0.08)] sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <h2 className="font-semibold">{e.title}</h2>
                    <p className="mt-0.5 text-xs opacity-60">
                      {e.venueName}
                      {e.businessName ? ` · ${e.businessName}` : ""}
                    </p>
                  </div>
                  <p className="text-sm font-medium opacity-70">
                    {e.startsAt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} ·{" "}
                    {e.startsAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-8 rounded-xl border border-black/[0.07] bg-white p-8 text-center text-sm opacity-60">
            No upcoming events right now.
          </p>
        )}
      </div>
    </main>
  );
}
