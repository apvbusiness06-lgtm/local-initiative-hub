// Entitlements are data (Plan/PlanFeature), not code branches — every render
// decision here reads the plan actually in force, never a hardcoded tier
// check. This is groundwork for Slice 9 (Stripe): until checkout exists, no
// business has a Subscription row, so everything resolves to the seeded
// "free" plan template, which is the correct default, not a special case.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const FALLBACK_PLAN_KEY = "free";

export interface ResolvedPlan {
  id: string;
  key: string;
  name: string;
}

export async function getActivePlan(businessId: string): Promise<ResolvedPlan> {
  const subscription = await prisma.subscription.findUnique({
    where: { businessId },
    include: { plan: true },
  });
  if (subscription && (subscription.status === "ACTIVE" || subscription.status === "TRIALING")) {
    return { id: subscription.plan.id, key: subscription.plan.key, name: subscription.plan.name };
  }

  const freePlan = await prisma.plan.findFirst({ where: { tenantId: null, key: FALLBACK_PLAN_KEY } });
  if (!freePlan) throw new Error(`No "${FALLBACK_PLAN_KEY}" plan template seeded`);
  return { id: freePlan.id, key: freePlan.key, name: freePlan.name };
}

export async function entitled(businessId: string, featureKey: string): Promise<boolean> {
  const plan = await getActivePlan(businessId);
  const feature = await prisma.planFeature.findUnique({
    where: { planId_featureKey: { planId: plan.id, featureKey } },
  });
  if (!feature) return false;
  return feature.valueType === "BOOLEAN" ? feature.boolValue === true : (feature.limitValue ?? 0) > 0;
}

/** Null means the feature isn't defined on this plan — treat as "none", not "unlimited". */
export async function featureLimit(businessId: string, featureKey: string): Promise<number | null> {
  const plan = await getActivePlan(businessId);
  const feature = await prisma.planFeature.findUnique({
    where: { planId_featureKey: { planId: plan.id, featureKey } },
  });
  return feature?.limitValue ?? null;
}

function currentPeriodStart(resetPeriod: string | null | undefined): Date {
  const now = new Date();
  if (resetPeriod === "year") return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  // Default to a monthly window; absolute limits (no reset) use epoch so the
  // usage row is a single running counter.
  if (resetPeriod === "month" || resetPeriod == null) {
    return resetPeriod === "month"
      ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
      : new Date(0);
  }
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export interface LimitCheck {
  allowed: boolean;
  limit: number | null;
  used: number;
}

/**
 * Usage-based limit check for the current reset window (e.g.
 * offers.monthly_limit). Enforced in the action layer — reads the plan's
 * limit and the FeatureUsage counter for this period. A feature the plan
 * doesn't define is denied (allowed:false, limit:0), not treated as unlimited.
 */
export async function withinLimit(businessId: string, featureKey: string): Promise<LimitCheck> {
  const plan = await getActivePlan(businessId);
  const feature = await prisma.planFeature.findUnique({
    where: { planId_featureKey: { planId: plan.id, featureKey } },
  });
  if (!feature || feature.limitValue == null) return { allowed: false, limit: 0, used: 0 };

  const subscription = await prisma.subscription.findUnique({ where: { businessId } });
  if (!subscription) {
    // No subscription row => running on the free template; count is only
    // meaningful once a subscription exists, so treat as unused.
    return { allowed: feature.limitValue > 0, limit: feature.limitValue, used: 0 };
  }

  const periodStart = currentPeriodStart(feature.resetPeriod);
  const usage = await prisma.featureUsage.findUnique({
    where: { subscriptionId_featureKey_periodStart: { subscriptionId: subscription.id, featureKey, periodStart } },
  });
  const used = usage?.used ?? 0;
  return { allowed: used < feature.limitValue, limit: feature.limitValue, used };
}

/** Increment usage for the current window. Call after a successful action. */
export async function recordUsage(businessId: string, featureKey: string): Promise<void> {
  const subscription = await prisma.subscription.findUnique({ where: { businessId } });
  if (!subscription) return; // free template has no usage rows to track
  const plan = await getActivePlan(businessId);
  const feature = await prisma.planFeature.findUnique({
    where: { planId_featureKey: { planId: plan.id, featureKey } },
  });
  const periodStart = currentPeriodStart(feature?.resetPeriod);
  await prisma.featureUsage.upsert({
    where: { subscriptionId_featureKey_periodStart: { subscriptionId: subscription.id, featureKey, periodStart } },
    update: { used: { increment: 1 } },
    create: { subscriptionId: subscription.id, featureKey, periodStart, used: 1 },
  });
}
