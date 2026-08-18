import { createDemoCommerceHandlers } from "@clockwork/testing/demo-handlers";
import { DEMO_ORIGIN } from "@clockwork/testing/demo-seed";
import { getResponse } from "msw";

import {
  demoAccessConfiguration,
  demoAccessCookieName,
  verifyDemoAccessCookie,
} from "@/src/auth/demo-access";

// The same generated-contract simulators the browser suites run against, served
// from the server so nothing intercepts requests in a prospect's browser. The
// handlers already require an idempotency key and a CSRF token on every
// mutation, and the browser document boundary mints the clockwork-csrf cookie
// the client reads.
const handlers = [...createDemoCommerceHandlers()];
const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

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

function isWebhookRequest(url: URL): boolean {
  const pathname = url.pathname.replace(/^\/api/u, "");
  return pathname === "/v1/webhooks" || pathname.startsWith("/v1/webhooks/");
}

function unavailableDemoWebhook(request: Request): Response {
  return Response.json(
    {
      type: "https://clockwork.test/problems/demo-webhook-unavailable",
      title: "Provider webhooks are unavailable in the demo",
      status: 503,
      detail:
        "The demo has no provider signing secret and cannot verify this callback.",
      code: "DEMO_WEBHOOK_UNAVAILABLE",
      requestId: request.headers.get("x-request-id") ?? "demo",
      retryable: false,
    },
    {
      status: 503,
      headers: {
        "cache-control": "private, no-store",
        "content-type": "application/problem+json",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

function cookieValue(cookie: string | null, name: string): string | undefined {
  for (const part of cookie?.split(";") ?? []) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    if (part.slice(0, separator).trim() === name)
      return part.slice(separator + 1).trim();
  }
  return undefined;
}

function demoAccessProblem(request: Request): Response {
  return Response.json(
    {
      type: "https://clockwork.test/problems/demo-access-required",
      title: "Demo access is required",
      status: 403,
      detail: "A valid demo access grant is required.",
      code: "DEMO_ACCESS_REQUIRED",
      requestId: request.headers.get("x-request-id") ?? "demo",
      retryable: false,
    },
    {
      status: 403,
      headers: {
        "cache-control": "private, no-store",
        "content-type": "application/problem+json",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

function securityProblem(
  request: Request,
  code: "ORIGIN_REJECTED" | "CSRF_REJECTED",
): Response {
  const origin = code === "ORIGIN_REJECTED";
  return Response.json(
    {
      type: `https://clockwork.test/problems/${origin ? "origin" : "csrf"}`,
      title: origin ? "Origin rejected" : "CSRF validation failed",
      status: 403,
      detail: origin
        ? "The request origin is not allowed."
        : "Provide the double-submit CSRF token.",
      code,
      requestId: request.headers.get("x-request-id") ?? "demo",
      retryable: false,
    },
    {
      status: 403,
      headers: {
        "cache-control": "private, no-store",
        "content-type": "application/problem+json",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

function normalizedHost(value: string | null): string | undefined {
  if (
    !value ||
    value !== value.trim() ||
    value.length > 253 ||
    /[,/@\\?#\s]/u.test(value)
  )
    return undefined;
  let parsed: URL;
  try {
    parsed = new URL(`http://${value}`);
  } catch {
    return undefined;
  }
  if (parsed.host.toLowerCase() !== value.toLowerCase()) return undefined;
  const hostname = parsed.hostname;
  if (hostname.startsWith("["))
    return /^\[[0-9a-f:.]+\]$/iu.test(hostname) ? parsed.host : undefined;
  if (/^\d+(?:\.\d+){3}$/u.test(hostname)) {
    const octets = hostname.split(".").map(Number);
    return octets.every((octet) => octet >= 0 && octet <= 255)
      ? parsed.host
      : undefined;
  }
  const labels = hostname.split(".");
  if (
    labels.some(
      (label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu.test(label),
    )
  )
    return undefined;
  return parsed.host;
}

export function demoMutationOriginAllowed(input: {
  readonly origin: string | null;
  readonly configuredOrigin: string;
  readonly host: string | null;
  readonly forwardedHost: string | null;
  readonly forwardedProtocol: string | null;
  readonly requestProtocol: string;
}): boolean {
  const canonicalOrigin = new URL(input.configuredOrigin).origin;
  const suppliedHost = input.forwardedHost ?? input.host;
  const host = normalizedHost(suppliedHost);
  if (suppliedHost !== null && !host) return false;
  if (
    input.forwardedProtocol !== null &&
    input.forwardedProtocol !== "http" &&
    input.forwardedProtocol !== "https"
  )
    return false;
  if (input.origin === canonicalOrigin) return true;
  if (!host) return false;
  const protocol = input.forwardedProtocol ?? input.requestProtocol;
  if (protocol !== "http" && protocol !== "https") return false;
  return input.origin === `${protocol}://${host}`;
}

function validateMutationProof(request: Request): Response | undefined {
  const configuredOrigin =
    process.env.APP_ORIGIN ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3000";
  if (
    !demoMutationOriginAllowed({
      origin: request.headers.get("origin"),
      configuredOrigin,
      host: request.headers.get("host"),
      forwardedHost: request.headers.get("x-forwarded-host"),
      forwardedProtocol: request.headers.get("x-forwarded-proto"),
      requestProtocol: new URL(request.url).protocol.slice(0, -1),
    })
  )
    return securityProblem(request, "ORIGIN_REJECTED");
  const headerToken = request.headers.get("x-csrf-token");
  const cookieToken = cookieValue(
    request.headers.get("cookie"),
    "clockwork-csrf",
  );
  if (
    !headerToken ||
    !cookieToken ||
    headerToken.length < 32 ||
    headerToken !== cookieToken
  )
    return securityProblem(request, "CSRF_REJECTED");
  return undefined;
}

function validateOrderIdempotency(request: Request): Response | undefined {
  const idempotencyKey = request.headers.get("idempotency-key")?.trim();
  if (
    !idempotencyKey ||
    idempotencyKey.length < 16 ||
    idempotencyKey.length > 255
  )
    return Response.json(
      {
        type: "https://clockwork.test/problems/idempotency",
        title: "Idempotency key required",
        status: 422,
        detail: "A valid idempotency-key header is required",
        code: "IDEMPOTENCY_KEY_REQUIRED",
        requestId: request.headers.get("x-request-id") ?? "demo",
        retryable: false,
      },
      {
        status: 422,
        headers: {
          "cache-control": "private, no-store",
          "content-type": "application/problem+json",
          "x-content-type-options": "nosniff",
        },
      },
    );
  return undefined;
}

export async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const demoAccessSecret = demoAccessConfiguration(process.env);
  if (
    demoAccessSecret &&
    !(await verifyDemoAccessCookie(
      cookieValue(request.headers.get("cookie"), demoAccessCookieName),
      demoAccessSecret,
    ))
  )
    return demoAccessProblem(request);
  // These paths bypass the proxy so a deployment adapter cannot disturb the
  // exact bytes a real signature verifier needs. The demo intentionally has no
  // verifier or provider secret, so fail closed before reading the body or
  // offering it to a generated simulator.
  if (isWebhookRequest(url)) return unavailableDemoWebhook(request);
  if (!safeMethods.has(request.method)) {
    const proofFailure = validateMutationProof(request);
    if (proofFailure) return proofFailure;
  }
  if (isOrderCommand(request, url)) {
    const idempotencyFailure = validateOrderIdempotency(request);
    if (idempotencyFailure) return idempotencyFailure;
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
  if (response) {
    response.headers.set("cache-control", "private, no-store");
    return response;
  }
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
