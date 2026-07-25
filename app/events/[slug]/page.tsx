import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { resolveTenant } from "@/lib/tenant";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getEventForTenant, getUpcomingOccurrences } from "@/lib/events";
import { Header } from "@/components/Header";
import { rsvpAction } from "./actions";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const host = (await headers()).get("host") ?? "";
  const tenant = await resolveTenant(host);
  if (!tenant) return {};
  const event = await getEventForTenant(tenant.id, slug);
  return event ? { title: `${event.title} — ${tenant.name}`, description: event.description ?? undefined } : {};
}

export default async function EventPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const host = (await headers()).get("host") ?? "";
  const [tenant, user] = await Promise.all([resolveTenant(host), getCurrentUser()]);
  if (!tenant) notFound();

  const event = await getEventForTenant(tenant.id, slug);
  if (!event) notFound();

  const [occurrences, sp] = await Promise.all([getUpcomingOccurrences(event.id, 8), searchParams]);
  const flag = (k: string) => (Array.isArray(sp[k]) ? sp[k]?.[0] : sp[k]);
  const next = occurrences[0];

  const proto = process.env.NODE_ENV === "production" ? "https" : "http";
  const jsonLd: Record<string, unknown> | null = next
    ? {
        "@context": "https://schema.org",
        "@type": "Event",
        name: event.title,
        ...(event.description ? { description: event.description } : {}),
        startDate: next.startsAt.toISOString(),
        endDate: next.endsAt.toISOString(),
        eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
        eventStatus: "https://schema.org/EventScheduled",
        ...(event.venueName
          ? {
              location: {
                "@type": "Place",
                name: event.venueName,
                address: [event.addressLine1, event.postcode].filter(Boolean).join(", ") || event.venueName,
              },
            }
          : {}),
        ...(event.bookingUrl ? { url: event.bookingUrl } : { url: `${proto}://${host}/events/${event.slug}` }),
      }
    : null;

  const cssVars = {
    "--ink": tenant.branding.colorInk,
    "--primary": tenant.branding.colorPrimary,
    "--surface": tenant.branding.colorSurface,
    backgroundColor: "var(--surface)",
    color: "var(--ink)",
  } as React.CSSProperties;

  const fmtWhen = (d: Date) =>
    d.toLocaleString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: event.timezone,
    });

  return (
    <main className="min-h-screen" style={cssVars}>
      {jsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />}
      <Header tenant={tenant} user={user} />
      <div className="mx-auto max-w-2xl px-5 py-10">
        <Link href="/events" className="text-sm opacity-70 hover:opacity-100">← What&apos;s on</Link>
        <h1 className="font-heading mt-2 text-3xl font-semibold tracking-tight">{event.title}</h1>
        {event.businessName && (
          <p className="mt-1 text-sm opacity-70">
            by{" "}
            <a href={`/listing/${event.businessSlug}`} className="underline" style={{ color: "var(--primary)" }}>
              {event.businessName}
            </a>
          </p>
        )}

        {flag("rsvp") && <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">You&apos;re on the list — see you there!</p>}
        {flag("error") && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{flag("error")}</p>}

        {event.description && <p className="mt-4 whitespace-pre-line text-sm leading-relaxed opacity-80">{event.description}</p>}

        <dl className="mt-6 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          {event.venueName && (
            <div>
              <dt className="opacity-60">Venue</dt>
              <dd>
                {event.venueName}
                {event.addressLine1 ? `, ${event.addressLine1}` : ""}
                {event.postcode ? `, ${event.postcode}` : ""}
              </dd>
            </div>
          )}
          <div>
            <dt className="opacity-60">Price</dt>
            <dd>{event.priceMinor != null && event.priceMinor > 0 ? new Intl.NumberFormat("en-GB", { style: "currency", currency: event.currency }).format(event.priceMinor / 100) : "Free"}</dd>
          </div>
          {event.isAccessible && (
            <div>
              <dt className="opacity-60">Accessibility</dt>
              <dd>Wheelchair accessible</dd>
            </div>
          )}
        </dl>

        <section className="mt-8">
          <h2 className="font-heading text-lg font-semibold">Upcoming dates</h2>
          {occurrences.length > 0 ? (
            <ul className="mt-3 space-y-3">
              {occurrences.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-black/[0.07] bg-white p-4">
                  <div>
                    <p className="text-sm font-medium">{fmtWhen(o.startsAt)}</p>
                    <p className="text-xs opacity-60">{o.rsvpCount} going</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <a
                      href={`/events/${event.slug}/calendar?occ=${o.id}`}
                      className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-medium transition hover:bg-black/[0.03]"
                    >
                      Add to calendar
                    </a>
                    {event.bookingUrl ? (
                      <a
                        href={event.bookingUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-lg px-3 py-1.5 text-xs font-medium text-white"
                        style={{ backgroundColor: "var(--primary)" }}
                      >
                        Book
                      </a>
                    ) : user ? (
                      <form action={rsvpAction.bind(null, event.slug, o.id)}>
                        <button className="rounded-lg px-3 py-1.5 text-xs font-medium text-white" style={{ backgroundColor: "var(--primary)" }}>
                          RSVP
                        </button>
                      </form>
                    ) : (
                      <a
                        href={`/login?next=${encodeURIComponent(`/events/${event.slug}`)}`}
                        className="rounded-lg px-3 py-1.5 text-xs font-medium text-white"
                        style={{ backgroundColor: "var(--primary)" }}
                      >
                        Log in to RSVP
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm opacity-60">No upcoming dates scheduled.</p>
          )}
        </section>
      </div>
    </main>
  );
}
