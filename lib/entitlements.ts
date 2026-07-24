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
