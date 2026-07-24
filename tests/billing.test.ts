// Slice 9 acceptance:
//   - a replayed webhook is a no-op (idempotency keyed on event.id);
//   - cancelling downgrades entitlements;
//   - a usage limit is enforced in the action layer (UI bypassed).
// Drives processStripeEvent() with synthetic Stripe event objects — no live
// Stripe needed; the route's signature check is separate and unit-covered by
// Stripe's own SDK.
import { afterEach, afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { generateRawToken } from "@/lib/auth/tokens";
import { processStripeEvent } from "@/lib/billing";
import { getActivePlan, entitled, withinLimit, recordUsage } from "@/lib/entitlements";

const prisma = new PrismaClient();

let businessId: string;
let premiumPlanId: string;

function checkoutEvent(eventId: string, over: Record<string, unknown> = {}) {
  return {
    id: eventId,
    type: "checkout.session.completed",
    data: {
      object: {
        object: "checkout.session",
        client_reference_id: businessId,
        // No live subscription id, so activateFromCheckout falls back to
        // ACTIVE with no period — exactly the resilient path we want tested.
        subscription: null,
        customer: "cus_test_123",
        metadata: { businessId, planId: premiumPlanId },
        ...over,
      },
    },
  } as unknown as Parameters<typeof processStripeEvent>[0];
}

function subUpdatedEvent(eventId: string, stripeSubId: string, status: string) {
  return {
    id: eventId,
    type: "customer.subscription.updated",
    data: { object: { object: "subscription", id: stripeSubId, status, metadata: {} } },
  } as unknown as Parameters<typeof processStripeEvent>[0];
}

beforeEach(async () => {
  premiumPlanId = (await prisma.plan.findFirstOrThrow({ where: { tenantId: null, key: "premium" } })).id;
  const suffix = generateRawToken().slice(0, 8).toLowerCase();
  businessId = (
    await prisma.business.create({
      data: { slug: `billing-test-${suffix}`, tradingName: `Billing ${suffix}`, status: "ACTIVE", sourceKind: "test" },
    })
  ).id;
});

afterEach(async () => {
  await prisma.featureUsage.deleteMany({ where: { subscription: { businessId } } });
  await prisma.subscription.deleteMany({ where: { businessId } });
  await prisma.business.deleteMany({ where: { id: businessId } });
});

afterAll(async () => {
  await prisma.stripeWebhookEvent.deleteMany({ where: { eventId: { startsWith: "evt_test_" } } });
  await prisma.$disconnect();
});

describe("entitlements activate only from webhook state", () => {
  it("before any webhook, the business is on the free plan", async () => {
    const plan = await getActivePlan(businessId);
    expect(plan.key).toBe("free");
    expect(await entitled(businessId, "featured.placement")).toBe(false);
  });

  it("checkout.session.completed activates the premium plan + its entitlements", async () => {
    const res = await processStripeEvent(checkoutEvent("evt_test_" + generateRawToken().slice(0, 10)));
    expect(res).toMatchObject({ handled: true, duplicate: false });

    const plan = await getActivePlan(businessId);
    expect(plan.key).toBe("premium");
    expect(await entitled(businessId, "featured.placement")).toBe(true);
  });
});

describe("webhook idempotency", () => {
  it("a replayed event (same id) is a no-op", async () => {
    const id = "evt_test_" + generateRawToken().slice(0, 10);
    const first = await processStripeEvent(checkoutEvent(id));
    expect(first).toMatchObject({ handled: true, duplicate: false });

    const replay = await processStripeEvent(checkoutEvent(id));
    expect(replay).toMatchObject({ duplicate: true });

    // Exactly one subscription row, not two.
    expect(await prisma.subscription.count({ where: { businessId } })).toBe(1);
  });
});

describe("cancellation downgrades entitlements", () => {
  it("a canceled subscription reverts to the free entitlement set", async () => {
    await processStripeEvent(checkoutEvent("evt_test_" + generateRawToken().slice(0, 10)));
    // Attach a stripe subscription id so the update event can find the row.
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { businessId } });
    await prisma.subscription.update({ where: { id: sub.id }, data: { stripeSubscriptionId: "sub_test_cancel" } });
    expect(await entitled(businessId, "featured.placement")).toBe(true);

    await processStripeEvent(subUpdatedEvent("evt_test_" + generateRawToken().slice(0, 10), "sub_test_cancel", "canceled"));

    const plan = await getActivePlan(businessId);
    expect(plan.key).toBe("free");
    expect(await entitled(businessId, "featured.placement")).toBe(false);
  });
});

describe("usage limit enforced in the action layer", () => {
  it("withinLimit blocks once the plan's monthly limit is reached", async () => {
    // premium: offers.monthly_limit = 10 in the seed.
    await processStripeEvent(checkoutEvent("evt_test_" + generateRawToken().slice(0, 10)));

    let check = await withinLimit(businessId, "offers.monthly_limit");
    expect(check.limit).toBe(10);
    expect(check.allowed).toBe(true);

    for (let i = 0; i < 10; i++) await recordUsage(businessId, "offers.monthly_limit");

    check = await withinLimit(businessId, "offers.monthly_limit");
    expect(check.used).toBe(10);
    expect(check.allowed).toBe(false);
  });

  it("a feature the plan doesn't define is denied, not treated as unlimited", async () => {
    const check = await withinLimit(businessId, "nonexistent.feature");
    expect(check.allowed).toBe(false);
    expect(check.limit).toBe(0);
  });
});
