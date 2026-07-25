// Claim review queue. Naturally tenant-scoped by the host the admin is on:
// it shows claims for businesses this tenant is canonical for. A cross-tenant
// super-admin view is Slice 8. Access requires listings.approve on this
// tenant, enforced here and again in the decision actions.

import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { resolveTenant, type ResolvedTenant } from "@/lib/tenant";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { can } from "@/lib/auth/rbac";
import { pendingClaimsForTenant } from "@/lib/claims";
import { Header } from "@/components/Header";
import type { SessionUser } from "@/lib/auth/session";
import { approveClaimAction, rejectClaimAction } from "./actions";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AdminClaimsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const host = (await headers()).get("host") ?? "";
  const [tenant, user] = await Promise.all([resolveTenant(host), getCurrentUser()]);
  if (!tenant) notFound();

  const cssVars = {
    "--ink": tenant.branding.colorInk,
    "--primary": tenant.branding.colorPrimary,
    "--surface": tenant.branding.colorSurface,
    backgroundColor: "var(--surface)",
    color: "var(--ink)",
  } as React.CSSProperties;

  if (!user) {
    return (
      <Shell cssVars={cssVars} tenant={tenant} user={user}>
        <Denied message="Please log in with an admin account." />
      </Shell>
    );
  }

  const allowed = await can(user.id, "listings.approve", { tenantId: tenant.id });
  if (!allowed) {
    return (
      <Shell cssVars={cssVars} tenant={tenant} user={user}>
        <Denied message="You don't have permission to review claims on this directory." />
      </Shell>
    );
  }

  const claims = await pendingClaimsForTenant(tenant.id);
  const sp = await searchParams;
  const flag = (k: string) => (Array.isArray(sp[k]) ? sp[k]?.[0] : sp[k]);

  return (
    <Shell cssVars={cssVars} tenant={tenant} user={user}>
      <h1 className="font-heading text-2xl font-semibold tracking-tight">Claim review</h1>
      <p className="mt-1 text-sm opacity-70">Ownership claims awaiting approval for {tenant.name}.</p>

      {flag("approved") && <Banner tone="ok">Claim approved — ownership granted.</Banner>}
      {flag("rejected") && <Banner tone="warn">Claim rejected. No access was granted.</Banner>}
      {flag("error") && <Banner tone="error">Couldn&apos;t complete that action: {flag("error")}</Banner>}

      {claims.length === 0 ? (
        <p className="mt-8 rounded-xl border border-black/[0.07] bg-white p-8 text-center text-sm opacity-60">
          No claims awaiting review.
        </p>
      ) : (
        <ul className="mt-6 space-y-4">
          {claims.map((c) => (
            <li key={c.id} className="rounded-xl border border-black/[0.07] bg-white p-5 shadow-[0_1px_2px_rgba(48,43,39,0.04)]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold">
                    <a href={`/listing/${c.businessSlug}`} className="hover:underline">
                      {c.businessName}
                    </a>
                  </h2>
                  <p className="mt-1 text-sm opacity-70">
                    Claimant: {c.claimantEmail} · Method: {c.method?.replace("_", " ").toLowerCase() ?? "—"} · Evidence:{" "}
                    {c.evidenceKind === "email_possession"
                      ? "email control confirmed"
                      : c.evidenceKind === "admin_review"
                        ? "manual review (no on-file email)"
                        : c.evidenceKind ?? "—"}
                  </p>
                  <p className="mt-0.5 text-xs opacity-50">
                    Requested {c.createdAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-black/[0.06] pt-4">
                <ApproveButton claimId={c.id} />
                <RejectForm claimId={c.id} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}

function ApproveButton({ claimId }: { claimId: string }) {
  return (
    <form action={approveClaimAction.bind(null, claimId)}>
      <button
        type="submit"
        className="rounded-lg px-4 py-2 text-sm font-medium text-white transition"
        style={{ backgroundColor: "var(--primary)" }}
      >
        Approve &amp; grant ownership
      </button>
    </form>
  );
}

function RejectForm({ claimId }: { claimId: string }) {
  return (
    <form action={rejectClaimAction.bind(null, claimId)} className="flex flex-1 flex-wrap items-center gap-2">
      <input
        name="reason"
        placeholder="Reason for rejection"
        className="min-w-[12rem] flex-1 rounded-lg border border-black/10 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
      />
      <button
        type="submit"
        className="rounded-lg border border-black/10 px-4 py-2 text-sm font-medium transition hover:bg-black/[0.03]"
      >
        Reject
      </button>
    </form>
  );
}

function Shell({
  cssVars,
  tenant,
  user,
  children,
}: {
  cssVars: React.CSSProperties;
  tenant: ResolvedTenant;
  user: SessionUser | null;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen" style={cssVars}>
      <Header tenant={tenant} user={user} />
      <div className="mx-auto max-w-4xl px-5 py-10">{children}</div>
    </main>
  );
}

function Denied({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-black/[0.07] bg-white p-10 text-center">
      <h1 className="text-lg font-semibold">Admin access required</h1>
      <p className="mx-auto mt-2 max-w-md text-sm opacity-70">{message}</p>
    </div>
  );
}

function Banner({ tone, children }: { tone: "ok" | "warn" | "error"; children: React.ReactNode }) {
  const cls = tone === "ok" ? "bg-emerald-50 text-emerald-800" : tone === "warn" ? "bg-amber-50 text-amber-900" : "bg-red-50 text-red-700";
  return <p className={`mt-4 rounded-lg p-3 text-sm ${cls}`}>{children}</p>;
}
