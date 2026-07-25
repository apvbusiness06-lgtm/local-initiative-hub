// Slice 9 — plans, checkout, and the webhook processor that is the ONLY
// thing that activates entitlements. The Checkout success redirect is
// cosmetic ("we're setting up your plan"); a business becomes entitled only
// when a signature-verified webhook writes its Subscription row here. That's
// the "activate from verified webhook state, never the redirect URL"
// requirement — a user can't self-upgrade by hitting the success URL.

import { PrismaClient, type SubscriptionStatus } from "@prisma/client";
import type Stripe from "stripe";
import { getStripe } from "./stripe";

const prisma = new PrismaClient();

// Stripe's SDK types relocate a few fields between API versions (period dates
// moved under items; Invoice.subscription comes and goes). These fields are
// stable in the webhook JSON regardless, so read them through narrow
// accessors rather than chasing the SDK's type shape on every bump.
function periodDates(sub: Stripe.Subscription): { start: Date | null; end: Date | null } {
  const s = sub as unknown as { current_period_start?: number; current_period_end?: number };
  return {
    start: s.current_period_start ? new Date(s.current_period_start * 1000) : null,
    end: s.current_period_end ? new Date(s.current_period_end * 1000) : null,
  };
}

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | undefined {
  const sub = (invoice as unknown as { subscription?: string | { id: string } | null }).subscription;
  return typeof sub === "string" ? sub : sub?.id;
}

export type BillingInterval = "monthly" | "yearly";

// Stripe subscription status -> our enum. Anything not active/trialing means
// the free entitlement set applies (getActivePlan only counts ACTIVE/TRIALING).
function mapStatus(stripeStatus: string): SubscriptionStatus {
  switch (stripeStatus) {
    case "active":
      return "ACTIVE";
    case "trialing":
      return "TRIALING";
    case "past_due":
    case "unpaid":
      return "PAST_DUE";
    case "canceled":
      return "CANCELLED";
    case "incomplete_expired":
      return "CANCELLED";
    default:
      return "INCOMPLETE";
  }
}

export interface CheckoutInput {
  businessId: string;
  planKey: string;
  interval: BillingInterval;
  origin: string; // https://host — for success/cancel URLs
}

export async function createCheckoutSession(input: CheckoutInput): Promise<{ url: string } | { error: string }> {
  const plan = await prisma.plan.findFirst({ where: { tenantId: null, key: input.planKey, isActive: true } });
  if (!plan) return { error: "Unknown plan" };

  const priceId = input.interval === "yearly" ? plan.stripePriceIdYearly : plan.stripePriceIdMonthly;
  if (!priceId) return { error: "This plan isn't available for online purchase yet." };

  const business = await prisma.business.findUnique({ where: { id: input.businessId } });
  if (!business) return { error: "Business not found" };

  const existing = await prisma.subscription.findUnique({ where: { businessId: input.businessId } });

  const session = await getStripe().checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    // client_reference_id + metadata both carry the business so the webhook
    // can attribute the subscription regardless of which field survives.
    client_reference_id: input.businessId,
    ...(existing?.stripeCustomerId ? { customer: existing.stripeCustomerId } : {}),
    subscription_data: { metadata: { businessId: input.businessId, planId: plan.id } },
    metadata: { businessId: input.businessId, planId: plan.id },
    success_url: `${input.origin}/portal/${input.businessId}/billing?checkout=processing`,
    cancel_url: `${input.origin}/portal/${input.businessId}/billing?checkout=cancelled`,
  });

  return session.url ? { url: session.url } : { error: "Stripe did not return a checkout URL" };
}

export async function createBillingPortalSession(businessId: string, origin: string): Promise<{ url: string } | { error: string }> {
  const subscription = await prisma.subscription.findUnique({ where: { businessId } });
  if (!subscription?.stripeCustomerId) return { error: "No billing account yet." };
  const session = await getStripe().billingPortal.sessions.create({
    customer: subscription.stripeCustomerId,
    return_url: `${origin}/portal/${businessId}/billing`,
  });
  return { url: session.url };
}

// ── Webhook processing (idempotent) ──────────────────────────
export interface ProcessResult {
  handled: boolean;
  duplicate: boolean;
  note?: string;
}

/**
 * Idempotent by event.id: the first thing we do is claim the event id in
 * stripe_webhook_events (unique). A replayed delivery hits the unique
 * constraint and returns duplicate:true without re-applying anything.
 */
export async function processStripeEvent(event: Stripe.Event): Promise<ProcessResult> {
  try {
    await prisma.stripeWebhookEvent.create({ data: { eventId: event.id, type: event.type } });
  } catch {
    // Unique violation => already processed.
    return { handled: false, duplicate: true };
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      await activateFromCheckout(session);
      return { handled: true, duplicate: false };
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      await syncSubscription(sub);
      return { handled: true, duplicate: false };
    }
    case "invoice.paid":
    case "invoice.payment_succeeded": {
      const invoice = event.data.object as Stripe.Invoice;
      await recordInvoice(invoice);
      return { handled: true, duplicate: false };
    }
    default:
      return { handled: false, duplicate: false, note: `Unhandled type ${event.type}` };
  }
}

