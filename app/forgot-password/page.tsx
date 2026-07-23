import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { resolveTenant } from "@/lib/tenant";
import { AuthCard, textInputClassName, primaryButtonClassName } from "@/components/AuthCard";
import { requestPasswordResetAction } from "./actions";

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const host = (await headers()).get("host") ?? "";
  const tenant = await resolveTenant(host);
  if (!tenant) notFound();

  const { sent } = await searchParams;

  if (sent) {
    return (
      <AuthCard tenant={tenant} title="Check your email">
        <p className="text-sm opacity-80">
          If an account exists for that address, we&apos;ve sent a password reset link. It expires in 1
          hour.
        </p>
        <p className="mt-2 text-xs opacity-50">
          (Sandbox mode: no email provider is configured, so the link is written to the server
          console instead of actually being delivered.)
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard tenant={tenant} title="Reset your password" subtitle="We'll email you a link to choose a new one.">
      <form action={requestPasswordResetAction} className="space-y-4">
        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium">
            Email address
          </label>
          <input id="email" name="email" type="email" required autoComplete="email" className={textInputClassName()} />
        </div>
        <button type="submit" className={primaryButtonClassName()} style={{ backgroundColor: "var(--primary)" }}>
          Send reset link
        </button>
      </form>
      <p className="mt-6 text-center text-sm opacity-70">
        <a href="/login" className="font-medium underline" style={{ color: "var(--primary)" }}>
          Back to log in
        </a>
      </p>
    </AuthCard>
  );
}
