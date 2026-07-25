// Slice 11 — reviews. Two sources, one inbox, honest aggregation:
//   - First-party reviews are submitted by signed-in users, rate-limited, and
//     land in moderation (PENDING) before they show. No gating — we never
//     solicit only happy customers, and we never fabricate.
//   - Provider reviews (Google Business Profile, etc.) sync behind a
//     ReviewProvider interface. Dedup is STRUCTURAL: the unique key
//     (provider, providerAccountId, providerReviewId) means re-syncing the
//     same payload can never create a duplicate, regardless of app logic.
//
// Aggregate scores are computed per source and combined only across matching
// rating scales — a 5-star average and a 10-point average are never mixed.

import { PrismaClient, type ReviewProvider as Provider } from "@prisma/client";

const prisma = new PrismaClient();

// ── First-party submission ───────────────────────────────────
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_REVIEWS_PER_WINDOW = 5;

export type SubmitResult =
  | { ok: true; moderation: "pending" }
  | { ok: false; error: string };

export async function submitFirstPartyReview(input: {
  businessId: string;
  userId: string;
  rating: number;
  title?: string;
  body?: string;
  authorName?: string;
}): Promise<SubmitResult> {
  const rating = Math.round(input.rating);
  if (rating < 1 || rating > 5) return { ok: false, error: "Rating must be between 1 and 5 stars." };

  // One first-party review per user per business.
  const existing = await prisma.review.findFirst({
    where: { businessId: input.businessId, userId: input.userId, provider: "FIRST_PARTY" },
  });
  if (existing) return { ok: false, error: "You've already reviewed this business." };

  // Global per-user rate limit across all businesses.
  const recent = await prisma.review.count({
    where: { userId: input.userId, provider: "FIRST_PARTY", createdAt: { gt: new Date(Date.now() - RATE_WINDOW_MS) } },
  });
  if (recent >= MAX_REVIEWS_PER_WINDOW) {
    return { ok: false, error: "You're posting reviews too quickly — try again later." };
  }

  await prisma.review.create({
    data: {
      businessId: input.businessId,
      provider: "FIRST_PARTY",
      userId: input.userId,
      rating,
      ratingScaleMax: 5,
      title: input.title?.trim().slice(0, 140) || null,
      body: input.body?.trim().slice(0, 4000) || null,
      authorName: input.authorName?.trim().slice(0, 120) || null,
      reviewedAt: new Date(),
      moderationState: "PENDING", // never visible until an admin approves
    },
  });
  return { ok: true, moderation: "pending" };
}

// ── Provider sync (dedup + reconnect) ────────────────────────
export interface NormalizedReview {
  providerReviewId: string;
  rating: number;
  ratingScaleMax: number;
  title?: string | null;
  body?: string | null;
  authorName?: string | null;
  reviewedAt: Date;
  sourceUrl?: string | null;
}

export interface ReviewProvider {
  readonly key: Provider;
  /** Fetch reviews for a connected account. Throws TokenExpiredError if the OAuth token has expired. */
  fetchReviews(connection: ProviderConnection): Promise<NormalizedReview[]>;
}

export interface ProviderConnection {
  id: string;
  externalAccountId: string | null;
  tokenExpiresAt: Date | null;
}

export class TokenExpiredError extends Error {
  constructor() {
    super("Provider token expired");
    this.name = "TokenExpiredError";
  }
}

export type SyncResult =
  | { ok: true; fetched: number; created: number; duplicates: number }
  | { ok: false; reason: "reconnect_required" | "error"; message: string };

/**
 * Incremental sync. Upserts on the unique (provider, account, providerReviewId)
 * key, so the second sync of the same payload creates zero rows. If the
 * connection's token has expired, returns reconnect_required rather than
 * failing silently — the UI surfaces a reconnect action.
 */
