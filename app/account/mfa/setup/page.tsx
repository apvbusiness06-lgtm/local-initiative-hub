import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { resolveTenant } from "@/lib/tenant";
import { generateSecret, otpauthUri } from "@/lib/auth/totp";
import { resolveMfaSetupIdentity } from "@/lib/auth/mfaSetupIdentity";
import { SESSION_COOKIE_NAME, PENDING_MFA_COOKIE_NAME } from "@/lib/auth/cookieOptions";
import { AuthCard, FieldError, textInputClassName, primaryButtonClassName } from "@/components/AuthCard";
import { confirmMfaEnrolmentAction } from "./actions";

export default async function MfaSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ secret?: string; error?: string; forced?: string }>;
}) {
  const host = (await headers()).get("host") ?? "";
  const tenant = await resolveTenant(host);
  if (!tenant) notFound();

  const jar = await cookies();
  const identity = await resolveMfaSetupIdentity(
    jar.get(SESSION_COOKIE_NAME)?.value,
    jar.get(PENDING_MFA_COOKIE_NAME)?.value
  );
  if (!identity) redirect("/login");

  const { secret: secretParam, error, forced } = await searchParams;
  const secret = secretParam ?? generateSecret();
  const uri = otpauthUri(secret, identity!.email);

  return (
    <AuthCard
      tenant={tenant}
      title="Set up two-factor authentication"
      subtitle={
        forced
          ? "Your account role requires two-factor authentication before you can continue."
          : "Add an extra layer of security to your account."
      }
    >
      <div className="rounded-lg border border-black/10 bg-black/[0.02] p-4">
        <p className="text-xs font-medium uppercase tracking-wide opacity-60">Manual entry key</p>
        <p className="mt-1 break-all font-mono text-sm">{secret}</p>
        <p className="mt-3 text-xs opacity-60">
          Add this key to Google Authenticator, Authy or 1Password (Time-based, 6 digits, 30 seconds).
        </p>
        <p className="mt-2 break-all font-mono text-[11px] opacity-50">{uri}</p>
      </div>

      <form action={confirmMfaEnrolmentAction} className="mt-4 space-y-4">
        <input type="hidden" name="secret" value={secret} />
        <div>
          <label htmlFor="code" className="mb-1 block text-sm font-medium">
            Enter the 6-digit code from your app
          </label>
          <input
            id="code"
            name="code"
            type="text"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            className={textInputClassName() + " text-center text-lg tracking-[0.3em]"}
          />
        </div>
        <FieldError message={error} />
        <button type="submit" className={primaryButtonClassName()} style={{ backgroundColor: "var(--primary)" }}>
          Confirm and enable
        </button>
      </form>
    </AuthCard>
  );
}
