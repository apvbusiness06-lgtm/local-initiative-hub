import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { resolveTenant } from "@/lib/tenant";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getOwnedBusinesses } from "@/lib/portal";
import { Header } from "@/components/Header";

export const metadata: Metadata = { title: "Your business", robots: { index: false, follow: false } };

export default async function PortalHomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const host = (await headers()).get("host") ?? "";
  const [tenant, user] = await Promise.all([resolveTenant(host), getCurrentUser()]);
  if (!tenant) notFound();
  if (!user) redirect("/login?next=/portal");

  const businesses = await getOwnedBusinesses(user.id);
  const sp = await searchParams;
  const error = Array.isArray(sp.error) ? sp.error[0] : sp.error;

  return (
    <main
      className="min-h-screen"
      style={
        {
          "--ink": tenant.branding.colorInk,
          "--primary": tenant.branding.colorPrimary,
          "--surface": tenant.branding.colorSurface,
          backgroundColor: "var(--surface)",
          color: "var(--ink)",
        } as React.CSSProperties
      }
    >
      <Header tenant={tenant} user={user} />
      <div className="mx-auto max-w-3xl px-5 py-10">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Your business listings</h1>
        <p className="mt-1 text-sm opacity-70">Manage the listings you own.</p>

        {error === "forbidden" && (
          <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            You don&apos;t have access to that listing.
          </p>
        )}

        {businesses.length === 0 ? (
          <div className="mt-8 rounded-xl border border-black/[0.07] bg-white p-8 text-center">
            <p className="text-sm opacity-70">You don&apos;t manage any listings yet.</p>
            <p className="mt-2 text-sm opacity-70">
              Find your business in the directory and use “Claim this listing” to get started.
            </p>
            <a
              href="/businesses"
              className="mt-4 inline-block rounded-lg px-4 py-2 text-sm font-medium text-white"
              style={{ backgroundColor: "var(--primary)" }}
            >
              Find your business
            </a>
          </div>
        ) : (
          <ul className="mt-6 space-y-3">
            {businesses.map((b) => (
              <li key={b.id}>
                <a
                  href={`/portal/${b.id}`}
                  className="flex items-center justify-between rounded-xl border border-black/[0.07] bg-white p-5 shadow-[0_1px_2px_rgba(48,43,39,0.04)] transition hover:shadow-[0_4px_16px_rgba(48,43,39,0.08)]"
                >
                  <div>
                    <h2 className="font-semibold">{b.tradingName}</h2>
                    <p className="mt-0.5 text-xs opacity-60">
                      {b.status.replace("_", " ").toLowerCase()} · {b.claimState.toLowerCase()}
                    </p>
                  </div>
                  <span className="text-sm font-medium" style={{ color: "var(--primary)" }}>
                    Manage →
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
