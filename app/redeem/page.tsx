// Staff redemption screen. Owner-gated; double redemption is impossible at
// the DB level (Redemption.claimId unique FK), so a second scan of the same
// code reports "already redeemed" rather than applying twice.

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { resolveTenant } from "@/lib/tenant";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { userOwnsBusiness } from "@/lib/claims";
import { PrismaClient } from "@prisma/client";
import { Header } from "@/components/Header";
import { redeemAction } from "./actions";

export const metadata: Metadata = { title: "Redeem voucher", robots: { index: false, follow: false } };

const prisma = new PrismaClient();

export default async function RedeemPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const host = (await headers()).get("host") ?? "";
  const [tenant, user] = await Promise.all([resolveTenant(host), getCurrentUser()]);
  if (!tenant) notFound();

  const sp = await searchParams;
  const val = (k: string) => (Array.isArray(sp[k]) ? sp[k]?.[0] : sp[k]);
  const businessId = val("biz");
  if (!user) redirect(`/login?next=${encodeURIComponent(`/redeem${businessId ? `?biz=${businessId}` : ""}`)}`);

  // The signed-in staff member must manage a business. If no biz given, pick
  // the first they own; if they own none, deny.
  let bizId = businessId ?? null;
  if (!bizId) {
    const owned = await prisma.businessOwner.findFirst({ where: { userId: user.id } });
    bizId = owned?.businessId ?? null;
  }
  const canRedeem = bizId ? await userOwnsBusiness(user.id, bizId) : false;
  const business = bizId ? await prisma.business.findUnique({ where: { id: bizId }, select: { tradingName: true } }) : null;

  const cssVars = {
    "--ink": tenant.branding.colorInk,
    "--primary": tenant.branding.colorPrimary,
    "--surface": tenant.branding.colorSurface,
    backgroundColor: "var(--surface)",
    color: "var(--ink)",
  } as React.CSSProperties;

  const ok = val("ok");
  const fail = val("fail");

  return (
    <main className="min-h-screen" style={cssVars}>
      <Header tenant={tenant} user={user} />
      <div className="mx-auto max-w-md px-5 py-10">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Redeem a voucher</h1>
        {business && <p className="mt-1 text-sm opacity-70">{business.tradingName}</p>}

        {ok && <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">✓ Redeemed: {ok}</p>}
        {fail === "already_redeemed" && (
          <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            Already redeemed{val("title") ? `: ${val("title")}` : ""} — this code has been used.
          </p>
        )}
        {fail === "not_found" && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">No voucher found for that code.</p>}
        {val("error") === "forbidden" && (
          <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">You don&apos;t manage this business.</p>
        )}

        {canRedeem && bizId ? (
          <form action={redeemAction.bind(null, bizId)} className="mt-6 flex gap-2">
            <input
              name="code"
              autoFocus
              placeholder="Voucher code (e.g. ABCD-2345)"
              className="flex-1 rounded-lg border border-black/10 px-3 py-2 font-mono uppercase focus:outline-none focus:ring-2 focus:ring-black/10"
            />
            <button className="rounded-lg px-5 py-2 text-sm font-medium text-white" style={{ backgroundColor: "var(--primary)" }}>
              Redeem
            </button>
          </form>
        ) : (
          <p className="mt-6 rounded-xl border border-black/[0.07] bg-white p-6 text-center text-sm opacity-70">
            You need to manage a business to redeem vouchers. Claim your listing first.
          </p>
        )}
      </div>
    </main>
  );
}
