// Slice 13 — newsletter + consent. UK GDPR/PECR: no marketing send happens
// without a matching, un-withdrawn ConsentRecord that captures purpose,
// channel, lawful basis and the EXACT wording version the person agreed to.
// Unsubscribe works from the emailed token with no login, and withdrawing
// consent blocks further sends immediately.
//
// NewsletterSubscription carries RLS (tenant isolation) so its reads/writes
// go through withTenant; ConsentRecord has no tenant column and uses the base
// client.

import { PrismaClient } from "@prisma/client";
import { withTenant } from "./tenant";
import { generateRawToken, hashRawToken } from "./auth/tokens";

const prisma = new PrismaClient();

export const NEWSLETTER_PURPOSE = "marketing_newsletter";
export const CURRENT_WORDING_VERSION = "2026-01";
export const CURRENT_WORDING_TEXT =
  "I agree to receive the Local Initiative newsletter by email and understand I can unsubscribe at any time.";

export interface SubscribeInput {
  tenantId: string;
  email: string;
  placeId?: string | null;
  interestCategoryIds?: string[];
  userId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export type SubscribeResult = { ok: true; unsubscribeToken: string } | { ok: false; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function subscribeToNewsletter(input: SubscribeInput): Promise<SubscribeResult> {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { ok: false, error: "Enter a valid email address." };

  const rawToken = generateRawToken();
  const tokenHash = hashRawToken(rawToken);

  await withTenant(input.tenantId, async (tx) => {
    const existing = await tx.newsletterSubscription.findFirst({ where: { tenantId: input.tenantId, email } });
    if (existing) {
      await tx.newsletterSubscription.update({
        where: { id: existing.id },
        data: {
          unsubscribedAt: null, // re-subscribe clears a prior opt-out
          confirmedAt: new Date(),
          placeId: input.placeId ?? existing.placeId,
          interestCategoryIds: input.interestCategoryIds ?? existing.interestCategoryIds,
        },
      });
    } else {
      await tx.newsletterSubscription.create({
        data: {
          tenantId: input.tenantId,
          userId: input.userId ?? null,
          email,
          placeId: input.placeId ?? null,
          interestCategoryIds: input.interestCategoryIds ?? [],
          confirmedAt: new Date(),
          unsubscribeTokenHash: tokenHash,
        },
      });
    }
  });

  // Consent record captures exactly what was agreed to, and supersedes any
  // prior withdrawal for this purpose/channel.
  await prisma.consentRecord.create({
    data: {
      userId: input.userId ?? null,
      email,
      purpose: NEWSLETTER_PURPOSE,
      channel: "EMAIL",
      lawfulBasis: "consent",
      wordingVersion: CURRENT_WORDING_VERSION,
      wordingText: CURRENT_WORDING_TEXT,
      grantedAt: new Date(),
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    },
  });

  return { ok: true, unsubscribeToken: rawToken };
}

export type UnsubscribeResult = { ok: true; email: string } | { ok: false; error: string };

/**
 * Unsubscribe from the emailed token — NO login required (acceptance
 * criterion). Marks the subscription unsubscribed and withdraws the consent
 * so marketing stops immediately.
 */
export async function unsubscribeByToken(tenantId: string, rawToken: string): Promise<UnsubscribeResult> {
  const tokenHash = hashRawToken(rawToken);

  const email = await withTenant(tenantId, async (tx) => {
    const sub = await tx.newsletterSubscription.findFirst({ where: { unsubscribeTokenHash: tokenHash } });
    if (!sub) return null;
    if (!sub.unsubscribedAt) {
      await tx.newsletterSubscription.update({ where: { id: sub.id }, data: { unsubscribedAt: new Date() } });
    }
    return sub.email;
  });

  if (!email) return { ok: false, error: "This unsubscribe link isn't valid." };

  await withdrawConsent(email, NEWSLETTER_PURPOSE, "EMAIL");
  return { ok: true, email };
}

/** Stamp withdrawnAt on any currently-granted consent for this purpose/channel. */
export async function withdrawConsent(email: string, purpose: string, channel: "EMAIL" | "SMS" | "WHATSAPP" | "PUSH" | "IN_APP"): Promise<void> {
  await prisma.consentRecord.updateMany({
    where: { email: email.toLowerCase(), purpose, channel, withdrawnAt: null, grantedAt: { not: null } },
    data: { withdrawnAt: new Date() },
  });
}

/**
 * The gate every marketing send must pass. True only when the latest consent
 * for this purpose/channel is granted and not withdrawn. A withdrawal (or an
 * unsubscribe, which withdraws) flips this to false immediately.
 */
export async function canSendMarketing(email: string, purpose = NEWSLETTER_PURPOSE, channel: "EMAIL" | "SMS" | "WHATSAPP" | "PUSH" | "IN_APP" = "EMAIL"): Promise<boolean> {
  const latest = await prisma.consentRecord.findFirst({
    where: { email: email.toLowerCase(), purpose, channel },
    orderBy: { createdAt: "desc" },
  });
  return !!latest && latest.grantedAt != null && latest.withdrawnAt == null;
}
