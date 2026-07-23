import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { resolveTenant } from "@/lib/tenant";
import { AuthCard, FieldError, textInputClassName, primaryButtonClassName } from "@/components/AuthCard";
import { resetPasswordAction } from "./actions";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const host = (await headers()).get("host") ?? "";
  const tenant = await resolveTenant(host);
  if (!tenant) notFound();

  const { token, error } = await searchParams;

  if (!token) {
    return (
      <AuthCard tenant={tenant} title="Invalid reset link">
        <p className="text-sm opacity-80">
          This password reset link is missing its token. Request a new one from the{" "}
          <a href="/forgot-password" className="underline" style={{ color: "var(--primary)" }}>
            forgot password
          </a>{" "}
          page.
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard tenant={tenant} title="Choose a new password">
      <form action={resetPasswordAction} className="space-y-4">
        <input type="hidden" name="token" value={token} />
        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-medium">
            New password
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
            Confirm new password
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
          Reset password
        </button>
      </form>
    </AuthCard>
  );
}
