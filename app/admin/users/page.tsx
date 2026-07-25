import type { Metadata } from "next";
import { adminGate, Banner, flagOf } from "../adminShell";
import { getRealUser } from "@/lib/auth/currentUser";
import { can } from "@/lib/auth/rbac";
import { searchUsers } from "@/lib/admin";
import { startImpersonationAction } from "../impersonation/actions";

export const metadata: Metadata = { title: "Users", robots: { index: false, follow: false } };

const ERRORS: Record<string, string> = {
  forbidden: "You don't have permission to impersonate users.",
  reason_required: "A reason of at least 5 characters is required to impersonate.",
  notfound: "That user no longer exists.",
  self: "You can't impersonate yourself.",
};

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Impersonation is platform-scoped; gate this page on it specifically.
  const gate = await adminGate("users.impersonate");
  if (!gate.ok) return gate.render(null);

  const sp = await searchParams;
  const q = (flagOf(sp, "q") ?? "").trim();
  const [users, realUser] = await Promise.all([searchUsers(q), getRealUser()]);
  // Defence in depth: never render an impersonate control the action would reject.
  const canImpersonate = realUser ? await can(realUser.id, "users.impersonate") : false;
  const err = flagOf(sp, "error");

  return gate.render(
    <>
      <a href="/admin" className="text-sm opacity-70 hover:opacity-100">← Admin</a>
      <h1 className="font-heading mt-2 text-2xl font-semibold tracking-tight">Users</h1>
      <p className="mt-1 text-sm opacity-70">
        Support impersonation is time-limited (30 min), shows a banner site-wide, and every action is audited under
        both your account and the impersonated user.
      </p>
      {err && <Banner tone="error">{ERRORS[err] ?? err}</Banner>}

      <form method="get" className="mt-6 flex gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search by email…"
          className="flex-1 rounded-lg border border-black/10 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
        />
        <button className="rounded-lg px-4 py-2 text-sm font-medium text-white" style={{ backgroundColor: "var(--primary)" }}>
          Search
        </button>
      </form>

      <ul className="mt-6 space-y-3">
        {users.map((u) => (
          <li key={u.id} className="rounded-xl border border-black/[0.07] bg-white p-4 shadow-[0_1px_2px_rgba(48,43,39,0.04)]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium">{u.email}</p>
                <p className="text-xs opacity-60">
                  {u.emailVerified ? "verified" : "unverified"}
                  {u.roles.length > 0 && ` · ${u.roles.join(", ")}`}
                </p>
              </div>
              {canImpersonate && u.id !== realUser?.id && (
                <form action={startImpersonationAction.bind(null, u.id)} className="flex items-center gap-2">
                  <input
                    name="reason"
                    required
                    minLength={5}
                    placeholder="Reason (required)"
                    className="w-48 rounded-lg border border-black/10 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-black/10"
                  />
                  <button className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-medium transition hover:bg-black/[0.03]">
                    Impersonate
                  </button>
                </form>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
