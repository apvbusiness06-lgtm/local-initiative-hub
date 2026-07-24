// Mandatory visible indicator while support impersonation is active — a
// break-glass action must never be invisible. Rendered site-wide from the
// root layout. The grant is time-limited and self-expiring (lib/auth/
// impersonation.ts); this just makes it obvious and offers a one-click exit.

import { getImpersonation } from "@/lib/auth/currentUser";
import { stopImpersonationAction } from "@/app/admin/impersonation/actions";

export async function ImpersonationBanner() {
  const state = await getImpersonation();
  if (!state) return null;

  return (
    <div className="sticky top-0 z-50 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-amber-500 px-4 py-1.5 text-center text-xs font-medium text-amber-950">
      <span>
        Viewing as <strong>{state.targetEmail}</strong> (support impersonation) — reason: {state.reason}
      </span>
      <form action={stopImpersonationAction}>
        <button type="submit" className="rounded bg-amber-950/10 px-2 py-0.5 font-semibold underline">
          Stop impersonating
        </button>
      </form>
    </div>
  );
}
