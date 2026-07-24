import type { Metadata } from "next";
import { adminGate, Banner, flagOf } from "../adminShell";
import { pendingReviews } from "@/lib/admin";
import { moderateReviewAction } from "../actions";

export const metadata: Metadata = { title: "Review moderation", robots: { index: false, follow: false } };

export default async function AdminReviewsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const gate = await adminGate("reviews.moderate");
  if (!gate.ok) return gate.render(null);

  const [rows, sp] = await Promise.all([pendingReviews(gate.tenant.id), searchParams]);

  return gate.render(
    <>
      <a href="/admin" className="text-sm opacity-70 hover:opacity-100">← Admin</a>
      <h1 className="font-heading mt-2 text-2xl font-semibold tracking-tight">Review moderation</h1>
      <p className="mt-1 text-sm opacity-70">First-party reviews awaiting approval. No gating — approve genuine reviews regardless of rating.</p>
      {flagOf(sp, "done") && <Banner tone="ok">Done.</Banner>}
      {flagOf(sp, "error") && <Banner tone="error">{flagOf(sp, "error")}</Banner>}

      {rows.length === 0 ? (
        <p className="mt-6 rounded-xl border border-black/[0.07] bg-white p-8 text-center text-sm opacity-60">No reviews awaiting moderation.</p>
      ) : (
        <ul className="mt-6 space-y-4">
          {rows.map((r) => (
            <li key={r.id} className="rounded-xl border border-black/[0.07] bg-white p-5 shadow-[0_1px_2px_rgba(48,43,39,0.04)]">
              <div className="flex items-center justify-between text-sm">
                <a href={`/listing/${r.businessSlug}`} className="font-semibold hover:underline">{r.businessName}</a>
                <span className="opacity-70">{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</span>
              </div>
              <p className="mt-0.5 text-xs opacity-50">by {r.authorName ?? "anonymous"} · {r.provider.toLowerCase().replace("_", " ")}</p>
              {r.title && <p className="mt-2 text-sm font-medium">{r.title}</p>}
              {r.body && <p className="mt-1 text-sm opacity-75">{r.body}</p>}
              <div className="mt-4 flex gap-2 border-t border-black/[0.06] pt-4">
                <form action={moderateReviewAction.bind(null, r.id, "approve")}>
                  <button className="rounded-lg px-4 py-2 text-sm font-medium text-white" style={{ backgroundColor: "var(--primary)" }}>Approve</button>
                </form>
                <form action={moderateReviewAction.bind(null, r.id, "reject")}>
                  <button className="rounded-lg border border-black/10 px-4 py-2 text-sm font-medium transition hover:bg-black/[0.03]">Reject</button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
