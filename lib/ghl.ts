// GoHighLevel client + inbound webhook verification. Same "works unconfigured"
// posture as Stripe/mailer: without GHL credentials, isGhlConfigured() is
// false and outbound jobs are handled by a MockGhlClient that records the
// ExternalIdMapping but makes no network call — so the queue, idempotency and
// loop-prevention logic are all exercisable without a live GHL account, and
// nothing silently pretends to have reached a real CRM.

import { createHmac, timingSafeEqual } from "node:crypto";

export function isGhlConfigured(): boolean {
  return !!(process.env.GHL_CLIENT_ID && process.env.GHL_CLIENT_SECRET);
}

export interface GhlContactInput {
  locationId: string;
  email: string;
  name?: string | null;
  phone?: string | null;
  tags?: string[];
  source?: string;
}

export interface GhlClient {
  readonly mode: "live" | "mock";
  /** Upsert a contact; returns the GHL contact id (idempotent by email at GHL's end). */
  upsertContact(input: GhlContactInput): Promise<{ externalId: string }>;
}

// Deterministic fake id so re-running the same logical upsert maps to the same
// ExternalIdMapping row — mirrors GHL's own upsert-by-email behaviour.
class MockGhlClient implements GhlClient {
  readonly mode = "mock" as const;
  async upsertContact(input: GhlContactInput): Promise<{ externalId: string }> {
    const hash = createHmac("sha256", "mock-ghl").update(`${input.locationId}:${input.email.toLowerCase()}`).digest("hex");
    return { externalId: `mock_${hash.slice(0, 20)}` };
  }
}

class LiveGhlClient implements GhlClient {
  readonly mode = "live" as const;
  constructor(private readonly accessToken: string) {}
  async upsertContact(input: GhlContactInput): Promise<{ externalId: string }> {
    // LeadConnector v2 contacts upsert.
    const res = await fetch("https://services.leadconnectorhq.com/contacts/upsert", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Version: "2021-07-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        locationId: input.locationId,
        email: input.email,
        name: input.name ?? undefined,
        phone: input.phone ?? undefined,
        tags: input.tags ?? undefined,
        source: input.source ?? "Local Initiative",
      }),
    });
    if (!res.ok) throw new Error(`GHL upsert failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { contact?: { id?: string }; id?: string };
    const id = body.contact?.id ?? body.id;
    if (!id) throw new Error("GHL upsert returned no contact id");
    return { externalId: id };
  }
}

export function getGhlClient(accessToken?: string): GhlClient {
  if (isGhlConfigured() && accessToken) return new LiveGhlClient(accessToken);
  return new MockGhlClient();
}

/**
 * Verify an inbound GHL webhook's HMAC-SHA256 signature over the raw body.
 * Rejects when unsigned, misconfigured, or mismatched — an unsigned webhook
 * never reaches business logic.
 */
export function verifyGhlSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.GHL_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
