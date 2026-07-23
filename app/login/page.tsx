import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { resolveTenant } from "@/lib/tenant";
import { AuthCard, FieldError, FieldNotice, textInputClassName, primaryButtonClassName } from "@/components/AuthCard";
import { loginAction } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; reset?: string }>;
}) {
  const host = (await headers()).get("host") ?? "";
  const tenant = await resolveTenant(host);
  if (!tenant) notFound();

  const { error, reset } = await searchParams;

  return (
    <AuthCard tenant={tenant} title="Log in" subtitle="One account works across every Local Initiative directory.">
      <form action={loginAction} className="space-y-4">
        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium">
            Email address
          </label>
          <input id="email" name="email" type="email" required autoComplete="email" className={textInputClassName()} />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label htmlFor="password" className="block text-sm font-medium">
              Password
            </label>
            <a href="/forgot-password" className="text-xs underline opacity-70">
              Forgot password?
            </a>
          </div>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className={textInputClassName()}
          />
        </div>
        {reset === "success" && <FieldNotice message="Your password has been reset. Log in with your new password." />}
        <FieldError message={error} />
        <button type="submit" className={primaryButtonClassName()} style={{ backgroundColor: "var(--primary)" }}>
          Log in
        </button>
      </form>
      <p className="mt-6 text-center text-sm opacity-70">
        Don&apos;t have an account?{" "}
        <a href="/register" className="font-medium underline" style={{ color: "var(--primary)" }}>
          Register
        </a>
      </p>
    </AuthCard>
  );
}
