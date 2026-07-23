import type { ResolvedTenant } from "@/lib/tenant";
import type { SessionUser } from "@/lib/auth/session";
import { logoutAction } from "@/app/account/actions";

// Only links to routes that actually work end to end — Community, Events,
// Offers, Spotlight and Newsletter from the reference header aren't built
// yet (see BACKLOG.md), so they're not here. A nav item to a page that
// 404s is worse than a shorter nav.
export function Header({ tenant, user }: { tenant: ResolvedTenant; user: SessionUser | null }) {
  return (
    <header className="border-b border-black/[0.07] bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
        <a href="/" className="flex items-center gap-2 font-heading text-lg font-semibold tracking-tight">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 2C7.6 2 4 5.6 4 10c0 6 8 12 8 12s8-6 8-12c0-4.4-3.6-8-8-8Zm0 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z"
              fill="var(--primary)"
            />
          </svg>
          <span style={{ color: "var(--ink)" }}>{tenant.name}</span>
        </a>

        <nav className="flex items-center gap-5 text-sm">
          <a href="/businesses" className="opacity-80 transition hover:opacity-100">
            Businesses
          </a>
          {user ? (
            <>
              <a href="/account" className="opacity-80 transition hover:opacity-100">
                Account
              </a>
              <form action={logoutAction}>
                <button
                  type="submit"
                  className="rounded-lg border border-black/10 px-3 py-1.5 font-medium transition hover:bg-black/[0.03]"
                >
                  Log out
                </button>
              </form>
            </>
          ) : (
            <>
              <a href="/login" className="opacity-80 transition hover:opacity-100">
                Log in
              </a>
              <a
                href="/register"
                className="rounded-lg px-3 py-1.5 font-medium text-white transition"
                style={{ backgroundColor: "var(--primary)" }}
              >
                Register
              </a>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
