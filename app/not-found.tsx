// Rendered when a hostname has no verified TenantDomain — an unrecognised
// or unverified custom domain must never fall through to a default tenant's
// content, so this shell carries no tenant branding at all.
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <p className="text-xs uppercase tracking-[0.18em] opacity-60">
        Local Initiative
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">
        We couldn&apos;t find this directory
      </h1>
      <p className="mt-2 max-w-md text-sm opacity-70">
        This address isn&apos;t connected to a Local Initiative directory, or
        the domain hasn&apos;t finished verifying yet.
      </p>
    </main>
  );
}
