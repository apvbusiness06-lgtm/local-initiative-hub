// app/listing/[slug]/page.tsx — Slice 5. One template for every listing;
// entitlement checks decide which sections render, never a separate
// free/paid copy of the page. SSR for SEO — no client-side data fetch on
// first paint.

import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { resolveTenant, resolveCanonicalHost } from "@/lib/tenant";
import { getListingForTenant, getSimilarBusinesses, type ListingDetail } from "@/lib/listing";
import { entitled, featureLimit } from "@/lib/entitlements";
import { formatDiscount } from "@/lib/offers";
import { isOpenNow, dayLabel, formatHoursRange, sortMondayFirst } from "@/lib/openingHours";
import { buildLocalBusinessJsonLd } from "@/lib/jsonld";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { Header } from "@/components/Header";
import { ListingCard } from "@/components/ListingCard";
import { submitEnquiryAction, submitReportAction, submitEditSuggestionAction, submitReviewAction } from "./actions";

function originFor(host: string): string {
  const proto = process.env.NODE_ENV === "production" ? "https" : "http";
  return `${proto}://${host}`;
}

function formatMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(minor / 100);
}

function directionsUrl(listing: ListingDetail): string | null {
  const loc = listing.location;
  if (!loc) return null;
  if (loc.lat != null && loc.lng != null) {
    return `https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}`;
  }
  const parts = [loc.addressLine1, loc.locality, loc.postcode].filter(Boolean);
  if (!parts.length) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(parts.join(", "))}`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const host = (await headers()).get("host") ?? "";
  const tenant = await resolveTenant(host);
  if (!tenant) return {};

  const listing = await getListingForTenant(tenant.id, slug);
  if (!listing) return {};

  const canonicalHost = listing.isCanonical ? host : (await resolveCanonicalHost("BUSINESS", listing.id)) ?? host;
  const canonicalUrl = `${originFor(canonicalHost)}/listing/${listing.slug}`;

  const title = `${listing.localHeadline ?? listing.tradingName} — ${tenant.name}`;
  const description =
    listing.summary ?? listing.description?.slice(0, 155) ?? `${listing.tradingName} on ${tenant.name}.`;

  return {
    title,
    description,
    robots: { index: true, follow: true },
    alternates: { canonical: canonicalUrl },
    openGraph: {
      title,
      description,
      images: listing.coverUrl ? [listing.coverUrl] : listing.logoUrl ? [listing.logoUrl] : undefined,
    },
  };
}

const REPORT_REASONS: { value: string; label: string }[] = [
  { value: "incorrect_info", label: "Information is incorrect" },
  { value: "closed_down", label: "This business has closed" },
  { value: "inappropriate_content", label: "Inappropriate content" },
  { value: "duplicate_listing", label: "Duplicate listing" },
  { value: "spam", label: "Spam" },
  { value: "other", label: "Other" },
];

export default async function ListingPage({
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

  const listing = await getListingForTenant(tenant.id, slug);
  if (!listing) notFound();

  const sp = await searchParams;
  const flag = (key: string) => (Array.isArray(sp[key]) ? sp[key]?.[0] : sp[key]);

  const [imagesMax, premiumEntitled, similar] = await Promise.all([
    featureLimit(listing.id, "images.max"),
    entitled(listing.id, "featured.placement"),
    getSimilarBusinesses(
      tenant.id,
      listing.categories.filter((c) => c.isPrimary).map((c) => c.slug).concat(listing.categories.map((c) => c.slug)),
      listing.id
    ),
  ]);

  const gallery = listing.gallery.slice(0, imagesMax ?? 0);
  const openNow = listing.openingHours.length ? isOpenNow(listing.openingHours, listing.specialHours, tenant.timezone) : null;
  const primaryCategory = listing.categories.find((c) => c.isPrimary) ?? listing.categories[0];
  const selfUrl = `${originFor(host)}/listing/${listing.slug}`;

  const jsonLd = buildLocalBusinessJsonLd({
    name: listing.tradingName,
    description: listing.description ?? listing.summary,
    url: selfUrl,
    telephone: listing.location?.phone ?? null,
    email: listing.location?.email ?? null,
    websiteUrl: listing.websiteUrl,
    image: listing.coverUrl ?? listing.logoUrl,
    schemaType: primaryCategory?.schemaType ?? "LocalBusiness",
    address: listing.location
      ? {
          streetAddress: listing.location.addressLine1,
          addressLocality: listing.location.locality ?? listing.location.placeName,
          addressRegion: null,
          postalCode: listing.location.postcode,
        }
      : null,
    geo: listing.location?.lat != null && listing.location?.lng != null
      ? { latitude: listing.location.lat, longitude: listing.location.lng }
      : null,
    openingHours: listing.openingHours,
    aggregateRating: listing.reviewCount > 0 ? { ratingValue: listing.avgRating ?? 0, reviewCount: listing.reviewCount } : null,
  });

  const shareText = encodeURIComponent(`${listing.tradingName} on ${tenant.name}`);
  const shareUrl = encodeURIComponent(selfUrl);
  const directions = directionsUrl(listing);

  const cssVars = {
    "--ink": tenant.branding.colorInk,
    "--primary": tenant.branding.colorPrimary,
    "--surface": tenant.branding.colorSurface,
    backgroundColor: "var(--surface)",
    color: "var(--ink)",
  } as React.CSSProperties;

  return (
    <main className="min-h-screen" style={cssVars}>
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <Header tenant={tenant} user={user} />

      <div className="mx-auto max-w-5xl px-5 py-10">
        <a href="/businesses" className="mb-6 inline-block text-sm opacity-70 transition hover:opacity-100">
          ← Back to directory
        </a>

        {/* ── Hero ─────────────────────────────────────────────── */}
        <section className="overflow-hidden rounded-2xl border border-black/[0.07] bg-white shadow-[0_1px_2px_rgba(48,43,39,0.04)]">
          <div className="relative h-48 sm:h-64" style={{ backgroundColor: "var(--ink)" }}>
            {listing.coverUrl && (
              <img src={listing.coverUrl} alt="" className="h-full w-full object-cover" />
            )}
            <div className="absolute right-4 top-4 flex flex-wrap justify-end gap-2">
              {listing.isSponsored && (
                <span className="rounded-full border border-white/30 bg-black/50 px-3 py-1 text-[11px] uppercase tracking-wider text-white">
                  Sponsored
                </span>
              )}
              {listing.isFeatured && (
                <span className="rounded-full border border-white/30 bg-black/50 px-3 py-1 text-[11px] uppercase tracking-wider text-white">
                  Featured
                </span>
              )}
              {premiumEntitled && (
                <span
                  className="rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-white shadow"
                  style={{ backgroundColor: "var(--primary)" }}
                >
                  Premium Partner
                </span>
              )}
            </div>
          </div>

          <div className="p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex items-end gap-4">
                {listing.logoUrl && (
                  <img
                    src={listing.logoUrl}
                    alt=""
                    className="h-20 w-20 shrink-0 rounded-xl border-2 bg-white object-cover shadow-lg"
                    style={{ borderColor: "var(--primary)" }}
                  />
                )}
                <div>
                  <h1 className="font-heading text-3xl font-semibold tracking-tight">
                    {listing.localHeadline ?? listing.tradingName}
                  </h1>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm opacity-75">
                    {listing.reviewCount > 0 && listing.avgRating != null && (
                      <span>
                        {listing.avgRating.toFixed(1)} ★ ({listing.reviewCount}{" "}
                        {listing.reviewCount === 1 ? "review" : "reviews"})
                      </span>
                    )}
                    {primaryCategory && <span>{primaryCategory.name}</span>}
                    {listing.location?.locality && (
                      <span>
                        {listing.location.locality}
                        {listing.location.postcode ? `, ${listing.location.postcode}` : ""}
                      </span>
                    )}
                    {listing.verified && (
                      <span className="font-medium" style={{ color: "var(--primary)" }}>
                        ✓ Verified
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {listing.location?.phone && (
                  <a
                    href={`tel:${listing.location.phone}`}
                    className="rounded-lg px-4 py-2 text-sm font-medium text-white transition"
                    style={{ backgroundColor: "var(--ink)" }}
                  >
                    Call {listing.location.phone}
                  </a>
                )}
                {listing.websiteUrl && (
                  <a
                    href={listing.websiteUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-black/10 px-4 py-2 text-sm font-medium transition hover:bg-black/[0.03]"
                  >
                    Website
                  </a>
                )}
                <a
                  href="#enquiry"
                  className="rounded-lg px-4 py-2 text-sm font-medium text-white transition"
                  style={{ backgroundColor: "var(--primary)" }}
                >
                  Enquire
                </a>
                {listing.claimState !== "CLAIMED" && (
                  <a
                    href={`/claim/${listing.slug}`}
                    className="rounded-lg border border-black/10 px-4 py-2 text-sm font-medium transition hover:bg-black/[0.03]"
                  >
                    Claim this listing
                  </a>
                )}
              </div>
            </div>

            {listing.claimState !== "CLAIMED" && (
              <p className="mt-3 text-xs opacity-60">
                Own this business?{" "}
                <a href={`/claim/${listing.slug}`} className="underline" style={{ color: "var(--primary)" }}>
                  Claim your free listing
                </a>{" "}
                to manage details, respond to reviews and post offers.
              </p>
            )}

            {listing.localBlurb && (
              <p className="mt-4 border-t border-black/[0.06] pt-4 text-sm italic opacity-80">{listing.localBlurb}</p>
            )}

            {/* Share row — plain links, no client JS required */}
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-black/[0.06] pt-4 text-xs">
              <span className="opacity-60">Share:</span>
              <a
                className="rounded-full border border-black/10 px-3 py-1 transition hover:bg-black/[0.03]"
                href={`https://api.whatsapp.com/send?text=${shareText}%20${shareUrl}`}
                target="_blank"
                rel="noreferrer"
              >
                WhatsApp
              </a>
              <a
                className="rounded-full border border-black/10 px-3 py-1 transition hover:bg-black/[0.03]"
                href={`https://twitter.com/intent/tweet?text=${shareText}&url=${shareUrl}`}
                target="_blank"
                rel="noreferrer"
              >
                X / Twitter
              </a>
              <a
                className="rounded-full border border-black/10 px-3 py-1 transition hover:bg-black/[0.03]"
                href={`https://www.facebook.com/sharer/sharer.php?u=${shareUrl}`}
                target="_blank"
                rel="noreferrer"
              >
                Facebook
              </a>
              <a
                className="rounded-full border border-black/10 px-3 py-1 transition hover:bg-black/[0.03]"
                href={`https://www.linkedin.com/sharing/share-offsite/?url=${shareUrl}`}
                target="_blank"
                rel="noreferrer"
              >
                LinkedIn
              </a>
            </div>
          </div>
        </section>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* ── Left: content ────────────────────────────────── */}
          <div className="space-y-6 lg:col-span-2">
            {(listing.description || listing.summary) && (
              <Card title={`About ${listing.tradingName}`}>
                <p className="whitespace-pre-line text-sm leading-relaxed opacity-80">
                  {listing.description ?? listing.summary}
                </p>
                {listing.categories.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {listing.categories.map((c) => (
                      <span key={c.slug} className="rounded-full border border-black/10 px-3 py-1 text-xs">
                        {c.name}
                      </span>
                    ))}
                  </div>
                )}
              </Card>
            )}

            {gallery.length > 0 && (
              <Card title="Gallery">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {gallery.map((m) => (
                    <img
                      key={m.id}
                      src={m.url}
                      alt={m.altText ?? ""}
                      className="h-32 w-full rounded-lg border border-black/[0.07] object-cover"
                    />
                  ))}
                </div>
              </Card>
            )}

            {listing.services.length > 0 && (
              <Card title="Services">
                <ul className="space-y-3">
                  {listing.services.map((s) => (
                    <li key={s.id} className="flex items-start justify-between gap-4 border-b border-black/[0.06] pb-3 last:border-0 last:pb-0">
                      <div>
                        <p className="text-sm font-medium">{s.name}</p>
                        {s.description && <p className="mt-0.5 text-sm opacity-70">{s.description}</p>}
                      </div>
                      {s.priceMinor != null && (
                        <span className="shrink-0 text-sm font-medium">
                          {s.isFromPrice ? "From " : ""}
                          {formatMoney(s.priceMinor, s.currency)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {listing.activeOffers.length > 0 && (
              <Card title="Current offers">
                <ul className="space-y-3">
                  {listing.activeOffers.map((o) => (
                    <li key={o.id} className="rounded-lg border border-black/[0.07] p-3">
                      <div className="flex items-center gap-2">
                        <span
                          className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white"
                          style={{ backgroundColor: "var(--primary)" }}
                        >
                          {formatDiscount(o)}
                        </span>
                        <span className="text-xs opacity-60">
                          Ends {o.endsAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                        </span>
                      </div>
                      <p className="mt-1.5 text-sm font-medium">{o.title}</p>
                      {o.description && <p className="mt-0.5 text-sm opacity-70">{o.description}</p>}
                      {o.terms && <p className="mt-1 text-xs opacity-50">{o.terms}</p>}
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            <Card title="Reviews">
              {listing.reviews.length > 0 ? (
                <ul className="space-y-4">
                  {listing.reviews.map((r) => (
                    <li key={r.id} className="border-b border-black/[0.06] pb-4 last:border-0 last:pb-0">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">{r.authorName ?? "Anonymous"}</span>
                        <span className="opacity-70">
                          {"★".repeat(Math.round(r.rating))}
                          {"☆".repeat(Math.max(0, r.ratingScaleMax - Math.round(r.rating)))}
                        </span>
                      </div>
                      <span className="mt-1 inline-block rounded border border-black/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider opacity-60">
                        {r.provider.replace("_", " ")}
                      </span>
                      {r.title && <p className="mt-1.5 text-sm font-medium">{r.title}</p>}
                      {r.body && <p className="mt-1 text-sm opacity-75">{r.body}</p>}
                      {r.responseBody && (
                        <div className="mt-2 rounded-lg bg-black/[0.03] p-3 text-xs">
                          <span className="font-medium">Response from the owner: </span>
                          {r.responseBody}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm opacity-60">No reviews yet — be the first.</p>
              )}

              {/* First-party submission. Login-gated; goes to moderation.
                  No gating: everyone who used the business may review. */}
              <div id="reviews" className="mt-5 border-t border-black/[0.06] pt-5">
                {flag("review") === "pending" ? (
                  <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
                    Thanks — your review has been submitted and will appear once approved.
                  </p>
                ) : user ? (
                  <form action={submitReviewAction.bind(null, listing.id, listing.slug)} className="space-y-2.5 text-sm">
                    <p className="font-medium">Write a review</p>
                    {flag("review") === "error" && (
                      <p className="rounded-lg bg-red-50 p-2 text-xs text-red-700">
                        {flag("reviewError") ?? "Could not submit your review."}
                      </p>
                    )}
                    <label className="block">
                      <span className="mb-1 block text-xs opacity-70">Rating</span>
                      <select name="rating" defaultValue="5" className="rounded-lg border border-black/10 px-2 py-1.5 text-sm">
                        {[5, 4, 3, 2, 1].map((n) => (
                          <option key={n} value={n}>
                            {n} star{n === 1 ? "" : "s"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <input name="authorName" placeholder="Your name (optional)" className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm" />
                    <input name="title" placeholder="Title (optional)" className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm" />
                    <textarea name="body" rows={3} placeholder="Tell others about your experience" className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm" />
                    <button type="submit" className="rounded-lg px-4 py-2 text-sm font-medium text-white" style={{ backgroundColor: "var(--primary)" }}>
                      Submit review
                    </button>
                  </form>
                ) : (
                  <p className="text-sm opacity-70">
                    <a href={`/login?next=${encodeURIComponent(`/listing/${listing.slug}`)}`} className="underline" style={{ color: "var(--primary)" }}>
                      Log in
                    </a>{" "}
                    to write a review.
                  </p>
                )}
              </div>
            </Card>
          </div>

          {/* ── Right: sidebar ───────────────────────────────── */}
          <div className="space-y-6">
            <Card title="Opening hours">
              {listing.openingHours.length > 0 ? (
                <>
                  {openNow != null && (
                    <p className="mb-3 text-sm font-medium" style={{ color: openNow ? "#2e7d32" : "#b3261e" }}>
                      {openNow ? "Open now" : "Closed now"}
                    </p>
                  )}
                  <ul className="space-y-1 text-sm">
                    {sortMondayFirst(listing.openingHours).map((h) => (
                      <li key={h.dayOfWeek} className="flex justify-between">
                        <span className="opacity-70">{dayLabel(h.dayOfWeek)}</span>
                        <span>{formatHoursRange(h)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-sm opacity-60">Hours not listed.</p>
              )}
            </Card>

            {listing.location && (
              <Card title="Location">
                <address className="text-sm not-italic opacity-80">
                  {listing.location.addressLine1 && <>{listing.location.addressLine1}<br /></>}
                  {listing.location.addressLine2 && <>{listing.location.addressLine2}<br /></>}
                  {listing.location.locality}
                  {listing.location.postcode ? `, ${listing.location.postcode}` : ""}
                </address>
                {listing.location.offersDelivery && (
                  <p className="mt-2 text-xs opacity-60">Offers delivery</p>
                )}
                {listing.location.isRemoteOnly && <p className="mt-2 text-xs opacity-60">Remote / online only</p>}
                {directions && (
                  <a
                    href={directions}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-block text-sm font-medium"
                    style={{ color: "var(--primary)" }}
                  >
                    Get directions →
                  </a>
                )}
              </Card>
            )}

            <Card title="Send an enquiry">
              {flag("enquiry") === "sent" ? (
                <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
                  Thanks — your message has been sent to {listing.tradingName}.
                </p>
              ) : (
                <form
                  id="enquiry"
                  action={submitEnquiryAction.bind(null, listing.id, tenant.id, listing.slug)}
                  className="space-y-2.5 text-sm"
                >
                  {flag("enquiry") === "error" && (
                    <p className="rounded-lg bg-red-50 p-2 text-xs text-red-700">
                      Please fill in your name, a valid email, and a message.
                    </p>
                  )}
                  <input
                    name="name"
                    required
                    placeholder="Your name"
                    className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
                  />
                  <input
                    name="email"
                    type="email"
                    required
                    placeholder="Your email"
                    className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
                  />
                  <input
                    name="phone"
                    placeholder="Phone (optional)"
                    className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
                  />
                  <select
                    name="kind"
                    defaultValue="MESSAGE"
                    className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
                  >
                    <option value="MESSAGE">General enquiry</option>
                    <option value="QUOTE_REQUEST">Quote request</option>
                  </select>
                  <textarea
                    name="message"
                    required
                    rows={4}
                    placeholder="Your message"
                    className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
                  />
                  <button
                    type="submit"
                    className="w-full rounded-lg py-2.5 text-sm font-medium text-white transition"
                    style={{ backgroundColor: "var(--ink)" }}
                  >
                    Send enquiry
                  </button>
                </form>
              )}
            </Card>
          </div>
        </div>

        {similar.length > 0 && (
          <section className="mt-10">
            <h2 className="font-heading mb-4 text-xl font-semibold">Similar businesses</h2>
            <ul className="space-y-3">
              {similar.map((hit) => (
                <li key={hit.id}>
                  <ListingCard hit={hit} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── Report / suggest an edit ─────────────────────────── */}
        <section className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Card title="Report this listing">
            {flag("report") === "sent" ? (
              <p className="text-sm opacity-70">Thanks — our team will review your report.</p>
            ) : (
              <form action={submitReportAction.bind(null, listing.id, listing.slug)} className="space-y-2 text-sm">
                {flag("report") === "error" && (
                  <p className="rounded-lg bg-red-50 p-2 text-xs text-red-700">Please enter a valid email or leave it blank.</p>
                )}
                <select
                  name="reason"
                  className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
                  defaultValue="incorrect_info"
                >
                  {REPORT_REASONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <textarea
                  name="detail"
                  rows={2}
                  placeholder="Details (optional)"
                  className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
                />
                {!user && (
                  <input
                    name="email"
                    type="email"
                    placeholder="Your email (optional)"
                    className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
                  />
                )}
                <button type="submit" className="rounded-lg border border-black/10 px-4 py-2 text-sm font-medium transition hover:bg-black/[0.03]">
                  Submit report
                </button>
              </form>
            )}
          </Card>

          <Card title="Suggest an edit">
            {flag("edit") === "sent" ? (
              <p className="text-sm opacity-70">Thanks — we&apos;ll review your suggestion.</p>
            ) : (
              <form action={submitEditSuggestionAction.bind(null, listing.id, listing.slug)} className="space-y-2 text-sm">
                {flag("edit") === "error" && (
                  <p className="rounded-lg bg-red-50 p-2 text-xs text-red-700">Please describe the change and enter a valid email if provided.</p>
                )}
                <textarea
                  name="detail"
                  required
                  rows={3}
                  placeholder="What should change?"
                  className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
                />
                {!user && (
                  <input
                    name="email"
                    type="email"
                    placeholder="Your email (optional)"
                    className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
                  />
                )}
                <button type="submit" className="rounded-lg border border-black/10 px-4 py-2 text-sm font-medium transition hover:bg-black/[0.03]">
                  Submit suggestion
                </button>
              </form>
            )}
          </Card>
        </section>
      </div>
    </main>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-black/[0.07] bg-white p-5 shadow-[0_1px_2px_rgba(48,43,39,0.04)]">
      <h2 className="font-heading mb-3 text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}
