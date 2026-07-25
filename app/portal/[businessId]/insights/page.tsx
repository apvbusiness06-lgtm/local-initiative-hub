import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { resolveTenant } from "@/lib/tenant";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { userOwnsBusiness } from "@/lib/claims";
import { businessDashboard } from "@/lib/analytics";
import { PrismaClient } from "@prisma/client";
import { Header } from "@/components/Header";

export const metadata: Metadata = { title: "Insights", robots: { index: false, follow: false } };

const prisma = new PrismaClient();

export default async function InsightsPage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const host = (await headers()).get("host") ?? "";
  const [tenant, user] = await Promise.all([resolveTenant(host), getCurrentUser()]);
  if (!tenant) notFound();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/portal/${businessId}/insights`)}`);
  if (!(await userOwnsBusiness(user.id, businessId))) redirect("/portal?error=forbidden");

  const [metrics, business] = await Promise.all([
    businessDashboard(businessId, 30),
    prisma.business.findUnique({ where: { id: businessId }, select: { tradingName: true } }),
  ]);

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
      <div className="mx-auto max-w-3xl px-5 py-10">
        <a href={`/portal/${businessId}`} className="text-sm opacity-70 hover:opacity-100">← Back to listing</a>
        <h1 className="font-heading mt-2 text-2xl font-semibold tracking-tight">Insights</h1>
        <p className="mt-1 text-sm opacity-70">{business?.tradingName} · last 30 days</p>

        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
          {metrics.map((m) => (
            <div key={m.eventKey} className="rounded-xl border border-black/[0.07] bg-white p-5 shadow-[0_1px_2px_rgba(48,43,39,0.04)]">
              <p className="text-2xl font-semibold">{m.total.toLocaleString("en-GB")}</p>
              <p className="mt-1 text-xs opacity-60">{m.label}</p>
            </div>
          ))}
        </div>

        <p className="mt-6 text-xs opacity-50">
          Figures are counts of on-site actions (e.g. call-button clicks), computed from nightly rollups. A click is
          counted as a click — we can&apos;t confirm whether a call connected or a sale followed.
        </p>
      </div>
    </main>
  );
}
