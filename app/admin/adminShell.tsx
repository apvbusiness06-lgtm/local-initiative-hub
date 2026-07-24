// Shared chrome + access gate for the admin area. Admin permission is
// checked against the REAL user (getRealUser), so an admin who is currently
// impersonating a normal user correctly can't reach admin tools until they
// stop. Returns a rendered denial when access is missing.

import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { resolveTenant, type ResolvedTenant } from "@/lib/tenant";
import { getRealUser } from "@/lib/auth/currentUser";
import { can } from "@/lib/auth/rbac";
import { Header } from "@/components/Header";
import type { SessionUser } from "@/lib/auth/session";

export interface AdminGate {
  ok: boolean;
  tenant: ResolvedTenant;
  user: SessionUser | null;
  render: (children: React.ReactNode) => React.ReactElement;
}

export async function adminGate(permission = "listings.approve"): Promise<AdminGate> {
  const host = (await headers()).get("host") ?? "";
  const [tenant, user] = await Promise.all([resolveTenant(host), getRealUser()]);
  if (!tenant) notFound();

  const ok = !!user && (await can(user.id, permission, { tenantId: tenant.id }));

  const cssVars = {
    "--ink": tenant.branding.colorInk,
    "--primary": tenant.branding.colorPrimary,
    "--surface": tenant.branding.colorSurface,
    backgroundColor: "var(--surface)",
    color: "var(--ink)",
  } as React.CSSProperties;

  const render = (children: React.ReactNode) => (
    <main className="min-h-screen" style={cssVars}>
      <Header tenant={tenant} user={user} />
      <div className="mx-auto max-w-5xl px-5 py-10">
        {ok ? (
          children
        ) : (
          <div className="rounded-xl border border-black/[0.07] bg-white p-10 text-center">
            <h1 className="text-lg font-semibold">Admin access required</h1>
            <p className="mx-auto mt-2 max-w-md text-sm opacity-70">
              You don&apos;t have admin permissions for {tenant.name}.
            </p>
          </div>
        )}
      </div>
    </main>
  );

  return { ok, tenant, user, render };
}

export function Banner({ tone, children }: { tone: "ok" | "warn" | "error"; children: React.ReactNode }) {
  const cls = tone === "ok" ? "bg-emerald-50 text-emerald-800" : tone === "warn" ? "bg-amber-50 text-amber-900" : "bg-red-50 text-red-700";
  return <p className={`mb-4 rounded-lg p-3 text-sm ${cls}`}>{children}</p>;
}

export function flagOf(sp: Record<string, string | string[] | undefined>, key: string): string | undefined {
  return Array.isArray(sp[key]) ? (sp[key] as string[])[0] : (sp[key] as string | undefined);
}
