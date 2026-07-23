import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { resolveTenant } from "@/lib/tenant";
import { AuthCard, FieldError, textInputClassName, primaryButtonClassName } from "@/components/AuthCard";
import { registerAction } from "./actions";

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string; sandboxToken?: string }>;
}) {
  const host = (await headers()).get("host") ?? "";
  const tenant = await resolveTenant(host);
  if (!tenant) notFound();

  const { error, sent, sandboxToken } = await searchParams;

  if (sent) {
    return (
      <AuthCard tenant={tenant} title="Check your email">
        <p className="text-sm opacity-80">
          We&apos;ve sent a verification link to the address you registered with. Click it to activate
          your account, then <a href="/login" className="underline" style={{ color: "var(--primary)" }}>log in</a>.
        </p>
        {sandboxToken && (
          <div className="mt-4 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-medium">Sandbox mode — no email provider is configured</p>
            <p className="mt-1 opacity-90">
              Email delivery isn&apos;t wired up in this environment, so here&apos;s the real link that would
              have been sent:
            </p>
            <a
              href={`/api/auth/verify-email?token=${sandboxToken}`}
              className="mt-2 block break-all font-mono text-xs underline"
            >
              /api/auth/verify-email?token={sandboxToken}
            </a>
          </div>
        )}
      </AuthCard>
    );
  }

  return (
    <AuthCard tenant={tenant} title="Create your account" subtitle="One account works across every Local Initiative directory.">
      <form action={registerAction} className="space-y-4">
        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium">
            Email address
          </label>
          <input id="email" name="email" type="email" required autoComplete="email" className={textInputClassName()} />
        </div>
        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={10}
            autoComplete="new-password"
            className={textInputClassName()}
          />
          <p className="mt-1 text-xs opacity-60">At least 10 characters.</p>
        </div>
        <div>
          <label htmlFor="confirmPassword" className="mb-1 block text-sm font-medium">
            Confirm password
          </label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            required
            minLength={10}
            autoComplete="new-password"
            className={textInputClassName()}
          />
        </div>
        <FieldError message={error} />
        <button type="submit" className={primaryButtonClassName()} style={{ backgroundColor: "var(--primary)" }}>
          Create account
        </button>
      </form>
      <p className="mt-6 text-center text-sm opacity-70">
        Already have an account?{" "}
        <a href="/login" className="font-medium underline" style={{ color: "var(--primary)" }}>
          Log in
        </a>
      </p>
    </AuthCard>
  );
}
