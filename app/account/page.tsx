import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { resolveTenant } from "@/lib/tenant";
import { getSessionByToken } from "@/lib/auth/session";
import { SESSION_COOKIE_NAME } from "@/lib/auth/cookieOptions";
import { FieldNotice } from "@/components/AuthCard";
import { logoutAction } from "./actions";

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ mfaEnrolled?: string }>;
}) {
  const host = (await headers()).get("host") ?? "";
  const tenant = await resolveTenant(host);
  if (!tenant) notFound();

  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const user = token ? await getSessionByToken(token) : null;
  if (!user) redirect("/login");

  const { mfaEnrolled } = await searchParams;

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
      <div className="mx-auto max-w-lg px-5 py-16">
        <p className="text-xs uppercase tracking-[0.18em] opacity-60">{tenant.name}</p>
        <h1 className="font-heading mt-2 text-2xl font-semibold tracking-tight">Your account</h1>

        {mfaEnrolled && <div className="mt-4"><FieldNotice message="Two-factor authentication is now enabled." /></div>}

        <div className="mt-6 rounded-2xl border border-black/[0.07] bg-white p-6 shadow-[0_1px_2px_rgba(48,43,39,0.04)]">
          <dl className="space-y-4 text-sm">
            <div className="flex items-center justify-between">
              <dt className="opacity-60">Email</dt>
              <dd className="font-medium">{user!.email}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="opacity-60">Email verified</dt>
              <dd className="font-medium">{user!.emailVerifiedAt ? "Yes" : "No"}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="opacity-60">Two-factor authentication</dt>
              <dd className="font-medium">
                {user!.mfaEnrolledAt ? (
                  "Enabled"
                ) : (
                  <a href="/account/mfa/setup" className="underline" style={{ color: "var(--primary)" }}>
                    Set up
                  </a>
                )}
              </dd>
            </div>
          </dl>

          <form action={logoutAction} className="mt-6">
            <button
              type="submit"
              className="rounded-lg border border-black/10 px-4 py-2 text-sm font-medium transition hover:bg-black/[0.03]"
            >
              Log out
            </button>
          </form>
        </div>

        <p className="mt-6 text-sm">
          <a href="/businesses" className="underline" style={{ color: "var(--primary)" }}>
            Browse businesses
          </a>
        </p>
      </div>
    </main>
  );
}
