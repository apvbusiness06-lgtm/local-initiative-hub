import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { resolveTenant } from "@/lib/tenant";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { userOwnsBusiness } from "@/lib/claims";
import { getBillingOverview } from "@/lib/billing";
import { isBillingConfigured } from "@/lib/stripe";
import { Header } from "@/components/Header";
import { startCheckoutAction, manageBillingAction } from "./actions";

export const metadata: Metadata = { title: "Billing", robots: { index: false, follow: false } };

function money(minor: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(minor / 100);
}

export default async function BillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { businessId } = await params;
  const host = (await headers()).get("host") ?? "";
  const [tenant, user] = await Promise.all([resolveTenant(host), getCurrentUser()]);
  if (!tenant) notFound();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/portal/${businessId}/billing`)}`);
  if (!(await userOwnsBusiness(user.id, businessId))) redirect("/portal?error=forbidden");

  const overview = await getBillingOverview(businessId, isBillingConfigured());
  const sp = await searchParams;
  const flag = (k: string) => (Array.isArray(sp[k]) ? sp[k]?.[0] : sp[k]);

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
      <div className="mx-auto max-w-2xl px-5 py-10">
        <a href={`/portal/${businessId}`} className="text-sm opacity-70 hover:opacity-100">← Back to listing</a>
        <h1 className="font-heading mt-2 text-2xl font-semibold tracking-tight">Billing &amp; plan</h1>

        {flag("checkout") === "processing" && (
          <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            Payment received — we&apos;re activating your plan. This updates automatically once Stripe confirms; refresh
            in a moment.
          </p>
        )}
        {flag("checkout") === "cancelled" && (
          <p className="mt-4 rounded-lg bg-black/[0.03] p-3 text-sm opacity-70">Checkout cancelled — no charge was made.</p>
        )}
        {flag("error") === "notconfigured" && (
          <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">Online billing isn&apos;t configured yet.</p>
        )}
        {flag("error") && flag("error") !== "notconfigured" && (
          <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{flag("error")}</p>
        )}

        <div className="mt-6 rounded-xl border border-black/[0.07] bg-white p-5">
          <p className="text-sm opacity-60">Current plan</p>
          <p className="text-lg font-semibold">{overview.currentPlanName}</p>
          {overview.status && <p className="mt-0.5 text-xs opacity-60">Subscription status: {overview.status.toLowerCase()}</p>}
          {overview.manageable && (
            <form action={manageBillingAction.bind(null, businessId)} className="mt-3">
              <button className="rounded-lg border border-black/10 px-4 py-2 text-sm font-medium transition hover:bg-black/[0.03]">
                Manage billing / cancel
              </button>
            </form>
          )}
        </div>

        {!overview.configured && (
          <p className="mt-6 rounded-lg border border-dashed border-black/20 bg-black/[0.02] p-3 text-xs opacity-70">
            Online billing isn&apos;t configured in this environment (no Stripe key). Plans still govern entitlements;
            connect Stripe to accept payments.
          </p>
        )}

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {overview.plans
            .filter((p) => p.key !== "free")
            .map((p) => (
              <div key={p.key} className="rounded-xl border border-black/[0.07] bg-white p-5">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold">{p.name}</h2>
                  {p.current && (
                    <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ backgroundColor: "var(--primary)" }}>
                      Current
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm opacity-70">{p.priceMinorMonthly > 0 ? `${money(p.priceMinorMonthly)}/mo` : "—"}</p>
                {p.purchasable && !p.current ? (
                  <form action={startCheckoutAction.bind(null, businessId, p.key)} className="mt-3 flex items-center gap-2">
                    <select name="interval" className="rounded-lg border border-black/10 px-2 py-1.5 text-sm">
                      <option value="monthly">Monthly</option>
                      <option value="yearly">Yearly</option>
                    </select>
                    <button className="rounded-lg px-4 py-1.5 text-sm font-medium text-white" style={{ backgroundColor: "var(--primary)" }}>
                      Choose
                    </button>
                  </form>
                ) : p.current ? (
                  <p className="mt-3 text-xs opacity-50">Your current plan.</p>
                ) : (
                  <p className="mt-3 text-xs opacity-50">Not available online yet.</p>
                )}
              </div>
            ))}
        </div>
      </div>
    </main>
  );
}
