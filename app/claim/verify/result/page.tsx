import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { resolveTenant } from "@/lib/tenant";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { Header } from "@/components/Header";

export const metadata: Metadata = { robots: { index: false, follow: false } };

const MESSAGES: Record<string, { title: string; body: string; tone: "ok" | "warn" | "error" }> = {
  ok: {
    title: "Email confirmed",
    body: "Thanks — you've proved you control this business's email. A directory admin will review your claim and grant access once approved.",
    tone: "ok",
  },
  expired: {
    title: "This link has expired",
    body: "Claim links are valid for 48 hours. Start the claim again from the listing page to get a fresh link.",
    tone: "warn",
  },
  already_used: {
    title: "This link has already been used",
    body: "This confirmation link can only be used once. If your claim is still awaiting review, no further action is needed.",
    tone: "warn",
  },
  invalid: {
    title: "This link isn't valid",
    body: "We couldn't recognise this confirmation link. Start the claim again from the listing page.",
    tone: "error",
  },
};

export default async function ClaimVerifyResultPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const host = (await headers()).get("host") ?? "";
  const [tenant, user] = await Promise.all([resolveTenant(host), getCurrentUser()]);
  if (!tenant) notFound();

  const sp = await searchParams;
  const state = (Array.isArray(sp.state) ? sp.state[0] : sp.state) ?? "invalid";
  const slug = (Array.isArray(sp.slug) ? sp.slug[0] : sp.slug) ?? null;
  const msg = MESSAGES[state] ?? MESSAGES.invalid!;

  const toneClass =
    msg.tone === "ok" ? "bg-emerald-50 text-emerald-800" : msg.tone === "warn" ? "bg-amber-50 text-amber-900" : "bg-red-50 text-red-700";

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
      <div className="mx-auto max-w-xl px-5 py-16">
        <div className="rounded-2xl border border-black/[0.07] bg-white p-8 text-center shadow-[0_1px_2px_rgba(48,43,39,0.04)]">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">{msg.title}</h1>
          <p className={`mx-auto mt-4 max-w-md rounded-lg p-3 text-sm ${toneClass}`}>{msg.body}</p>
          {slug && (
            <a
              href={`/listing/${slug}`}
              className="mt-6 inline-block text-sm font-medium underline"
              style={{ color: "var(--primary)" }}
            >
              Back to the listing
            </a>
          )}
        </div>
      </div>
    </main>
  );
}
