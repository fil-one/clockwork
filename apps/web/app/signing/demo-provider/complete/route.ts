import { NextResponse } from "next/server";

import {
  demoExperienceEnabled,
  demoExperienceRepository,
} from "@/src/features/experience-server/demo-experience-repository";

function seeOther(location: string): NextResponse {
  return new NextResponse(null, {
    status: 303,
    headers: { location, "cache-control": "private, no-store" },
  });
}

/**
 * Completes the fixture ceremony and hands the signer back to the real return
 * route, so the deployed demo exercises the same reconciliation a provider
 * callback would.
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (!demoExperienceEnabled()) return new NextResponse(null, { status: 404 });
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (
    !origin ||
    !host ||
    !URL.canParse(origin) ||
    new URL(origin).host !== host
  )
    return new NextResponse(null, { status: 403 });
  const form = await request.formData();
  const state = form.get("state");
  if (typeof state !== "string" || !state.trim())
    return seeOther("/signing/demo-provider");
  await demoExperienceRepository().completeDemoCeremony(state.trim());
  return seeOther(`/signing/return?state=${encodeURIComponent(state.trim())}`);
}
