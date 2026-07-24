// Stripe webhook endpoint. Two non-negotiables (Slice 9 acceptance):
//   1. Signature verification — the raw body is checked against
//      STRIPE_WEBHOOK_SECRET before we trust a single field. An unsigned or
//      forged request is rejected with 400, so nobody can activate a plan by
//      POSTing a fake "checkout completed".
//   2. Idempotency — processStripeEvent claims event.id in a unique table;
//      a replayed delivery is a no-op.

import { NextRequest, NextResponse } from "next/server";
import { getStripe, stripeWebhookSecret, isBillingConfigured } from "@/lib/stripe";
import { processStripeEvent } from "@/lib/billing";

// Stripe needs the raw, unparsed body to verify the signature.
export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isBillingConfigured()) {
    return NextResponse.json({ error: "Billing not configured" }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const rawBody = await request.text();

  let event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, stripeWebhookSecret());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid signature";
    return NextResponse.json({ error: `Webhook signature verification failed: ${message}` }, { status: 400 });
  }

  try {
    const result = await processStripeEvent(event);
    return NextResponse.json({ received: true, ...result });
  } catch (err) {
    // Return 500 so Stripe retries; the idempotency guard makes retries safe.
    const message = err instanceof Error ? err.message : "processing error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
