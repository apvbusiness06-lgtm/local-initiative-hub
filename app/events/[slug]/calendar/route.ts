// Download an occurrence as an .ics file. ?occ=<occurrenceId> selects which
// occurrence; defaults to the next upcoming one.

import { NextRequest, NextResponse } from "next/server";
import { resolveTenant } from "@/lib/tenant";
import { getEventForTenant } from "@/lib/events";
import { buildIcs } from "@/lib/ics";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<NextResponse> {
  const { slug } = await params;
  const host = request.headers.get("host") ?? "";
  const tenant = await resolveTenant(host);
  if (!tenant) return new NextResponse("Not found", { status: 404 });

  const event = await getEventForTenant(tenant.id, slug);
  if (!event) return new NextResponse("Not found", { status: 404 });

  const occId = request.nextUrl.searchParams.get("occ");
  const occurrence = occId
    ? await prisma.eventOccurrence.findFirst({ where: { id: occId, eventId: event.id } })
    : await prisma.eventOccurrence.findFirst({
        where: { eventId: event.id, isCancelled: false, startsAt: { gt: new Date() } },
        orderBy: { startsAt: "asc" },
      });
  if (!occurrence) return new NextResponse("No occurrence", { status: 404 });

  const proto = process.env.NODE_ENV === "production" ? "https" : "http";
  const ics = buildIcs({
    uid: `${occurrence.id}@${host}`,
    title: event.title,
    description: event.description,
    location: [event.venueName, event.addressLine1, event.postcode].filter(Boolean).join(", ") || null,
    startsAt: occurrence.startsAt,
    endsAt: occurrence.endsAt,
    url: `${proto}://${host}/events/${event.slug}`,
  });

  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${event.slug}.ics"`,
    },
  });
}
