import {
  DemoResetBlockedError,
  resetDemoExperience,
} from "@clockwork/testing/demo-reset";
import { demoDeployOptIn } from "@clockwork/testing/demo-state";

import { requestId } from "@/src/features/experience-server/authorization";
import { configuredDemoStateStore } from "@/src/features/experience-server/demo-state-store";

function json(value: unknown, status: number, contentType?: string): Response {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      ...(contentType ? { "content-type": contentType } : {}),
    },
  });
}

function problem(
  status: 403 | 503,
  code: string,
  title: string,
  id: string,
): Response {
  return json(
    {
      type: `https://clockwork.test/problems/${code.toLowerCase().replaceAll("_", "-")}`,
      title,
      status,
      code,
      requestId: id,
      retryable: status >= 500,
    },
    status,
    "application/problem+json",
  );
}

/**
 * Restores the fixture demo to its seeded state between prospect calls. The
 * reset guard in resetDemoExperience still refuses on any production marker, so
 * this route can only ever clear demo fixtures.
 */
export async function POST(request: Request): Promise<Response> {
  // Outside a deliberate fixture-only deploy the boundary does not exist at
  // all: an ordinary deployment answers as it would for any unknown path
  // rather than advertising a reset route it would then refuse.
  if (!demoDeployOptIn(process.env))
    return new Response(null, {
      status: 404,
      headers: { "cache-control": "private, no-store" },
    });
  const id = requestId(request);
  try {
    const result = await resetDemoExperience(configuredDemoStateStore(), {
      environment: process.env,
      target: "demo",
    });
    return json(result, 200);
  } catch (error) {
    if (error instanceof DemoResetBlockedError)
      return problem(403, "DEMO_RESET_BLOCKED", error.message, id);
    return problem(
      503,
      "DEMO_RESET_FAILED",
      error instanceof Error ? error.message : "Demo reset failed",
      id,
    );
  }
}
