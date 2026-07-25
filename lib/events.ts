// Same visibility caveat as lib/offers.ts: events without a business have no
// tenant gate at all today (Event carries no tenantId and placements can't
// target non-business subjects yet — see BACKLOG.md), so they'd show on
// every tenant. Not exercised by seed data; every demo event has a business.

import { Prisma, PrismaClient } from "@prisma/client";
import { withTenant } from "./tenant";
import { parseRule, expandRecurrence, zonedWallTimeToUtc, type WallTime } from "./recurrence";

const prisma = new PrismaClient();

export interface EventSummary {
  id: string;
  slug: string;
  title: string;
  venueName: string | null;
  startsAt: Date;
  endsAt: Date;
  businessSlug: string | null;
  businessName: string | null;
}

export async function getUpcomingEventsForTenant(tenantId: string, limit = 6): Promise<EventSummary[]> {
  return withTenant(tenantId, (tx) =>
    tx.$queryRaw<EventSummary[]>(Prisma.sql`
      SELECT e.id, e.slug, e.title, e.venue_name AS "venueName",
             eo.starts_at AS "startsAt", eo.ends_at AS "endsAt",
             b.slug AS "businessSlug", b.trading_name AS "businessName"
      FROM events e
      JOIN event_occurrences eo
        ON eo.event_id = e.id AND eo.is_cancelled = false AND eo.starts_at > now()
      LEFT JOIN businesses b ON b.id = e.business_id AND b.deleted_at IS NULL
      LEFT JOIN directory_placements dp
        ON dp.subject = 'BUSINESS' AND dp.subject_id = b.id
       AND dp.tenant_id = ${tenantId}::uuid AND dp.status = 'APPROVED'
      WHERE e.status = 'ACTIVE' AND e.deleted_at IS NULL
        AND (e.business_id IS NULL OR dp.id IS NOT NULL)
      ORDER BY eo.starts_at ASC
      LIMIT ${limit}
    `)
  );
}

export interface EventDetail {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  venueName: string | null;
  addressLine1: string | null;
  postcode: string | null;
  timezone: string;
  bookingUrl: string | null;
  priceMinor: number | null;
  currency: string;
  isAccessible: boolean;
  businessSlug: string | null;
  businessName: string | null;
}

export async function getEventForTenant(tenantId: string, slug: string): Promise<EventDetail | null> {
  const rows = await withTenant(tenantId, (tx) =>
    tx.$queryRaw<EventDetail[]>(Prisma.sql`
      SELECT e.id, e.slug, e.title, e.description, e.venue_name AS "venueName",
             e.address_line1 AS "addressLine1", e.postcode, e.timezone,
             e.booking_url AS "bookingUrl", e.price_minor AS "priceMinor", e.currency,
             e.is_accessible AS "isAccessible",
             b.slug AS "businessSlug", b.trading_name AS "businessName"
      FROM events e
      LEFT JOIN businesses b ON b.id = e.business_id AND b.deleted_at IS NULL
      LEFT JOIN directory_placements dp
        ON dp.subject = 'BUSINESS' AND dp.subject_id = b.id
       AND dp.tenant_id = ${tenantId}::uuid AND dp.status = 'APPROVED'
      WHERE e.slug = ${slug} AND e.status = 'ACTIVE' AND e.deleted_at IS NULL
        AND (e.business_id IS NULL OR dp.id IS NOT NULL)
      LIMIT 1
    `)
  );
  return rows[0] ?? null;
}

export interface OccurrenceRow {
  id: string;
  startsAt: Date;
  endsAt: Date;
  rsvpCount: number;
}

export async function getUpcomingOccurrences(eventId: string, limit = 10): Promise<OccurrenceRow[]> {
  const occ = await prisma.eventOccurrence.findMany({
    where: { eventId, isCancelled: false, startsAt: { gt: new Date() } },
    orderBy: { startsAt: "asc" },
    take: limit,
    include: { _count: { select: { rsvps: true } } },
  });
  return occ.map((o) => ({ id: o.id, startsAt: o.startsAt, endsAt: o.endsAt, rsvpCount: o._count.rsvps }));
}

export type RsvpResult = { ok: true; count: number } | { ok: false; error: string };

/** RSVP to an occurrence. Unique per (occurrence, user), so re-RSVP is a no-op update. */
export async function rsvpToOccurrence(occurrenceId: string, userId: string, guestCount = 1): Promise<RsvpResult> {
  const occ = await prisma.eventOccurrence.findUnique({ where: { id: occurrenceId }, include: { event: true } });
  if (!occ || occ.isCancelled) return { ok: false, error: "This event occurrence isn't available." };

  await prisma.rsvp.upsert({
    where: { occurrenceId_userId: { occurrenceId, userId } },
    update: { guestCount: Math.max(1, Math.min(guestCount, 20)) },
    create: { occurrenceId, userId, guestCount: Math.max(1, Math.min(guestCount, 20)) },
  });

  if (occ.event.capacity != null) {
    const total = await prisma.rsvp.aggregate({ where: { occurrenceId }, _sum: { guestCount: true } });
    const used = total._sum.guestCount ?? 0;
    if (used > occ.event.capacity) {
      // Roll back this RSVP if it pushed over capacity.
      await prisma.rsvp.delete({ where: { occurrenceId_userId: { occurrenceId, userId } } });
      return { ok: false, error: "This event is full." };
    }
  }

  const count = await prisma.rsvp.count({ where: { occurrenceId } });
  return { ok: true, count };
}

/**
 * (Re)generate concrete EventOccurrence rows from an event's RRULE. Idempotent
 * on (eventId, startsAt): re-running doesn't duplicate. Used by the seed and
 * by any admin/portal action that sets a recurrence. DST-correct via
 * lib/recurrence (occurrences keep their local time across a BST change).
 */
export async function generateOccurrences(
  eventId: string,
  firstStart: WallTime,
  durationMinutes: number
): Promise<number> {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return 0;

  if (!event.isRecurring || !event.recurrenceRule) {
    const startsAt = zonedWallTimeToUtc(firstStart, event.timezone);
    await upsertOccurrence(eventId, startsAt, new Date(startsAt.getTime() + durationMinutes * 60_000));
    return 1;
  }

  const rule = parseRule(event.recurrenceRule);
  if (!rule) return 0;
  const occurrences = expandRecurrence(rule, firstStart, event.timezone, durationMinutes);
  for (const o of occurrences) await upsertOccurrence(eventId, o.startsAt, o.endsAt);
  return occurrences.length;
}

async function upsertOccurrence(eventId: string, startsAt: Date, endsAt: Date): Promise<void> {
  const existing = await prisma.eventOccurrence.findFirst({ where: { eventId, startsAt } });
  if (existing) return;
  await prisma.eventOccurrence.create({ data: { eventId, startsAt, endsAt } });
}
