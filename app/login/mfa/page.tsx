import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { resolveTenant } from "@/lib/tenant";
import { verifySignedPayload } from "@/lib/auth/signedToken";
import { PENDING_MFA_COOKIE_NAME } from "@/lib/auth/cookieOptions";
import { AuthCard, FieldError, textInputClassName, primaryButtonClassName } from "@/components/AuthCard";
import { verifyMfaChallengeAction } from "./actions";

export default async function LoginMfaPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const host = (await headers()).get("host") ?? "";
  const tenant = await resolveTenant(host);
  if (!tenant) notFound();

  const pendingToken = (await cookies()).get(PENDING_MFA_COOKIE_NAME)?.value;
  const payload = pendingToken ? verifySignedPayload<{ purpose: string }>(pendingToken) : null;
  if (!payload || payload.purpose !== "mfa_challenge") {
    redirect("/login?error=" + encodeURIComponent("Your login session expired. Log in again."));
  }

  const { error } = await searchParams;

  return (
    <AuthCard tenant={tenant} title="Enter your authentication code" subtitle="Open your authenticator app for the current 6-digit code.">
      <form action={verifyMfaChallengeAction} className="space-y-4">
        <div>
          <label htmlFor="code" className="mb-1 block text-sm font-medium">
            6-digit code
          </label>
          <input
            id="code"
            name="code"
            type="text"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            autoFocus
            className={textInputClassName() + " text-center text-lg tracking-[0.3em]"}
          />
        </div>
        <FieldError message={error} />
        <button type="submit" className={primaryButtonClassName()} style={{ backgroundColor: "var(--primary)" }}>
          Verify
        </button>
      </form>
    </AuthCard>
  );
}
