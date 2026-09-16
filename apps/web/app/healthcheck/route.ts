import { NextResponse } from "next/server";

/**
 * The load balancer's liveness probe.
 *
 * It reads nothing: no database, no session, no provider, no environment. The
 * probe answers for exactly one fact -- this Node process is accepting and
 * serving requests -- and a target group that also failed on a database outage
 * would replace every healthy task in the service at once, turning a degraded
 * read path into no application at all. Routes that need the database report
 * their own failures.
 *
 * `proxy.ts` excludes this path from its matcher, so neither AuthKit nor the
 * demo password gate stands in front of the probe.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { status: "ok" },
    { headers: { "cache-control": "no-store" } },
  );
}
