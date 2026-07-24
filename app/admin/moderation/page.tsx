import type { Metadata } from "next";
import { adminGate, Banner, flagOf } from "../adminShell";
import { pendingModeration } from "@/lib/admin";
import { resolveReportAction } from "../actions";

export const metadata: Metadata = { title: "Moderation", robots: { index: false, follow: false } };

const REASON_LABELS: Record<string, string> = {
  edit_review: "Owner edit — re-approval needed",
  suggested_edit: "Suggested edit",
  incorrect_info: "Reported: incorrect info",
  closed_down: "Reported: closed down",
  inappropriate_content: "Reported: inappropriate content",
  duplicate_listing: "Reported: duplicate",
  spam: "Reported: spam",
  other: "Reported: other",
};

export default async function ModerationQueuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const gate = await adminGate();
  if (!gate.ok) return gate.render(null);

  const [rows, sp] = await Promise.all([pendingModeration(gate.tenant.id), searchParams]);

  return gate.render(
    <>
      <a href="/admin" className="text-sm opacity-70 hover:opacity-100">← Admin</a>
      <h1 className="font-heading mt-2 text-2xl font-semibold tracking-tight">Moderation queue</h1>
      {flagOf(sp, "done") && <Banner tone="ok">Done.</Banner>}
      {flagOf(sp, "error") && <Banner tone="error">{flagOf(sp, "error")}</Banner>}

      {rows.length === 0 ? (
        <p className="mt-6 rounded-xl border border-black/[0.07] bg-white p-8 text-center text-sm opacity-60">
          Nothing awaiting moderation.
        </p>
      ) : (
        <ul className="mt-6 space-y-4">
          {rows.map((r) => (
            <li key={r.id} className="rounded-xl border border-black/[0.07] bg-white p-5 shadow-[0_1px_2px_rgba(48,43,39,0.04)]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--primary)" }}>
                    {REASON_LABELS[r.reason] ?? r.reason}
                  </span>
                  <h2 className="mt-1 font-semibold">
                    <a href={`/listing/${r.businessSlug}`} className="hover:underline">{r.businessName}</a>
                    <span className="ml-2 text-xs font-normal opacity-50">({r.businessStatus.replace("_", " ").toLowerCase()})</span>
                  </h2>
                  {r.detail && <p className="mt-1 text-sm opacity-75">{r.detail}</p>}
                  {r.reporterEmail && <p className="mt-0.5 text-xs opacity-50">Reported by {r.reporterEmail}</p>}
                </div>
              </div>
              <div className="mt-4 flex gap-2 border-t border-black/[0.06] pt-4">
                <form action={resolveReportAction.bind(null, r.id, "approve")}>
                  <button className="rounded-lg px-4 py-2 text-sm font-medium text-white" style={{ backgroundColor: "var(--primary)" }}>
                    {r.reason === "edit_review" ? "Approve & publish" : "Mark valid & resolve"}
                  </button>
                </form>
                <form action={resolveReportAction.bind(null, r.id, "dismiss")}>
                  <button className="rounded-lg border border-black/10 px-4 py-2 text-sm font-medium transition hover:bg-black/[0.03]">
                    Dismiss
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