export async function syncProviderReviews(
  businessId: string,
  provider: ReviewProvider,
  connection: ProviderConnection
): Promise<SyncResult> {
  if (connection.tokenExpiresAt && connection.tokenExpiresAt.getTime() < Date.now()) {
    return { ok: false, reason: "reconnect_required", message: "Reconnect your account to resume review sync." };
  }

  const run = await prisma.reviewSyncRun.create({ data: { connectionId: connection.id } });

  let fetched: NormalizedReview[];
  try {
    fetched = await provider.fetchReviews(connection);
  } catch (e) {
    if (e instanceof TokenExpiredError) {
      await prisma.reviewSyncRun.update({
        where: { id: run.id },
        data: { finishedAt: new Date(), errorMessage: "token_expired" },
      });
      return { ok: false, reason: "reconnect_required", message: "Reconnect your account to resume review sync." };
    }
    const message = e instanceof Error ? e.message : "sync error";
    await prisma.reviewSyncRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), errorMessage: message } });
    return { ok: false, reason: "error", message };
  }

  // A connected account always has an id; normalise null to "" so the
  // compound-unique key is a stable non-null string used identically in the
  // lookup and the write (Prisma types nullable columns in a compound unique
  // key as non-null, and NULLs wouldn't dedup anyway).
  const accountId = connection.externalAccountId ?? "";

  let created = 0;
  let duplicates = 0;
  for (const r of fetched) {
    // Structural dedup: this composite key is unique, so the same payload
    // upserts onto the same row every time.
    const before = await prisma.review.findUnique({
      where: {
        provider_providerAccountId_providerReviewId: {
          provider: provider.key,
          providerAccountId: accountId,
          providerReviewId: r.providerReviewId,
        },
      },
    });
    await prisma.review.upsert({
      where: {
        provider_providerAccountId_providerReviewId: {
          provider: provider.key,
          providerAccountId: accountId,
          providerReviewId: r.providerReviewId,
        },
      },
      update: { rating: r.rating, title: r.title ?? null, body: r.body ?? null, syncedAt: new Date() },
      create: {
        businessId,
        provider: provider.key,
        providerAccountId: accountId,
        providerReviewId: r.providerReviewId,
        rating: r.rating,
        ratingScaleMax: r.ratingScaleMax,
        title: r.title ?? null,
        body: r.body ?? null,
        authorName: r.authorName ?? null,
        reviewedAt: r.reviewedAt,
        sourceUrl: r.sourceUrl ?? null,
        // Provider reviews are already public on the source; show them.
        moderationState: "APPROVED",
        syncedAt: new Date(),
      },
    });
    if (before) duplicates++;
    else created++;
  }

  await prisma.reviewSyncRun.update({
    where: { id: run.id },
    data: { finishedAt: new Date(), fetched: fetched.length, created, duplicates },
  });
  return { ok: true, fetched: fetched.length, created, duplicates };
}

// ── Aggregation (per source, combined only across matching scales) ──
export interface SourceAggregate {
  provider: Provider;
  scaleMax: number;
  average: number;
  count: number;
}

export async function aggregatesByProvider(businessId: string): Promise<SourceAggregate[]> {
  const grouped = await prisma.review.groupBy({
    by: ["provider", "ratingScaleMax"],
    where: { businessId, moderationState: "APPROVED" },
    _avg: { rating: true },
    _count: true,
  });
  return grouped.map((g) => ({
    provider: g.provider,
    scaleMax: g.ratingScaleMax,
    average: Number((g._avg.rating ?? 0).toFixed(2)),
    count: g._count,
  }));
}

/** A combined average only across a single rating scale (default 5-star). */
export async function combinedScore(businessId: string, scaleMax = 5): Promise<{ average: number; count: number } | null> {
  const agg = await prisma.review.aggregate({
    where: { businessId, moderationState: "APPROVED", ratingScaleMax: scaleMax },
    _avg: { rating: true },
    _count: true,
  });
  if (agg._count === 0) return null;
  return { average: Number((agg._avg.rating ?? 0).toFixed(2)), count: agg._count };
}

// ── Mock provider (sandbox, clearly labelled) ────────────────
// Used when no real Google OAuth is configured, so the sync path is
// exercisable in dev. Its reviews are obviously sample data — never passed
// off as real, per the no-fabrication rule.
export class MockGoogleProvider implements ReviewProvider {
  readonly key: Provider = "GOOGLE";
  constructor(private readonly payload: NormalizedReview[]) {}
  async fetchReviews(): Promise<NormalizedReview[]> {
    return this.payload;
  }
}
