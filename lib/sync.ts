// Slice 12 — the outbound sync queue. Generic over job kinds; the GHL handler
// is registered below. Three guarantees the acceptance criteria rest on:
//
//   1. Idempotent enqueue — SyncJob.idempotencyKey is unique, so the same
//      logical event queued twice collapses to ONE job (and therefore one GHL
//      contact). The second enqueue is a no-op.
//   2. Backoff + dead-letter — a failing job increments attempts and reschedules
//      with exponential backoff; once attempts hit maxAttempts it moves to
//      DEAD_LETTER and stops, visible in the admin queue.
//   3. Loop prevention — an event we ingested from GHL is tagged with
//      originSystem and never re-emitted back to GHL.

import { PrismaClient, Prisma, type JobStatus } from "@prisma/client";

const prisma = new PrismaClient();

export interface EnqueueInput {
  jobKey: string;
  idempotencyKey: string;
  payload: Prisma.InputJsonValue;
  connectionId?: string | null;
  originSystem?: string | null;
  maxAttempts?: number;
}

export interface EnqueueResult {
  jobId: string;
  duplicate: boolean;
}

export async function enqueueSyncJob(input: EnqueueInput): Promise<EnqueueResult> {
  // Loop prevention: never re-emit an event that came from the same external
  // system we'd be sending it to.
  if (input.originSystem && input.jobKey.startsWith(`${input.originSystem}.`)) {
    return { jobId: "", duplicate: true };
  }
  try {
    const job = await prisma.syncJob.create({
      data: {
        jobKey: input.jobKey,
        idempotencyKey: input.idempotencyKey,
        payload: input.payload,
        connectionId: input.connectionId ?? null,
        originSystem: input.originSystem ?? null,
        maxAttempts: input.maxAttempts ?? 6,
      },
    });
    return { jobId: job.id, duplicate: false };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const existing = await prisma.syncJob.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      return { jobId: existing?.id ?? "", duplicate: true };
    }
    throw e;
  }
}

export type JobHandler = (payload: unknown, ctx: { connectionId: string | null }) => Promise<void>;

const handlers = new Map<string, JobHandler>();

export function registerHandler(jobKey: string, handler: JobHandler): void {
  handlers.set(jobKey, handler);
}

function backoffMs(attempt: number): number {
  // 30s, 60s, 120s, ... capped at 1h.
  return Math.min(30_000 * 2 ** (attempt - 1), 60 * 60_000);
}

export interface RunSummary {
  picked: number;
  succeeded: number;
  failed: number;
  deadLettered: number;
}

/**
 * Run due jobs once. A worker/cron calls this on an interval; tests call it
 * directly. Each job: mark RUNNING, run its handler, then SUCCEEDED, or on
 * throw increment attempts and either reschedule with backoff or DEAD_LETTER.
 */
export async function runDueJobs(limit = 20, now: Date = new Date()): Promise<RunSummary> {
  const due = await prisma.syncJob.findMany({
    where: { status: "QUEUED", nextRunAt: { lte: now } },
    orderBy: { nextRunAt: "asc" },
    take: limit,
  });

  const summary: RunSummary = { picked: due.length, succeeded: 0, failed: 0, deadLettered: 0 };

  for (const job of due) {
    await prisma.syncJob.update({ where: { id: job.id }, data: { status: "RUNNING" } });
    const handler = handlers.get(job.jobKey);
    try {
      if (!handler) throw new Error(`No handler registered for ${job.jobKey}`);
      await handler(job.payload, { connectionId: job.connectionId });
      await prisma.syncJob.update({ where: { id: job.id }, data: { status: "SUCCEEDED", lastError: null } });
      summary.succeeded++;
    } catch (err) {
      const attempts = job.attempts + 1;
      const message = err instanceof Error ? err.message : String(err);
      const deadLetter = attempts >= job.maxAttempts;
      await prisma.syncJob.update({
        where: { id: job.id },
        data: {
          status: (deadLetter ? "DEAD_LETTER" : "QUEUED") as JobStatus,
          attempts,
          lastError: redactSecrets(message),
          nextRunAt: deadLetter ? job.nextRunAt : new Date(now.getTime() + backoffMs(attempts)),
        },
      });
      if (deadLetter) summary.deadLettered++;
      else summary.failed++;
    }
  }
  return summary;
}