async function activateFromCheckout(session: Stripe.Checkout.Session): Promise<void> {
  const businessId = (session.metadata?.businessId as string) || (session.client_reference_id ?? undefined);
  const planId = session.metadata?.planId as string | undefined;
  if (!businessId || !planId) return;

  const stripeSubscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
  const stripeCustomerId = typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;

  // Pull the live subscription to get the authoritative status + period.
  let status: SubscriptionStatus = "ACTIVE";
  let periodStart: Date | null = null;
  let periodEnd: Date | null = null;
  if (stripeSubscriptionId) {
    try {
      const sub = await getStripe().subscriptions.retrieve(stripeSubscriptionId);
      status = mapStatus(sub.status);
      const period = periodDates(sub);
      periodStart = period.start;
      periodEnd = period.end;
    } catch {
      // Fall back to ACTIVE with no period if retrieval fails; a later
      // subscription.updated event will correct it.
    }
  }

  await prisma.subscription.upsert({
    where: { businessId },
    update: {
      planId,
      status,
      stripeCustomerId,
      stripeSubscriptionId,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
    },
    create: {
      businessId,
      planId,
      status,
      stripeCustomerId,
      stripeSubscriptionId,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
    },
  });
}

async function syncSubscription(sub: Stripe.Subscription): Promise<void> {
  const existing = await prisma.subscription.findUnique({ where: { stripeSubscriptionId: sub.id } });
  if (!existing) {
    // Try to attribute via metadata (e.g. a subscription created outside our
    // checkout). Without a businessId we can't safely apply it.
    const businessId = sub.metadata?.businessId as string | undefined;
    const planId = sub.metadata?.planId as string | undefined;
    if (!businessId || !planId) return;
    await prisma.subscription.upsert({
      where: { businessId },
      update: { planId, status: mapStatus(sub.status), stripeSubscriptionId: sub.id },
      create: { businessId, planId, status: mapStatus(sub.status), stripeSubscriptionId: sub.id },
    });
    return;
  }

  const period = periodDates(sub);
  await prisma.subscription.update({
    where: { id: existing.id },
    data: {
      status: mapStatus(sub.status),
      currentPeriodStart: period.start ?? existing.currentPeriodStart,
      currentPeriodEnd: period.end ?? existing.currentPeriodEnd,
      cancelledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : existing.cancelledAt,
    },
  });
}

async function recordInvoice(invoice: Stripe.Invoice): Promise<void> {
  const subId = invoiceSubscriptionId(invoice);
  if (!subId || !invoice.id) return;
  const subscription = await prisma.subscription.findUnique({ where: { stripeSubscriptionId: subId } });
  if (!subscription) return;

  await prisma.invoice.upsert({
    where: { stripeInvoiceId: invoice.id },
    update: { status: invoice.status ?? "paid" },
    create: {
      subscriptionId: subscription.id,
      stripeInvoiceId: invoice.id,
      amountMinor: invoice.amount_paid ?? invoice.total ?? 0,
      currency: (invoice.currency ?? "gbp").toUpperCase(),
      status: invoice.status ?? "paid",
      hostedUrl: invoice.hosted_invoice_url ?? null,
      issuedAt: invoice.created ? new Date(invoice.created * 1000) : new Date(),
    },
  });
}

// ── Billing overview for the portal ──────────────────────────
export interface BillingOverview {
  configured: boolean;
  currentPlanKey: string;
  currentPlanName: string;
  status: string | null;
  manageable: boolean;
  plans: { key: string; name: string; priceMinorMonthly: number; purchasable: boolean; current: boolean }[];
}

export async function getBillingOverview(businessId: string, billingConfigured: boolean): Promise<BillingOverview> {
  const [subscription, plans] = await Promise.all([
    prisma.subscription.findUnique({ where: { businessId }, include: { plan: true } }),
    prisma.plan.findMany({ where: { tenantId: null, isActive: true }, orderBy: { sortOrder: "asc" } }),
  ]);

  const active = subscription && (subscription.status === "ACTIVE" || subscription.status === "TRIALING");
  const currentPlanKey = active ? subscription!.plan.key : "free";

  return {
    configured: billingConfigured,
    currentPlanKey,
    currentPlanName: active ? subscription!.plan.name : (plans.find((p) => p.key === "free")?.name ?? "Free Listing"),
    status: subscription?.status ?? null,
    manageable: !!subscription?.stripeCustomerId,
    plans: plans.map((p) => ({
      key: p.key,
      name: p.name,
      priceMinorMonthly: p.priceMinorMonthly,
      purchasable: billingConfigured && !!p.stripePriceIdMonthly && p.key !== "free",
      current: p.key === currentPlanKey,
    })),
  };
}
