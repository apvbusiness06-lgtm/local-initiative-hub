import type { Metadata } from "next";
import { adminGate } from "./adminShell";
import { getRealUser } from "@/lib/auth/currentUser";
import { can } from "@/lib/auth/rbac";
import { pendingModeration } from "@/lib/admin";
import { pendingClaimsForTenant } from "@/lib/claims";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

export default async function AdminDashboard() {
  const gate = await adminGate();
  if (!gate.ok) return gate.render(null);

  const [moderation, claims, canImpersonate] = await Promise.all([
    pendingModeration(gate.tenant.id),
    pendingClaimsForTenant(gate.tenant.id),
    getRealUser().then((u) => (u ? can(u.id, "users.impersonate") : false)),
  ]);

  const cards: { href: string; title: string; desc: string; count?: number }[] = [
    { href: "/admin/moderation", title: "Moderation queue", desc: "Listing edits, reports and suggestions.", count: moderation.length },
    { href: "/admin/claims", title: "Claim review", desc: "Ownership claims awaiting approval.", count: claims.length },
    { href: "/admin/businesses", title: "Listings & placement", desc: "Approve, suspend, feature and sponsor listings." },
  ];
  if (canImpersonate) {
    cards.push({ href: "/admin/users", title: "Users", desc: "Search users and start support impersonation." });
  }

  return gate.render(
    <>
      <h1 className="font-heading text-2xl font-semibold tracking-tight">Admin — {gate.tenant.name}</h1>
      <p className="mt-1 text-sm opacity-70">Operate the directory: moderation, claims, listings and placement.</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {cards.map((c) => (
          <a
            key={c.href}
            href={c.href}
            className="rounded-xl border border-black/[0.07] bg-white p-5 shadow-[0_1px_2px_rgba(48,43,39,0.04)] transition hover:shadow-[0_4px_16px_rgba(48,43,39,0.08)]"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">{c.title}</h2>
              {c.count != null && c.count > 0 && (
                <span className="rounded-full px-2 py-0.5 text-xs font-semibold text-white" style={{ backgroundColor: "var(--primary)" }}>
                  {c.count}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm opacity-70">{c.desc}</p>
          </a>
        ))}
      </div>
    </>
  );
}
