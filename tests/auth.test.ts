import { describe, expect, it, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { hashPassword, verifyPassword, validatePasswordStrength } from "@/lib/auth/password";
import { generateRawToken, hashRawToken } from "@/lib/auth/tokens";
import { checkTokenValidity } from "@/lib/auth/tokenValidity";
import { createSession, getSessionByToken, destroyAllSessionsForUser, destroySessionByToken } from "@/lib/auth/session";
import { GET as verifyEmailRoute } from "@/app/api/auth/verify-email/route";

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`;
}

describe("password hashing", () => {
  it("verifies a correct password and rejects an incorrect one", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");
    expect(await verifyPassword("correct-horse-battery-staple", hash)).toBe(true);
    expect(await verifyPassword("wrong-password-entirely", hash)).toBe(false);
  });

  it("produces a different hash (and salt) each time for the same password", async () => {
    const a = await hashPassword("same-password-1234");
    const b = await hashPassword("same-password-1234");
    expect(a).not.toBe(b);
  });

  it("enforces a minimum length", () => {
    expect(validatePasswordStrength("short")).not.toBeNull();
    expect(validatePasswordStrength("this-is-long-enough")).toBeNull();
  });
});

describe("email verification (registration flow)", () => {
  it("verifies on first use, then rejects the same token as already-used", async () => {
    const email = uniqueEmail("verify");
    const user = await prisma.user.create({ data: { email, passwordHash: await hashPassword("irrelevant123") } });
    const rawToken = generateRawToken();
    await prisma.emailVerificationToken.create({
      data: { userId: user.id, tokenHash: hashRawToken(rawToken), expiresAt: new Date(Date.now() + 60_000) },
    });

    const url = `http://hampshire.local-initiative.test:3000/api/auth/verify-email?token=${rawToken}`;
    const first = await verifyEmailRoute(new Request(url));
    expect(first.status).toBe(307);
    expect(first.headers.get("location")).toContain("status=success");

    const verifiedUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(verifiedUser.emailVerifiedAt).not.toBeNull();

    const second = await verifyEmailRoute(new Request(url));
    expect(second.headers.get("location")).toContain("status=already-used");
  });

  it("rejects an expired token", async () => {
    const email = uniqueEmail("expired");
    const user = await prisma.user.create({ data: { email, passwordHash: await hashPassword("irrelevant123") } });
    const rawToken = generateRawToken();
    await prisma.emailVerificationToken.create({
      data: { userId: user.id, tokenHash: hashRawToken(rawToken), expiresAt: new Date(Date.now() - 1000) },
    });

    const url = `http://hampshire.local-initiative.test:3000/api/auth/verify-email?token=${rawToken}`;
    const response = await verifyEmailRoute(new Request(url));
    expect(response.headers.get("location")).toContain("status=expired");

    const stillUnverified = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stillUnverified.emailVerifiedAt).toBeNull();
  });

  it("rejects an unknown token", async () => {
    const url = `http://hampshire.local-initiative.test:3000/api/auth/verify-email?token=${generateRawToken()}`;
    const response = await verifyEmailRoute(new Request(url));
    expect(response.headers.get("location")).toContain("status=invalid");
  });
});

describe("password reset token lifecycle", () => {
  it("distinguishes usable, already-used and expired", () => {
    const usable = { consumedAt: null, expiresAt: new Date(Date.now() + 60_000) };
    const used = { consumedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) };
    const expired = { consumedAt: null, expiresAt: new Date(Date.now() - 1000) };
    const usedAndExpired = { consumedAt: new Date(), expiresAt: new Date(Date.now() - 1000) };

    expect(checkTokenValidity(usable)).toBe("usable");
    expect(checkTokenValidity(used)).toBe("already-used");
    expect(checkTokenValidity(expired)).toBe("expired");
    // Used takes priority — a reused token should never be reported as merely expired.
    expect(checkTokenValidity(usedAndExpired)).toBe("already-used");
  });

  it("a reset token can only be consumed once, end to end", async () => {
    const email = uniqueEmail("reset");
    const user = await prisma.user.create({ data: { email, passwordHash: await hashPassword("original-pw-123") } });
    const rawToken = generateRawToken();
    const record = await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: hashRawToken(rawToken), expiresAt: new Date(Date.now() + 60_000) },
    });

    expect(checkTokenValidity(record)).toBe("usable");

    // Simulate resetPasswordAction's consumption step.
    await prisma.passwordResetToken.update({ where: { id: record.id }, data: { consumedAt: new Date() } });

    const reloaded = await prisma.passwordResetToken.findUniqueOrThrow({ where: { id: record.id } });
    expect(checkTokenValidity(reloaded)).toBe("already-used");
  });
});

describe("session lifecycle and invalidation on password change", () => {
  it("a valid session resolves to its user", async () => {
    const email = uniqueEmail("session");
    const user = await prisma.user.create({ data: { email, passwordHash: await hashPassword("whatever-123") } });
    const { token } = await createSession(user.id);

    const resolved = await getSessionByToken(token);
    expect(resolved?.id).toBe(user.id);
  });

  it("an unknown token resolves to null", async () => {
    expect(await getSessionByToken("not-a-real-token")).toBeNull();
  });

  it("destroying a single session invalidates only that token", async () => {
    const email = uniqueEmail("single-logout");
    const user = await prisma.user.create({ data: { email, passwordHash: await hashPassword("whatever-123") } });
    const sessionA = await createSession(user.id);
    const sessionB = await createSession(user.id);

    await destroySessionByToken(sessionA.token);

    expect(await getSessionByToken(sessionA.token)).toBeNull();
    expect(await getSessionByToken(sessionB.token)).not.toBeNull();
  });

  it("password change invalidates every existing session for that user", async () => {
    const email = uniqueEmail("pwchange");
    const user = await prisma.user.create({ data: { email, passwordHash: await hashPassword("whatever-123") } });
    const sessionA = await createSession(user.id);
    const sessionB = await createSession(user.id);

    expect(await getSessionByToken(sessionA.token)).not.toBeNull();
    expect(await getSessionByToken(sessionB.token)).not.toBeNull();

    // What resetPasswordAction does after updating the password hash.
    await destroyAllSessionsForUser(user.id);

    expect(await getSessionByToken(sessionA.token)).toBeNull();
    expect(await getSessionByToken(sessionB.token)).toBeNull();
  });
});
