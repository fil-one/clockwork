import { uuidV7 } from "@clockwork/contracts";

import { withRawApiAuthentication } from "@/src/auth/raw-api-boundary";
import { WorkosNextSessionResolver } from "@/src/auth/session";
import { requestId } from "@/src/features/experience-server/authorization";
import { handleExperienceRequest } from "@/src/features/experience-server/controller";
import { runtimeBoundaryInstrumentation } from "@/src/telemetry/runtime";

type RouteContext = { params: Promise<{ segments?: string[] }> };

// Mirrors the correlation identifier accepted by safeIdentifier in
// packages/integrations/src/telemetry/telemetry.ts. The span opens before the
// controller runs, so a header the telemetry layer would reject has to fall
// back here instead of throwing past the controller's problem response.
const telemetryIdentifier = /^[a-zA-Z0-9][a-zA-Z0-9:._/-]{0,254}$/;
const sessionResolver = new WorkosNextSessionResolver({
  requireBoundSession: true,
});

function correlationId(request: Request): string {
  const derived = requestId(request);
  return telemetryIdentifier.test(derived) ? derived : uuidV7();
}

async function handle(request: Request, context: RouteContext) {
  const { segments = [] } = await context.params;
  return withRawApiAuthentication({
    request,
    sessionResolver,
    requireDemoAccess: true,
    telemetryRoute: "/api/experience/{resource}",
    dispatch: (authenticatedRequest) => {
      return runtimeBoundaryInstrumentation.api({
        name: "api.request",
        correlation: { requestId: correlationId(authenticatedRequest) },
        attributes: {
          "clockwork.operation": "api.request",
          "http.request.method": authenticatedRequest.method,
          "http.route": "/api/experience/{resource}",
        },
        operation: () =>
          handleExperienceRequest(authenticatedRequest, segments, {
            sessionResolver,
          }),
      });
    },
  });
}

export const GET = handle;
export const POST = handle;
