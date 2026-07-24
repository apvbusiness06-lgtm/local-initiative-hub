// Slice 8 acceptance: impersonation expires automatically, and its audit
// rows carry BOTH the real actor and the impersonated user.
import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { signImpersonation, readImpersonation } from "@/lib/auth/impersonation";
import { signPayload } from "@/lib/auth/signedToken";
import { writeAudit } from "@/lib/audit";
import { generateRawToken } from "@/lib/auth/tokens";

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

describe("impersonation grant (self-expiring, signed)", () => {
  const grant = { realUserId: "admin-1", targetUserId: "user-2", reason: "debugging a portal bug" };

  it("round-trips a valid grant", () => {
    const token = signImpersonation(grant);
    expect(readImpersonation(token)).toEqual(grant);
  });

  it("rejects a tampered token", () => {
    const token = signImpersonation(grant);
    const tampered = token.slice(0, -3) + "xyz";
    expect(readImpersonation(tampered)).toBeNull();
  });

  it("rejects an expired grant automatically (no revocation step)", () => {
    // signPayload with a negative TTL puts exp in the past.
    const expired = signPayload({ ...grant }, -10);
    expect(readImpersonation(expired)).toBeNull();
  });

  it("rejects a grant missing required fields", () => {
    const partial = signPayload({ realUserId: "a", targetUserId: "b" }, 600); // no reason
    expect(readImpersonation(partial)).toBeNull();
    expect(readImpersonation(undefined)).toBeNull();
  });
});

describe("audit rows carry both identities under impersonation", () => {
  it("persists actorUserId and impersonatedUserId together", async () => {
    const suffix = generateRawToken().slice(0, 8).toLowerCase();
    const admin = await prisma.user.create({ data: { email: `admin-${suffix}@example.com` } });
    const target = await prisma.user.create({ data: { email: `target-${suffix}@example.com` } });

    await writeAudit(
      { actorUserId: admin.id, impersonatedUserId: target.id, impersonationReason: "support ticket #42" },
      { action: "test.action", subject: "user", subjectId: target.id, after: { ok: true } }
    );

    const row = await prisma.auditLog.findFirstOrThrow({
      where: { action: "test.action", actorUserId: admin.id },
    });
    expect(row.actorUserId).toBe(admin.id);
    expect(row.impersonatedUserId).toBe(target.id);
    expect(row.impersonationReason).toBe("support ticket #42");

    await prisma.auditLog.deleteMany({ where: { id: row.id } });
    await prisma.user.deleteMany({ where: { id: { in: [admin.id, target.id] } } });
  });
});
