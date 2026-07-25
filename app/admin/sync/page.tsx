import type { Metadata } from "next";
import { adminGate, Banner, flagOf } from "../adminShell";
import { syncJobsForTenant } from "@/lib/admin";
import { requeueSyncJobAction } from "../actions";

export const metadata: Metadata = { title: "CRM sync", robots: { index: false, follow: false } };

const STATUS_TONE: Record<string, string> = {
  SUCCEEDED: "text-emerald-700",
  QUEUED: "opacity-70",
  RUNNING: "text-amber-700",
  FAILED: "text-amber-700",
  DEAD_LETTER: "text-red-700",
};

export default async function AdminSyncPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const gate = await adminGate("tenants.manage");
  if (!gate.ok) return gate.render(null);

  const [jobs, sp] = await Promise.all([syncJobsForTenant(gate.tenant.id), searchParams]);

  return gate.render(
    <>
      <a href="/admin" className="text-sm opacity-70 hover:opacity-100">← Admin</a>
      <h1 className="font-heading mt-2 text-2xl font-semibold tracking-tight">CRM sync log</h1>
      <p className="mt-1 text-sm opacity-70">Outbound sync jobs for {gate.tenant.name}. Secrets are redacted in error output.</p>
      {flagOf(sp, "done") && <Banner tone="ok">Job requeued.</Banner>}

      {jobs.length === 0 ? (
        <p className="mt-6 rounded-xl border border-black/[0.07] bg-white p-8 text-center text-sm opacity-60">
          No sync jobs yet. Connect a GoHighLevel location and generate a lead to see activity.
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[44rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-black/10 text-left text-xs uppercase tracking-wide opacity-60">
                <th className="py-2 pr-3">Job</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Attempts</th>
                <th className="py-2 pr-3">Last error</th>
                <th className="py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-b border-black/[0.06] align-top">
                  <td className="py-3 pr-3 font-mono text-xs">{j.jobKey}</td>
                  <td className={`py-3 pr-3 font-medium ${STATUS_TONE[j.status] ?? ""}`}>{j.status.replace("_", " ").toLowerCase()}</td>
                  <td className="py-3 pr-3">{j.attempts}/{j.maxAttempts}</td>
                  <td className="py-3 pr-3 max-w-[16rem] truncate text-xs opacity-70">{j.lastError ?? "—"}</td>
                  <td className="py-3">
                    {(j.status === "DEAD_LETTER" || j.status === "FAILED") && (
                      <form action={requeueSyncJobAction.bind(null, j.id)}>
                        <button className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-medium transition hover:bg-black/[0.03]">
                          Resync
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
