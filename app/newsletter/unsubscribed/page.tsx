import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { resolveTenant } from "@/lib/tenant";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { Header } from "@/components/Header";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function UnsubscribedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const host = (await headers()).get("host") ?? "";
  const [tenant, user] = await Promise.all([resolveTenant(host), getCurrentUser()]);
  if (!tenant) notFound();
  const sp = await searchParams;
  const ok = (Array.isArray(sp.state) ? sp.state[0] : sp.state) === "ok";

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
      <div className="mx-auto max-w-xl px-5 py-16 text-center">
        <div className="rounded-2xl border border-black/[0.07] bg-white p-8">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            {ok ? "You've been unsubscribed" : "Link not recognised"}
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm opacity-70">
            {ok
              ? "You won't receive any more marketing emails from us. Your consent has been withdrawn immediately."
              : "This unsubscribe link isn't valid or has already been used. If you keep receiving emails, contact us."}
          </p>
        </div>
      </div>
    </main>
  );
}
