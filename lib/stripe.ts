// Stripe client, initialised lazily from STRIPE_SECRET_KEY. Same "works
// without it configured" posture as the mailer/storage adapters: billing is
// intrinsically external, so when no key is set, isBillingConfigured() is
// false and the UI shows "billing not configured" instead of a broken
// checkout button — never a fake success.

import Stripe from "stripe";

let client: Stripe | null = null;

export function isBillingConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set — billing is not configured in this environment.");
  }
  if (!client) {
    // No apiVersion pin: the SDK's types track one exact version string and
    // pinning a different one is a type error on every SDK bump. Let it use
    // the account's configured version.
    client = new Stripe(key);
  }
  return client;
}

export function stripeWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not set — cannot verify webhook signatures.");
  return secret;
}
