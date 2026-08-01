import { uuidV7 } from "@clockwork/contracts";
import { parseTraceparent } from "@clockwork/integrations/telemetry";

import { requestId } from "@/src/features/experience-server/authorization";
import { handleExperienceRequest } from "@/src/features/experience-server/controller";
import { runtimeBoundaryInstrumentation } from "@/src/telemetry/runtime";

type RouteContext = { params: Promise<{ segments?: string[] }> };

// Mirrors the correlation identifier accepted by safeIdentifier in
// packages/integrations/src/telemetry/telemetry.ts. The span opens before the
// controller runs, so a header the telemetry layer would reject has to fall
// back here instead of throwing past the controller's problem response.
const telemetryIdentifier = /^[a-zA-Z0-9][a-zA-Z0-9:._/-]{0,254}$/;

function correlationId(request: Request): string {
  const derived = requestId(request);
  return telemetryIdentifier.test(derived) ? derived : uuidV7();
}

async function handle(request: Request, context: RouteContext) {
  const { segments = [] } = await context.params;
  const parent = parseTraceparent(request.headers.get("traceparent"));
  return runtimeBoundaryInstrumentation.api({
    name: "api.request",
    correlation: { requestId: correlationId(request) },
    attributes: {
      "clockwork.operation": "api.request",
      "http.request.method": request.method,
      "http.route": "/api/experience/{resource}",
    },
    ...(parent ? { parent } : {}),
    operation: () => handleExperienceRequest(request, segments),
  });
}

export const GET = handle;
export const POST = handle;
