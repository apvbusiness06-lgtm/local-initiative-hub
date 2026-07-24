// Same visibility caveat as lib/offers.ts: events without a business have no
// tenant gate at all today (Event carries no tenantId and placements can't
// target non-business subjects yet — see BACKLOG.md), so they'd show on
// every tenant. Not exercised by seed data; every demo event has a business.

import { Prisma } from "@prisma/client";
import { withTenant } from "./tenant";

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
