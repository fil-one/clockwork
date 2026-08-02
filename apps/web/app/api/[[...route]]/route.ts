import {
  demoDeployOptIn,
  findDemoProductionMarker,
} from "@clockwork/testing/demo-state";

// A fixture-only deploy answers /api/v1 from the generated-contract simulators
// instead of the production composition root. Both apps load through a dynamic
// import so a demo cold start never evaluates the Stripe, WorkOS, S3,
// trigger.dev and database clients that hono-app.ts constructs at module scope,
// and an ordinary deployment never evaluates the simulators. The production
// markers keep their veto: a deployment that reports production serves the real
// API whatever the opt-in says.
const demoApi =
  demoDeployOptIn(process.env) && !findDemoProductionMarker(process.env);

async function handle(request: Request): Promise<Response> {
  const app = demoApi ? await import("./demo-app") : await import("./hono-app");
  return app.handle(request);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
