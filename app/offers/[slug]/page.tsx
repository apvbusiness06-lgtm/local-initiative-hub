import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { resolveTenant } from "@/lib/tenant";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getOfferForTenant, formatDiscount, claimOffer } from "@/lib/offers";
import { qrSvg } from "@/lib/qr";
import { PrismaClient } from "@prisma/client";
import { Header } from "@/components/Header";
import { claimOfferAction } from "./actions";

const prisma = new PrismaClient();

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const host = (await headers()).get("host") ?? "";
  const tenant = await resolveTenant(host);
  if (!tenant) return {};
  const offer = await getOfferForTenant(tenant.id, slug);
  return offer ? { title: `${offer.title} — ${offer.businessName}` } : {};
}

export default async function OfferPage({
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

  const offer = await getOfferForTenant(tenant.id, slug);
  if (!offer) notFound();

  const sp = await searchParams;
  const flag = (k: string) => (Array.isArray(sp[k]) ? sp[k]?.[0] : sp[k]);
  const error = flag("error");

  // If the signed-in user already holds (or just claimed) this offer, show the
  // code + QR. claimOffer is idempotent so re-loading the page is safe.
  let claim: Awaited<ReturnType<typeof claimOffer>> | null = null;
  let claimSvg: string | null = null;
  if (user) {
    const existing = await prisma.offerClaim.findUnique({
      where: { offerId_userId: { offerId: offer.id, userId: user.id } },
    });
    if (existing) {
      claim = {
        claimId: existing.id,
        code: existing.code,
        qrPayload: existing.qrPayload ?? "",
        offerTitle: offer.title,
        businessName: offer.businessName,
      };
      if (existing.qrPayload) claimSvg = await qrSvg(existing.qrPayload);
    }
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
      <div className="mx-auto max-w-xl px-5 py-10">
        <a href={`/listing/${offer.businessSlug}`} className="text-sm opacity-70 hover:opacity-100">← {offer.businessName}</a>

        <div className="mt-3 rounded-2xl border border-black/[0.07] bg-white p-6 shadow-[0_1px_2px_rgba(48,43,39,0.04)]">
          <span className="inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white" style={{ backgroundColor: "var(--primary)" }}>
            {formatDiscount(offer)}
          </span>
          <h1 className="font-heading mt-2 text-2xl font-semibold tracking-tight">{offer.title}</h1>
          {offer.description && <p className="mt-2 text-sm opacity-80">{offer.description}</p>}
          <p className="mt-3 text-xs opacity-60">
            Valid until {offer.endsAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
          </p>
          {offer.terms && <p className="mt-2 text-xs opacity-50">{offer.terms}</p>}

          {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

          <div className="mt-6 border-t border-black/[0.06] pt-6">
            {claim && "code" in claim ? (
              <div className="text-center">
                <p className="text-xs uppercase tracking-wider opacity-60">Your voucher code</p>
                <p className="mt-1 font-mono text-2xl font-bold tracking-wider">{claim.code}</p>
                {claimSvg && (
                  <div className="mx-auto mt-4 w-[220px]" aria-label="Voucher QR code" dangerouslySetInnerHTML={{ __html: claimSvg }} />
                )}
                <p className="mt-3 text-xs opacity-60">Show this code or QR in store at {offer.businessName} to redeem.</p>
              </div>
            ) : user ? (
              <form action={claimOfferAction.bind(null, slug)} className="text-center">
                <button className="rounded-lg px-6 py-2.5 text-sm font-medium text-white" style={{ backgroundColor: "var(--primary)" }}>
                  Claim this voucher
                </button>
              </form>
            ) : (
              <p className="text-center text-sm opacity-70">
                <a href={`/login?next=${encodeURIComponent(`/offers/${slug}`)}`} className="underline" style={{ color: "var(--primary)" }}>
                  Log in
                </a>{" "}
                to claim this voucher.
              </p>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
