import type { Metadata } from "next";
import { adminGate, Banner, flagOf } from "../adminShell";
import { listingsForTenant } from "@/lib/admin";
import { setListingStatusAction, togglePlacementAction } from "../actions";

export const metadata: Metadata = { title: "Listings", robots: { index: false, follow: false } };

export default async function AdminBusinessesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const gate = await adminGate();
  if (!gate.ok) return gate.render(null);

  const [rows, sp] = await Promise.all([listingsForTenant(gate.tenant.id), searchParams]);

  return gate.render(
    <>
      <a href="/admin" className="text-sm opacity-70 hover:opacity-100">← Admin</a>
      <h1 className="font-heading mt-2 text-2xl font-semibold tracking-tight">Listings &amp; placement</h1>
      <p className="mt-1 text-sm opacity-70">Approve, suspend, feature and sponsor listings on {gate.tenant.name}.</p>
      {flagOf(sp, "done") && <Banner tone="ok">Updated.</Banner>}
      {flagOf(sp, "error") && <Banner tone="error">{flagOf(sp, "error")}</Banner>}

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[46rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-black/10 text-left text-xs uppercase tracking-wide opacity-60">
              <th className="py-2 pr-3">Business</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 pr-3">Placement</th>
              <th className="py-2 pr-3">Flags</th>
              <th className="py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.placementId} className="border-b border-black/[0.06] align-top">
                <td className="py-3 pr-3">
                  <a href={`/listing/${b.slug}`} className="font-medium hover:underline">{b.tradingName}</a>
                  <div className="text-xs opacity-50">{b.isCanonical ? "canonical" : "syndicated"} · {b.claimState.toLowerCase()}</div>
                </td>
                <td className="py-3 pr-3">{b.status.replace("_", " ").toLowerCase()}</td>
                <td className="py-3 pr-3">
                  {b.placementStatus.toLowerCase()}
                  {b.placementStatus !== "APPROVED" && (
                    <form action={togglePlacementAction.bind(null, b.placementId)} className="mt-1">
                      <input type="hidden" name="field" value="approve" />
                      <button className="text-xs underline" style={{ color: "var(--primary)" }}>Approve placement</button>
                    </form>
                  )}
                </td>
                <td className="py-3 pr-3">
                  <div className="flex flex-col gap-1">
                    <PlacementToggle placementId={b.placementId} field="featured" label="Featured" value={b.isFeatured} />
                    <PlacementToggle placementId={b.placementId} field="sponsored" label="Sponsored" value={b.isSponsored} />
                  </div>
                </td>
                <td className="py-3">
                  <div className="flex flex-wrap gap-1.5">
                    {b.status !== "ACTIVE" && (
                      <StatusButton businessId={b.id} status="ACTIVE" label="Approve" primary />
                    )}
                    {b.status !== "SUSPENDED" && <StatusButton businessId={b.id} status="SUSPENDED" label="Suspend" />}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function PlacementToggle({ placementId, field, label, value }: { placementId: string; field: string; label: string; value: boolean }) {
  return (
    <form action={togglePlacementAction.bind(null, placementId)} className="flex items-center gap-1.5">
      <input type="hidden" name="field" value={field} />
      <input type="hidden" name="value" value={value ? "false" : "true"} />
      <button className={`rounded px-2 py-0.5 text-xs ${value ? "text-white" : "border border-black/10"}`} style={value ? { backgroundColor: "var(--primary)" } : undefined}>
        {label}: {value ? "on" : "off"}
      </button>
    </form>
  );
}

function StatusButton({ businessId, status, label, primary }: { businessId: string; status: string; label: string; primary?: boolean }) {
  return (
    <form action={setListingStatusAction.bind(null, businessId, status)}>
      <button
        className={`rounded-lg px-3 py-1.5 text-xs font-medium ${primary ? "text-white" : "border border-black/10 transition hover:bg-black/[0.03]"}`}
        style={primary ? { backgroundColor: "var(--primary)" } : undefined}
      >
        {label}
      </button>
    </form>
  );
}