/** Requeue a dead-lettered (or failed) job for immediate retry — the admin "resync" action. */
export async function requeueJob(jobId: string): Promise<void> {
  await prisma.syncJob.update({
    where: { id: jobId },
    data: { status: "QUEUED", nextRunAt: new Date(), lastError: null },
  });
}

// Never let a token/secret reach the sync log.
function redactSecrets(s: string): string {
  return s
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]")
    .replace(/(sk_live_|sk_test_|whsec_|pit-)[A-Za-z0-9]+/g, "$1[redacted]")
    .slice(0, 1000);
}

// ── GHL contact-upsert handler ───────────────────────────────
import { getGhlClient, type GhlContactInput } from "./ghl";
import { decryptSecret } from "./crypto";

export interface GhlUpsertPayload {
  entityKind: string; // enquiry, member, offer_claim
  internalId: string;
  contact: GhlContactInput;
}

registerHandler("ghl.upsert_contact", async (payloadRaw, ctx) => {
  const payload = payloadRaw as GhlUpsertPayload;

  // Resolve the connection's access token (encrypted at rest) when live.
  let accessToken: string | undefined;
  let accountRef = payload.contact.locationId;
  if (ctx.connectionId) {
    const conn = await prisma.integrationConnection.findUnique({ where: { id: ctx.connectionId } });
    if (conn?.credentialsEncrypted) {
      try {
        accessToken = decryptSecret(Buffer.from(conn.credentialsEncrypted).toString("utf8"));
      } catch {
        /* fall through to mock */
      }
    }
    if (conn?.externalAccountId) accountRef = conn.externalAccountId;
  }

  const client = getGhlClient(accessToken);
  const { externalId } = await client.upsertContact(payload.contact);

  // Record the mapping (idempotent on the composite unique key), so repeated
  // syncs of the same entity converge on one contact.
  await prisma.externalIdMapping.upsert({
    where: {
      provider_accountRef_entityKind_internalId: {
        provider: "ghl",
        accountRef,
        entityKind: payload.entityKind,
        internalId: payload.internalId,
      },
    },
    update: { externalId },
    create: { provider: "ghl", accountRef, entityKind: payload.entityKind, internalId: payload.internalId, externalId },
  });
});

// ── Outbound event emitters ──────────────────────────────────
// Resolve the tenant's GHL connection (if any) and queue a contact upsert.
// idempotencyKey embeds the entity id so a ret/replay of the same event
// collapses to one job -> one contact.

async function ghlConnectionForTenant(tenantId: string | null): Promise<{ id: string; locationId: string } | null> {
  if (!tenantId) return null;
  const conn = await prisma.integrationConnection.findFirst({
    where: { tenantId, provider: "ghl", status: { in: ["CONNECTED", "MOCK"] } },
  });
  if (!conn) return null;
  return { id: conn.id, locationId: conn.externalAccountId ?? "mock-location" };
}

export interface EnquiryEmitInput {
  enquiryId: string;
  tenantId: string | null;
  name: string;
  email: string;
  phone: string | null;
  originSystem?: string | null;
}

export async function emitEnquiryToGhl(input: EnquiryEmitInput): Promise<EnqueueResult | null> {
  const conn = await ghlConnectionForTenant(input.tenantId);
  // No connection => nothing to sync (not an error). Enqueue anyway when a
  // connection exists so retries/backoff apply.
  if (!conn) return null;
  const payload: GhlUpsertPayload = {
    entityKind: "enquiry",
    internalId: input.enquiryId,
    contact: {
      locationId: conn.locationId,
      email: input.email,
      name: input.name,
      phone: input.phone,
      tags: ["enquiry"],
      source: "Local Initiative enquiry",
    },
  };
  return enqueueSyncJob({
    jobKey: "ghl.upsert_contact",
    idempotencyKey: `ghl.enquiry.${input.enquiryId}`,
    payload: payload as unknown as Prisma.InputJsonValue,
    connectionId: conn.id,
    originSystem: input.originSystem ?? null,
  });
}
