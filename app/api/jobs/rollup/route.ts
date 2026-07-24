// Nightly analytics rollup + scheduled-content publishing trigger. Rolls up
// yesterday and today (today so same-day dashboards aren't empty) and
// publishes any content whose scheduled time has passed. One cron covers
// both. Protected by JOBS_RUN_SECRET.

import { NextRequest, NextResponse } from "next/server";
import { rollupAllTenants } from "@/lib/analytics";
import { publishDueScheduled } from "@/lib/content";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.JOBS_RUN_SECRET;
  if (!secret) return NextResponse.json({ error: "Job runner not configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [todayGroups, yesterdayGroups, published] = await Promise.all([
    rollupAllTenants(now),
    rollupAllTenants(yesterday),
    publishDueScheduled(now),
  ]);

  return NextResponse.json({ rolledUp: todayGroups + yesterdayGroups, published });
}
