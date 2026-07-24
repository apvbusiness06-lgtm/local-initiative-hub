// Slice 12 acceptance:
//   - the same event queued twice produces one GHL contact (idempotent
//     enqueue + one ExternalIdMapping);
//   - an unsigned webhook is rejected;
//   - a failed job appears in the queue and retries successfully (backoff,
//     dead-letter, requeue).
import { afterEach, afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { generateRawToken } from "@/lib/auth/tokens";
import { enqueueSyncJob, runDueJobs, requeueJob, registerHandler, type GhlUpsertPayload } from "@/lib/sync";
import { verifyGhlSignature } from "@/lib/ghl";
import { withTenant } from "@/lib/tenant";
import { createHmac, randomUUID } from "node:crypto";

const prisma = new PrismaClient();

const keys: string[] = [];

afterEach(async () => {
  if (keys.length) await prisma.syncJob.deleteMany({ where: { idempotencyKey: { in: keys } } });
  keys.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

function key(): string {
  const k = `test.${generateRawToken().slice(0, 12)}`;
  keys.push(k);
  return k;
}

describe("idempotent enqueue", () => {
  it("queuing the same idempotency key twice creates one job", async () => {
    const idem = key();
    const first = await enqueueSyncJob({ jobKey: "ghl.upsert_contact", idempotencyKey: idem, payload: { a: 1 } });
    expect(first.duplicate).toBe(false);

    const second = await enqueueSyncJob({ jobKey: "ghl.upsert_contact", idempotencyKey: idem, payload: { a: 1 } });
    expect(second.duplicate).toBe(true);
    expect(second.jobId).toBe(first.jobId);

    expect(await prisma.syncJob.count({ where: { idempotencyKey: idem } })).toBe(1);
  });
});

describe("loop prevention", () => {
  it("does not enqueue an event whose origin is the same system it targets", async () => {
    const idem = key();
    const res = await enqueueSyncJob({
      jobKey: "ghl.upsert_contact",
      idempotencyKey: idem,
      payload: {},
      originSystem: "ghl",
    });
    expect(res.duplicate).toBe(true); // treated as a no-op
    expect(await prisma.syncJob.count({ where: { idempotencyKey: idem } })).toBe(0);
  });
});

describe("inbound webhook signature", () => {
  const OLD = process.env.GHL_WEBHOOK_SECRET;
  it("rejects an unsigned or forged webhook and accepts a correctly signed one", () => {
    process.env.GHL_WEBHOOK_SECRET = "test-secret";
    const body = JSON.stringify({ type: "ContactCreate" });
    const goodSig = createHmac("sha256", "test-secret").update(body).digest("hex");

    expect(verifyGhlSignature(body, null)).toBe(false);
    expect(verifyGhlSignature(body, "deadbeef")).toBe(false);
    expect(verifyGhlSignature(body, goodSig)).toBe(true);
    process.env.GHL_WEBHOOK_SECRET = OLD;
  });

  it("rejects everything when no secret is configured", () => {
    const prev = process.env.GHL_WEBHOOK_SECRET;
    delete process.env.GHL_WEBHOOK_SECRET;
    expect(verifyGhlSignature("{}", "anything")).toBe(false);
    if (prev !== undefined) process.env.GHL_WEBHOOK_SECRET = prev;
  });
});

describe("same event twice produces one GHL contact", () => {
  it("runs the real upsert handler and keeps exactly one ExternalIdMapping for the entity", async () => {
    const suffix = generateRawToken().slice(0, 8).toLowerCase();
    const tenantId = (await prisma.tenant.findUniqueOrThrow({ where: { slug: "hampshire" } })).id;
    const conn = await withTenant(tenantId, (tx) =>
      tx.integrationConnection.create({
        data: { tenantId, provider: "ghl", status: "MOCK", externalAccountId: `loc-${suffix}` },
      })
    );
    const entityId = randomUUID(); // ExternalIdMapping.internalId is a UUID column
    const payload: GhlUpsertPayload = {
      entityKind: "enquiry",
      internalId: entityId,
      contact: { locationId: `loc-${suffix}`, email: `lead-${suffix}@example.com`, name: "Lead" },
    };
    const idem = key();

    // Enqueue the same logical event twice; second is a dup (one job).
    await enqueueSyncJob({ jobKey: "ghl.upsert_contact", idempotencyKey: idem, payload: payload as never, connectionId: conn.id });
    await enqueueSyncJob({ jobKey: "ghl.upsert_contact", idempotencyKey: idem, payload: payload as never, connectionId: conn.id });

    await runDueJobs(10);
    // Requeue + run again to simulate a re-delivery of the same entity.
    const job = await prisma.syncJob.findUniqueOrThrow({ where: { idempotencyKey: idem } });
    await requeueJob(job.id);
    await runDueJobs(10);

    const mappings = await prisma.externalIdMapping.findMany({
      where: { provider: "ghl", entityKind: "enquiry", internalId: entityId },
    });
    expect(mappings).toHaveLength(1); // one contact, not two

    await prisma.externalIdMapping.deleteMany({ where: { internalId: entityId } });
    await withTenant(tenantId, (tx) => tx.integrationConnection.deleteMany({ where: { id: conn.id } }));
  });
});

describe("failing job: backoff, dead-letter, then requeue succeeds", () => {
  it("retries with backoff, dead-letters at maxAttempts, then a requeue runs to success", async () => {
    const idem = key();
    // A handler that fails until we flip the flag.
    let shouldFail = true;
    registerHandler("test.flaky", async () => {
      if (shouldFail) throw new Error("upstream 401 token=sk_live_shhh header Authorization: Bearer abc123def");
    });

    await enqueueSyncJob({ jobKey: "test.flaky", idempotencyKey: idem, payload: {}, maxAttempts: 2 });

    // First run: fails, reschedules (attempts=1, still QUEUED but in the future).
    const r1 = await runDueJobs(10);
    expect(r1.failed).toBeGreaterThanOrEqual(1);
    let job = await prisma.syncJob.findUniqueOrThrow({ where: { idempotencyKey: idem } });
    expect(job.attempts).toBe(1);
    expect(job.status).toBe("QUEUED");
    expect(job.nextRunAt.getTime()).toBeGreaterThan(Date.now());
    // Secret redacted in the stored error.
    expect(job.lastError).toContain("sk_live_[redacted]");
    expect(job.lastError).toContain("Bearer [redacted]");

    // Second run in the "future": fails again -> dead-letter at maxAttempts=2.
    await runDueJobs(10, new Date(Date.now() + 60 * 60 * 1000));
    job = await prisma.syncJob.findUniqueOrThrow({ where: { idempotencyKey: idem } });
    expect(job.status).toBe("DEAD_LETTER");
    expect(job.attempts).toBe(2);

    // Admin fixes the upstream; requeue and run -> success.
    shouldFail = false;
    await requeueJob(job.id);
    const r3 = await runDueJobs(10);
    expect(r3.succeeded).toBeGreaterThanOrEqual(1);
    job = await prisma.syncJob.findUniqueOrThrow({ where: { idempotencyKey: idem } });
    expect(job.status).toBe("SUCCEEDED");
  });
});
