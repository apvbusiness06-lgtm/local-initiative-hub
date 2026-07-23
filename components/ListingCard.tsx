import type { SearchHit } from "@/lib/search";

export function ListingCard({ hit, sponsored }: { hit: SearchHit; sponsored?: boolean }) {
  const miles = hit.distanceMeters != null ? hit.distanceMeters / 1609.34 : null;

  return (
    <article className="rounded-xl border border-black/[0.07] bg-white p-5 shadow-[0_1px_2px_rgba(48,43,39,0.04)] transition hover:shadow-[0_4px_16px_rgba(48,43,39,0.08)]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">
            <a href={`/listing/${hit.slug}`} className="hover:underline">
              {hit.tradingName}
            </a>
          </h2>
          {hit.summary && <p className="mt-1 line-clamp-2 text-sm opacity-75">{hit.summary}</p>}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {sponsored && (
            // Disclosure is required and must not be visually suppressed.
            <span className="rounded border border-black/10 px-2 py-0.5 text-[11px] uppercase tracking-wider opacity-70">
              Sponsored
            </span>
          )}
          {hit.verified && (
            <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: "var(--primary)" }}>
              ✓ Verified
            </span>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm opacity-70">
        {hit.avgRating != null && hit.reviewCount > 0 && (
          <span>
            {hit.avgRating.toFixed(1)} ★{" "}
            <span className="opacity-70">
              ({hit.reviewCount} {hit.reviewCount === 1 ? "review" : "reviews"})
            </span>
          </span>
        )}
        {miles != null && <span>{miles.toFixed(1)} miles away</span>}
      </div>
    </article>
  );
}
