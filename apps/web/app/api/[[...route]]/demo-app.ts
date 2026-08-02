import { createDemoCommerceHandlers } from "@clockwork/testing/demo-handlers";
import { DEMO_ORIGIN } from "@clockwork/testing/demo-seed";
import { getResponse } from "msw";

// The same generated-contract simulators the browser suites run against, served
// from the server so nothing intercepts requests in a prospect's browser. The
// handlers already require an idempotency key and a CSRF token on every
// mutation, and the proxy mints the clockwork-csrf cookie the client reads.
const handlers = [...createDemoCommerceHandlers()];

export async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
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
