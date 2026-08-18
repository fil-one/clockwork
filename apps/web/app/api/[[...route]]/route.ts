import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";

// A fixture-only deploy answers /api/v1 from the generated-contract simulators
// instead of the production composition root. Both apps load through a dynamic
// import so a demo cold start never evaluates the Stripe, WorkOS, S3,
// trigger.dev and database clients that hono-app.ts constructs at module scope,
// and an ordinary deployment never evaluates the simulators. The production
// markers, public runtime marker, and experience adapter use the same predicate
// as demo identity: a deployment must agree on every signal before the
// simulator can replace the real API.
const demoApi = demoDeployIdentityEnabled(process.env);

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
