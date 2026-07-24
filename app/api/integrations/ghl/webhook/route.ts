// Inbound GHL webhook. Signature-verified before anything is trusted; an
// unsigned or forged request is rejected with 401 (acceptance criterion).
// Events ingested here are tagged originSystem="ghl" so the outbound queue
// never bounces them straight back to GHL (loop prevention).

import { NextRequest, NextResponse } from "next/server";
import { verifyGhlSignature, isGhlConfigured } from "@/lib/ghl";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isGhlConfigured()) {
    return NextResponse.json({ error: "GHL integration not configured" }, { status: 503 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get("x-ghl-signature") ?? request.headers.get("x-wh-signature");

  if (!verifyGhlSignature(rawBody, signature)) {
    return NextResponse.json({ error: "Invalid or missing signature" }, { status: 401 });
  }

  let event: { type?: string } = {};
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Inbound handling (contact updates -> our records) would live here, always
  // marked originSystem="ghl" when it emits further work so it can't loop.
  // The verified-and-accepted contract is what this route guarantees today.
  return NextResponse.json({ received: true, type: event.type ?? null });
}
