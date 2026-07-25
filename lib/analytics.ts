// Slice 13 — analytics. Events are bot-filtered on the way in and aggregated
// into daily rollups; the business dashboard reads ROLLUPS, never raw event
// scans. Event names describe the ACTION honestly: a CTA click is labelled a
// click ("cta_call_click"), never inflated into a confirmed call or sale.

import { PrismaClient, Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { withTenant } from "./tenant";

const prisma = new PrismaClient();

// Canonical event keys. Note the CTA keys say "click" — that's all we know.
export const EVENT = {
  PROFILE_VIEW: "profile_view",
  SEARCH_PERFORMED: "search_performed",
  CTA_CALL_CLICK: "cta_call_click",
  CTA_WEBSITE_CLICK: "cta_website_click",
  CTA_ENQUIRY_SUBMIT: "cta_enquiry_submit",
  OFFER_CLAIMED: "offer_claimed",
} as const;

const BOT_UA = /(bot|crawl|spider|slurp|bingpreview|facebookexternalhit|headless|python-requests|curl|wget|monitor|preview)/i;

export function isLikelyBot(userAgent: string | null | undefined): boolean {
  if (!userAgent) return true; // no UA at all is almost always automated
  return BOT_UA.test(userAgent);
}

export interface RecordEventInput {
  eventKey: string;
  tenantId: string; // analytics_events carries RLS; every event belongs to a tenant
  businessId?: string | null;
  userAgent?: string | null;
  sessionSeed?: string | null; // hashed, never stored raw (privacy)
  properties?: Prisma.InputJsonValue;
}

/**
 * Record an analytics event, dropping obvious bot traffic. Runs inside
 * withTenant so the RLS WITH CHECK on analytics_events passes. Fire-and-forget
 * safe: a failure never breaks the user action that triggered it.
 */
export async function recordEvent(input: RecordEventInput): Promise<void> {
  if (isLikelyBot(input.userAgent)) return;
  const sessionHash = input.sessionSeed ? createHash("sha256").update(input.sessionSeed).digest("base64url").slice(0, 22) : null;
  try {
    await withTenant(input.tenantId, (tx) =>
      tx.analyticsEvent.create({
        data: {
          eventKey: input.eventKey,
          tenantId: input.tenantId,
          businessId: input.businessId ?? null,
          sessionHash,
          properties: input.properties,
        },
      })
    );
  } catch {
    /* analytics must never break a user action */
  }
}

/**
 * Roll up a single tenant's day of raw events into DailyAnalyticsRollup, per
 * (business, eventKey). Runs inside withTenant so it reads that tenant's
 * events under RLS; the rollup table has no RLS so the writes go through the
 * same transaction. Idempotent: re-running the same day overwrites the counts.
 * The nightly job iterates active tenants.
 */
export async function rollupDay(tenantId: string, day: Date = new Date()): Promise<number> {
  const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  return withTenant(tenantId, async (tx) => {
    const grouped = await tx.analyticsEvent.groupBy({
      by: ["businessId", "eventKey"],
      where: { occurredAt: { gte: start, lt: end } },
      _count: true,
    });

    for (const g of grouped) {
      await tx.dailyAnalyticsRollup.upsert({
        where: {
          tenantId_businessId_day_eventKey: {
            tenantId,
            businessId: g.businessId ?? EMPTY_UUID,
            day: start,
            eventKey: g.eventKey,
          },
        },
        update: { count: g._count },
        create: { tenantId, businessId: g.businessId, day: start, eventKey: g.eventKey, count: g._count },
      });
    }
    return grouped.length;
  });
}

/** Roll up a day across every active tenant (nightly job helper). */
export async function rollupAllTenants(day: Date = new Date()): Promise<number> {
  const tenants = await prisma.tenant.findMany({ where: { status: "ACTIVE", deletedAt: null }, select: { id: true } });
  let total = 0;
  for (const t of tenants) total += await rollupDay(t.id, day);
  return total;
}

// The rollup unique key can't include NULLs meaningfully; a sentinel keeps the
// upsert deterministic for tenant-level (no specific business) rows.
const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";

export interface DashboardMetric {
  eventKey: string;
  label: string;
  total: number;
}

const METRIC_LABELS: Record<string, string> = {
  profile_view: "Profile views",
  cta_call_click: "Call button clicks",
  cta_website_click: "Website clicks",
  cta_enquiry_submit: "Enquiries submitted",
  offer_claimed: "Offers claimed",
};

/**
 * Business dashboard over the last N days, computed from ROLLUPS, not raw
 * events. Labels stay honest: "Call button clicks", never "Calls".
 */
export async function businessDashboard(businessId: string, days = 30): Promise<DashboardMetric[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await prisma.dailyAnalyticsRollup.groupBy({
    by: ["eventKey"],
    where: { businessId, day: { gte: since } },
    _sum: { count: true },
  });
  const byKey = new Map(rows.map((r) => [r.eventKey, r._sum.count ?? 0]));

  return Object.entries(METRIC_LABELS).map(([eventKey, label]) => ({
    eventKey,
    label,
    total: byKey.get(eventKey) ?? 0,
  }));
}
