import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { resolveTenant } from "@/lib/tenant";
import { getListingForTenant } from "@/lib/listing";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { Header } from "@/components/Header";
import { startClaimAction } from "./actions";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const host = (await headers()).get("host") ?? "";
  const tenant = await resolveTenant(host);
  if (!tenant) return {};
  const listing = await getListingForTenant(tenant.id, slug);
  return { title: listing ? `Claim ${listing.tradingName} — ${tenant.name}` : "Claim listing", robots: { index: false, follow: false } };
}

export default async function ClaimPage({
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
  const state = (Array.isArray(sp.state) ? sp.state[0] : sp.state) ?? null;
  const maskedTo = (Array.isArray(sp.to) ? sp.to[0] : sp.to) ?? "";
  const devLink = (Array.isArray(sp.devLink) ? sp.devLink[0] : sp.devLink) ?? null;

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/claim/${slug}`)}`);
  }

  const cssVars = {
    "--ink": tenant.branding.colorInk,
    "--primary": tenant.branding.colorPrimary,
    "--surface": tenant.branding.colorSurface,
    backgroundColor: "var(--surface)",
    color: "var(--ink)",
  } as React.CSSProperties;

  return (
    <main className="min-h-screen" style={cssVars}>
      <Header tenant={tenant} user={user} />
      <div className="mx-auto max-w-xl px-5 py-12">
        <a href={`/listing/${slug}`} className="mb-6 inline-block text-sm opacity-70 transition hover:opacity-100">
          ← Back to listing
        </a>

        <div className="rounded-2xl border border-black/[0.07] bg-white p-8 shadow-[0_1px_2px_rgba(48,43,39,0.04)]">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Claim {listing.tradingName}</h1>

          {listing.claimState === "CLAIMED" || state === "already" ? (
            <p className="mt-4 text-sm opacity-75">
              This listing has already been claimed. If you believe this is an error, use “Report this listing” on the
              public page.
            </p>
          ) : state === "emailed" ? (
            <div className="mt-4 space-y-3 text-sm">
              <p className="rounded-lg bg-emerald-50 p-3 text-emerald-800">
                We&apos;ve emailed a confirmation link to <strong>{maskedTo}</strong>. Open it within 48 hours to prove
                you control that address. A directory admin then completes the review.
              </p>
              {devLink && (
                <p className="rounded-lg border border-dashed border-black/20 bg-black/[0.02] p-3 text-xs">
                  <strong>Dev sandbox</strong> (no email provider configured): {" "}
                  <a href={devLink} className="break-all underline" style={{ color: "var(--primary)" }}>
                    {devLink}
                  </a>
                </p>
              )}
            </div>
          ) : state === "review" ? (
            <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              This listing has no public email on file, so we can&apos;t auto-verify by email. Your claim has been sent
              to a directory admin for manual review — we&apos;ll be in touch.
            </p>
          ) : (
            <>
              <p className="mt-4 text-sm opacity-75">
                Claiming lets you manage this listing — edit details, respond to reviews, and post offers. We verify
                ownership before granting access.
              </p>
              <ol className="mt-4 space-y-2 text-sm opacity-80">
                <li>1. We email a confirmation link to the business&apos;s email on file.</li>
                <li>2. You open it to prove you control that inbox.</li>
                <li>3. A directory admin reviews and approves.</li>
              </ol>
              <form action={startClaimAction.bind(null, slug)} className="mt-6">
                <button
                  type="submit"
                  className="rounded-lg px-6 py-2.5 text-sm font-medium text-white transition"
                  style={{ backgroundColor: "var(--primary)" }}
                >
                  Start claim
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
