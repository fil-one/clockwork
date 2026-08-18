import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";

/**
 * A fixture-only destination for the operational queue's refresh ceremony.
 *
 * Keep the ordinary application unaware that the module exists: the full demo
 * identity predicate is checked before dynamically loading the destination
 * security boundary and a non-demo deployment answers like an unknown route.
 */
export async function POST(request: Request): Promise<Response> {
  if (!demoDeployIdentityEnabled(process.env))
    return new Response(null, {
      status: 404,
      headers: { "cache-control": "private, no-store" },
    });
  const demo = await import("@/app/api/[[...route]]/demo-app");
  return demo.handleDemoQueueProjectionRefresh(request);
}
