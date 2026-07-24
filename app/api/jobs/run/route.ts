// Job-runner trigger for a scheduler (cron/Cloud Scheduler/worker). Protected
// by JOBS_RUN_SECRET so it isn't publicly runnable. Runs one batch of due
// sync jobs; the caller invokes it on an interval.

import { NextRequest, NextResponse } from "next/server";
import { runDueJobs } from "@/lib/sync";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.JOBS_RUN_SECRET;
  if (!secret) return NextResponse.json({ error: "Job runner not configured" }, { status: 503 });

  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const summary = await runDueJobs(50);
  return NextResponse.json(summary);
}
