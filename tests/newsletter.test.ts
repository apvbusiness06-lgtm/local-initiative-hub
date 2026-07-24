// Slice 13 acceptance:
//   - unsubscribe works from the emailed token WITHOUT login;
//   - consent withdrawal blocks marketing sends immediately.
import { afterEach, afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { generateRawToken } from "@/lib/auth/tokens";
import {
  subscribeToNewsletter,
  unsubscribeByToken,
  canSendMarketing,
  withdrawConsent,
  NEWSLETTER_PURPOSE,
} from "@/lib/newsletter";

const prisma = new PrismaClient();

let tenantId: string;
let email: string;

beforeEach(async () => {
  tenantId = (await prisma.tenant.findUniqueOrThrow({ where: { slug: "hampshire" } })).id;
  email = `subscriber-${generateRawToken().slice(0, 8).toLowerCase()}@example.com`;
});

afterEach(async () => {
  await prisma.consentRecord.deleteMany({ where: { email } });
  const { withTenant } = await import("@/lib/tenant");
  await withTenant(tenantId, (tx) => tx.newsletterSubscription.deleteMany({ where: { tenantId, email } }));
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("subscribe writes a consent record with wording version", () => {
  it("captures purpose, channel, lawful basis and exact wording", async () => {
    const res = await subscribeToNewsletter({ tenantId, email });
    expect(res.ok).toBe(true);
    const consent = await prisma.consentRecord.findFirstOrThrow({ where: { email, purpose: NEWSLETTER_PURPOSE } });
    expect(consent.channel).toBe("EMAIL");
    expect(consent.lawfulBasis).toBe("consent");
    expect(consent.wordingVersion).toBeTruthy();
    expect(consent.wordingText.length).toBeGreaterThan(10);
    expect(consent.grantedAt).not.toBeNull();
    expect(consent.withdrawnAt).toBeNull();

    expect(await canSendMarketing(email)).toBe(true);
  });
});

describe("token unsubscribe without login", () => {
  it("unsubscribes and withdraws consent using only the emailed token", async () => {
    const sub = await subscribeToNewsletter({ tenantId, email });
    if (!sub.ok) throw new Error("subscribe failed");
    expect(await canSendMarketing(email)).toBe(true);

    // No user/session involved — just the token.
    const result = await unsubscribeByToken(tenantId, sub.unsubscribeToken);
    expect(result).toMatchObject({ ok: true, email });

    // Sending is blocked immediately.
    expect(await canSendMarketing(email)).toBe(false);

    const { withTenant } = await import("@/lib/tenant");
    const row = await withTenant(tenantId, (tx) => tx.newsletterSubscription.findFirstOrThrow({ where: { tenantId, email } }));
    expect(row.unsubscribedAt).not.toBeNull();
  });

  it("rejects a bogus token", async () => {
    const result = await unsubscribeByToken(tenantId, generateRawToken());
    expect(result.ok).toBe(false);
  });
});

describe("consent withdrawal blocks sends immediately", () => {
  it("flips canSendMarketing to false the moment consent is withdrawn", async () => {
    await subscribeToNewsletter({ tenantId, email });
    expect(await canSendMarketing(email)).toBe(true);

    await withdrawConsent(email, NEWSLETTER_PURPOSE, "EMAIL");
    expect(await canSendMarketing(email)).toBe(false);
  });

  it("re-subscribing after withdrawal restores consent (newest record wins)", async () => {
    await subscribeToNewsletter({ tenantId, email });
    await withdrawConsent(email, NEWSLETTER_PURPOSE, "EMAIL");
    expect(await canSendMarketing(email)).toBe(false);

    await subscribeToNewsletter({ tenantId, email });
    expect(await canSendMarketing(email)).toBe(true);
  });
});
