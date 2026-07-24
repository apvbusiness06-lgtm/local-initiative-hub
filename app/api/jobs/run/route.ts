// Job-runner trigger for a scheduler (cron/Cloud Scheduler/worker). Protected
// by JOBS_RUN_SECRET so it isn't publicly runnable. Runs one batch of due
// sync jobs; the caller invokes it on an interval.

import { NextRequest, NextResponse } from "next/server";
import { runDueJobs } from "@/lib/sync";

export const runtime = "nodejs";

function checkAuth(request: NextRequest): NextResponse | null {
  const secret = process.env.JOBS_RUN_SECRET ?? process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Job runner not configured" }, { status: 503 });
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return null;
}

async function run(): Promise<NextResponse> {
  const summary = await runDueJobs(50);
  return NextResponse.json(summary);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return checkAuth(request) ?? run();
}

// Vercel Cron Jobs send GET requests.
export async function GET(request: NextRequest): Promise<NextResponse> {
  return checkAuth(request) ?? run();
}
