// Slice 13: analytics bot filtering, rollups, honest CTA labels, and content
// revisions / scheduled publishing.
import { afterEach, afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { generateRawToken } from "@/lib/auth/tokens";
import { isLikelyBot, recordEvent, rollupDay, businessDashboard, EVENT } from "@/lib/analytics";
import { saveContentRevision, publishDueScheduled } from "@/lib/content";
import { withTenant } from "@/lib/tenant";

const prisma = new PrismaClient();

let businessId: string;
let tenantId: string;

beforeEach(async () => {
  tenantId = (await prisma.tenant.findUniqueOrThrow({ where: { slug: "hampshire" } })).id;
  const suffix = generateRawToken().slice(0, 8).toLowerCase();
  businessId = (
    await prisma.business.create({
      data: { slug: `an-biz-${suffix}`, tradingName: `An ${suffix}`, status: "ACTIVE", sourceKind: "test" },
    })
  ).id;
});

afterEach(async () => {
  await prisma.dailyAnalyticsRollup.deleteMany({ where: { businessId } });
  // analytics_events carries RLS — delete within the tenant context.
  await withTenant(tenantId, (tx) => tx.analyticsEvent.deleteMany({ where: { businessId } }));
  await prisma.business.deleteMany({ where: { id: businessId } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("bot filtering", () => {
  it("flags common bot UAs and missing UA, allows a real browser", () => {
    expect(isLikelyBot("Googlebot/2.1")).toBe(true);
    expect(isLikelyBot("python-requests/2.31")).toBe(true);
    expect(isLikelyBot(null)).toBe(true);
    expect(isLikelyBot("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605")).toBe(false);
  });

  it("recordEvent drops bot traffic, keeps real traffic", async () => {
    await recordEvent({ eventKey: EVENT.PROFILE_VIEW, tenantId, businessId, userAgent: "Googlebot/2.1" });
    await recordEvent({ eventKey: EVENT.PROFILE_VIEW, tenantId, businessId, userAgent: "Mozilla/5.0 Safari/605" });
    const count = await withTenant(tenantId, (tx) => tx.analyticsEvent.count({ where: { businessId } }));
    expect(count).toBe(1);
  });
});

describe("rollups + dashboard read from rollups", () => {
  it("rolls up a day's events and the dashboard reflects the counts", async () => {
    for (let i = 0; i < 3; i++) await recordEvent({ eventKey: EVENT.PROFILE_VIEW, tenantId, businessId, userAgent: "Mozilla/5.0" });
    await recordEvent({ eventKey: EVENT.CTA_CALL_CLICK, tenantId, businessId, userAgent: "Mozilla/5.0" });

    const groups = await rollupDay(tenantId, new Date());
    expect(groups).toBeGreaterThanOrEqual(2);

    const dash = await businessDashboard(businessId, 30);
    const views = dash.find((m) => m.eventKey === "profile_view");
    const calls = dash.find((m) => m.eventKey === "cta_call_click");
    expect(views?.total).toBe(3);
    expect(calls?.total).toBe(1);
    // Honest label — a click is a click, never a "call".
    expect(calls?.label).toMatch(/click/i);
    expect(calls?.label).not.toMatch(/^Calls$/);
  });

  it("rollup is idempotent (re-running overwrites, not doubles)", async () => {
    await recordEvent({ eventKey: EVENT.PROFILE_VIEW, tenantId, businessId, userAgent: "Mozilla/5.0" });
    await rollupDay(tenantId, new Date());
    await rollupDay(tenantId, new Date());
    const dash = await businessDashboard(businessId, 30);
    expect(dash.find((m) => m.eventKey === "profile_view")?.total).toBe(1);
  });
});

describe("content revisions + scheduled publishing", () => {
  it("saveContentRevision versions edits and updates the working item", async () => {
    const suffix = generateRawToken().slice(0, 8).toLowerCase();
    const item = await prisma.contentItem.create({
      data: { slug: `rev-${suffix}`, kind: "BLOG", title: "V1", bodyBlocks: [], status: "DRAFT" },
    });

    const v1 = await saveContentRevision(item.id, null, { title: "V2", excerpt: null, bodyBlocks: [{ type: "paragraph", text: "hi" }] });
    const v2 = await saveContentRevision(item.id, null, { title: "V3", excerpt: null, bodyBlocks: [] });
    expect(v1).toBe(1);
    expect(v2).toBe(2);

    const updated = await prisma.contentItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(updated.title).toBe("V3");
    expect(await prisma.contentRevision.count({ where: { contentId: item.id } })).toBe(2);

    await prisma.contentRevision.deleteMany({ where: { contentId: item.id } });
    await prisma.contentItem.delete({ where: { id: item.id } });
  });

  it("publishDueScheduled publishes only items whose time has passed", async () => {
    const suffix = generateRawToken().slice(0, 8).toLowerCase();
    const past = await prisma.contentItem.create({
      data: { slug: `sch-past-${suffix}`, kind: "NEWS", title: "Due", bodyBlocks: [], status: "SCHEDULED", scheduledFor: new Date(Date.now() - 1000) },
    });
    const future = await prisma.contentItem.create({
      data: { slug: `sch-future-${suffix}`, kind: "NEWS", title: "Later", bodyBlocks: [], status: "SCHEDULED", scheduledFor: new Date(Date.now() + 86_400_000) },
    });

    const count = await publishDueScheduled();
    expect(count).toBeGreaterThanOrEqual(1);

    expect((await prisma.contentItem.findUniqueOrThrow({ where: { id: past.id } })).status).toBe("PUBLISHED");
    expect((await prisma.contentItem.findUniqueOrThrow({ where: { id: future.id } })).status).toBe("SCHEDULED");

    await prisma.contentItem.deleteMany({ where: { id: { in: [past.id, future.id] } } });
  });
});
