import { createDemoCommerceHandlers } from "@clockwork/testing/demo-handlers";
import { DEMO_ORIGIN } from "@clockwork/testing/demo-seed";
import { getResponse } from "msw";

// The same generated-contract simulators the browser suites run against, served
// from the server so nothing intercepts requests in a prospect's browser. The
// handlers already require an idempotency key and a CSRF token on every
// mutation, and the proxy mints the clockwork-csrf cookie the client reads.
const handlers = [...createDemoCommerceHandlers()];

/**
 * The one command lane the demo runs rather than simulates.
 *
 * Every other operation here echoes a contract-shaped response, which is right
 * for a demo: it proves the wire shape without pretending a decision was made.
 * Order acceptance is different, because the decision IS the demonstration. The
 * echo answered `orders:prepare_artifact` with the payload it was handed, so no
 * order form was ever composed, no binding was ever recorded, and the second
 * pass had nothing to quote -- the prospect reached a permanent wait. The demo
 * order lane runs the product's own `acceptOrder` over seeded records instead,
 * and the CSRF and replay evidence the simulators demand is demanded here too.
 */
function isOrderCommand(request: Request, url: URL): boolean {
  return (
    request.method === "POST" &&
    url.pathname.replace(/^\/api/, "") === "/v1/core/commands/orders"
  );
}

function missingMutationProof(request: Request): boolean {
  return !(
    request.headers.get("idempotency-key") &&
    request.headers.get("x-csrf-token")
  );
}

export async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (isOrderCommand(request, url)) {
    if (missingMutationProof(request))
      return Response.json({ error: "forbidden" }, { status: 403 });
    // Loaded on demand, the way this route already loads its two apps: the
    // order lane pulls in the domain, the document renderer and the demo state
    // store, and no other request needs any of them.
    const lane =
      await import("@/src/features/experience-server/demo-order-command");
    return lane.handleDemoOrderCommand(request);
  }
  const simulated = new URL(
    `${url.pathname.replace(/^\/api/, "") || "/"}${url.search}`,
    DEMO_ORIGIN,
  );
  // The method, headers and body are copied across explicitly rather than by
  // passing the incoming request as the init: the demo simulators match on all
  // three, and a runtime whose Request constructor drops any of them would
  // silently turn every mutation into an unmatched read.
  const body =
    request.method === "GET" || request.method === "HEAD"
      ? undefined
      : await request.arrayBuffer();
  const response = await getResponse(
    handlers,
    new Request(simulated, {
      method: request.method,
      headers: request.headers,
      ...(body === undefined ? {} : { body }),
    }),
  );
  if (response) return response;
  return Response.json(
    {
      type: "https://clockwork.test/problems/demo-operation-unavailable",
      title: "The demo does not simulate this operation",
      status: 404,
      detail: `${request.method} ${url.pathname} has no demo simulator.`,
      code: "DEMO_OPERATION_UNAVAILABLE",
      requestId: request.headers.get("x-request-id") ?? "demo",
      retryable: false,
    },
    {
      status: 404,
      headers: {
        "cache-control": "private, no-store",
        "content-type": "application/problem+json",
        "x-content-type-options": "nosniff",
      },
    },
  );
}
