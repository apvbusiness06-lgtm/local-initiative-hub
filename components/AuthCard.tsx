import type { ResolvedTenant } from "@/lib/tenant";

export function AuthCard({
  tenant,
  title,
  subtitle,
  children,
}: {
  tenant: ResolvedTenant;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <main
      className="flex min-h-screen items-center justify-center px-5 py-16"
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
      <div className="w-full max-w-md rounded-2xl border border-black/[0.07] bg-white p-8 shadow-[0_1px_2px_rgba(48,43,39,0.04)]">
        <p className="text-xs uppercase tracking-[0.18em] opacity-60">{tenant.name}</p>
        <h1 className="font-heading mt-2 text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-2 text-sm opacity-70">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </main>
  );
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
      {message}
    </p>
  );
}

export function FieldNotice({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{message}</p>
  );
}

export function textInputClassName() {
  return "w-full rounded-lg border border-black/10 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-black/10";
}

export function primaryButtonClassName() {
  return "w-full rounded-lg px-4 py-2.5 text-sm font-medium text-white transition";
}
