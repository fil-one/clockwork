import { createHash } from "node:crypto";

import { createDemoCommerceHandlers } from "@clockwork/testing/demo-handlers";
import { DEMO_ORIGIN } from "@clockwork/testing/demo-seed";
import type { SessionClaims } from "@clockwork/api";
import { hasPermission } from "@clockwork/contracts";
import { getResponse } from "msw";

import {
  demoAccessConfiguration,
  demoAccessCookieName,
  verifyDemoAccessCookie,
} from "@/src/auth/demo-access";
import { ExperienceProblem } from "@/src/features/experience-server/model";

// The same generated-contract simulators the browser suites run against, served
// from the server so nothing intercepts requests in a prospect's browser. The
// handlers already require an idempotency key and a CSRF token on every
// mutation, and the browser document boundary mints the clockwork-csrf cookie
// the client reads.
const handlers = [...createDemoCommerceHandlers()];
const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Stateful demo command lanes run the product's own domain behavior over
 * resettable demo records. Each lane keeps the same identity, authorization,
 * origin, CSRF, and replay boundary as its production-shaped endpoint. Routes
 * that remain on the generated handlers are deterministic contract simulations;
 * their responses must not imply that a durable decision or provider action ran.
 */
function isOrderCommand(request: Request, url: URL): boolean {
  return (
    request.method === "POST" &&
    url.pathname.replace(/^\/api/, "") === "/v1/core/commands/orders"
  );
}

function isPriceBookCommand(request: Request, url: URL): boolean {
  return (
    request.method === "POST" &&
    url.pathname.replace(/^\/api/, "") === "/v1/core/commands/price_books"
  );
}

function isDealRegistrationCommand(request: Request, url: URL): boolean {
  return (
    request.method === "POST" &&
    url.pathname.replace(/^\/api/, "") ===
      "/v1/core/commands/deal_registrations"
  );
}

function isQuoteCommand(request: Request, url: URL): boolean {
  return (
    request.method === "POST" &&
    url.pathname.replace(/^\/api/, "") === "/v1/core/commands/quotes"
  );
}

function demoPartnerBrandAccountId(
  request: Request,
  url: URL,
): string | undefined {
  if (request.method !== "POST") return undefined;
  const match =
    /^\/api\/v1\/lifecycle\/partners\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/domains$/iu.exec(
      url.pathname,
    );
  return match?.[1];
}

function isDemoPartnerRenewalPath(request: Request, url: URL): boolean {
  return (
    request.method === "POST" &&
    /^\/api\/v1\/lifecycle\/renewals\/demo-partner-renewal-ec-00(?:38|41|47)\/(?:requests|declines)$/u.test(
      url.pathname,
    )
  );
}

function isDemoCustomerAccountControl(request: Request, url: URL): boolean {
  if (
    request.method === "GET" &&
    url.pathname === "/api/v1/core/records/accounts"
  )
    return true;
  if (
    request.method === "POST" &&
    url.pathname === "/api/v1/core/commands/accounts"
  )
    return true;
  if (
    request.method === "PUT" &&
    url.pathname === "/api/v1/notifications/preferences"
  )
    return true;
  if (
    request.method === "POST" &&
    /^\/api\/v1\/lifecycle\/organizations\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/invites$/iu.test(
      url.pathname,
    )
  )
    return true;
  return (
    request.method === "PUT" &&
    /^\/api\/v1\/lifecycle\/accounts\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/procurement-profile$/iu.test(
      url.pathname,
    )
  );
}

function isDemoInvoicePayment(request: Request, url: URL): boolean {
  return (
    request.method === "POST" &&
    (url.pathname === "/api/demo/payments/sessions" ||
      /^\/api\/demo\/payments\/sessions\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/complete$/iu.test(
        url.pathname,
      ))
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
      // i18n-exempt: API problem text for API callers; the UI words failures from status and code (contracts/error-text.ts)
      title: "Provider webhooks are unavailable in the demo",
      status: 503,
      detail:
        // i18n-exempt: API problem text for API callers; the UI words failures from status and code (contracts/error-text.ts)
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
      // i18n-exempt: API problem text for API callers; the UI words failures from status and code (contracts/error-text.ts)
      title: "Demo access is required",
      status: 403,
      // i18n-exempt: API problem text for API callers; the UI words failures from status and code (contracts/error-text.ts)
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

function demoIdentityProblem(request: Request, unavailable: boolean): Response {
  const status = unavailable ? 503 : 401;
  return Response.json(
    {
      type: `https://clockwork.test/problems/demo-identity-${unavailable ? "unavailable" : "required"}`,
      title: unavailable
        ? "Demo identity is temporarily unavailable" // i18n-exempt: API problem text for API callers; the UI words failures from status and code (contracts/error-text.ts)
        : "Demo identity is required", // i18n-exempt: API problem text for API callers; the UI words failures from status and code (contracts/error-text.ts)
      status,
      detail: unavailable
        ? "The demo could not establish an identity for this request." // i18n-exempt: API problem text for API callers; the UI words failures from status and code (contracts/error-text.ts)
        : "A valid demo identity is required for this operation.", // i18n-exempt: API problem text for API callers; the UI words failures from status and code (contracts/error-text.ts)
      code: unavailable
        ? "DEMO_IDENTITY_UNAVAILABLE"
        : "DEMO_IDENTITY_REQUIRED",
      requestId: request.headers.get("x-request-id") ?? "demo",
      retryable: unavailable,
    },
    {
      status,
      headers: {
        "cache-control": "private, no-store",
        "content-type": "application/problem+json",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

function immutableSession(session: SessionClaims): SessionClaims {
  return Object.freeze({
    ...session,
    accountIds: Object.freeze([...session.accountIds]),
    roles: Object.freeze([...session.roles]),
    ...(session.impersonation
      ? { impersonation: Object.freeze({ ...session.impersonation }) }
      : {}),
  });
}

async function demoCoreSession(
  request: Request,
): Promise<
  { readonly session: SessionClaims } | { readonly response: Response }
> {
  try {
    const { WorkosNextSessionResolver } = await import("@/src/auth/session");
    const session = await new WorkosNextSessionResolver({
      requireBoundSession: true,
    }).resolve(request);
    return session
      ? { session: immutableSession(session) }
      : { response: demoIdentityProblem(request, false) };
  } catch {
    return { response: demoIdentityProblem(request, true) };
  }
}

function securityProblem(
  request: Request,
  code: "ORIGIN_REJECTED" | "CSRF_REJECTED",
): Response {
  const origin = code === "ORIGIN_REJECTED";
  return Response.json(
    {
      type: `https://clockwork.test/problems/${origin ? "origin" : "csrf"}`,
      // i18n-exempt: API problem text for API callers; the UI words failures from status and code (contracts/error-text.ts)
      title: origin ? "Origin rejected" : "CSRF validation failed",
      status: 403,
      detail: origin
        ? "The request origin is not allowed." // i18n-exempt: API problem text for API callers; the UI words failures from status and code (contracts/error-text.ts)
        : "Provide the double-submit CSRF token.", // i18n-exempt: API problem text for API callers; the UI words failures from status and code (contracts/error-text.ts)
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
        // i18n-exempt: API problem text for API callers; the UI words failures from status and code (contracts/error-text.ts)
        title: "Idempotency key required",
        status: 422,
        // i18n-exempt: API problem text for API callers; the UI words failures from status and code (contracts/error-text.ts)
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

function queueRefreshProblem(
  request: Request,
  status: number,
  code: string,
  detail: string,
): Response {
  return Response.json(
    {
      type: `https://clockwork.test/problems/${code.toLowerCase().replaceAll("_", "-")}`,
      // i18n-exempt: API problem text for API callers; the UI words failures from status and code (contracts/error-text.ts)
      title: "Queue refresh refused",
      status,
      detail,
      code,
      requestId: request.headers.get("x-request-id") ?? "demo",
      retryable: status >= 500,
    },
    {
      status,
      headers: {
        "cache-control": "private, no-store",
        "content-type": "application/problem+json",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

/**
 * Next may materialize an empty incoming POST as a non-null ReadableStream.
 * Classify the encoded request metadata rather than consuming that stream:
 * doing so preserves the destination's no-body/no-buffer guarantee while
 * accepting the deployed adapter's explicit zero-length representation.
 */
function queueRefreshIsBodyless(request: Request): boolean {
  if (request.headers.has("transfer-encoding")) return false;
  const contentLength = request.headers.get("content-length");
  return contentLength === null ? request.body === null : contentLength === "0";
}

function quoteRoutingProblem(
  request: Request,
  code: "AMBIGUOUS_QUOTE_AUTHORITY" | "QUOTE_AUTHORITY_FORBIDDEN",
  detail: string,
): Response {
  return Response.json(
    {
      type: `https://clockwork.test/problems/${code.toLowerCase().replaceAll("_", "-")}`,
      // i18n-exempt: API problem text for API callers; the UI words failures from status and code (contracts/error-text.ts)
      title: "Quote command refused",
      status: 403,
      detail,
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

/** Destination security for the demo-only operational queue refresh. */
export async function handleDemoQueueProjectionRefresh(
  request: Request,
): Promise<Response> {
  if (new URL(request.url).pathname !== "/api/demo/projections/queues/refresh")
    return queueRefreshProblem(
      request,
      404,
      "DEMO_QUEUE_REFRESH_NOT_FOUND",
      // i18n-exempt: API problem text for API callers; the UI words failures from status and code (contracts/error-text.ts)
      "This demo operation is not available at the requested path.",
    );
  const demoAccessSecret = demoAccessConfiguration(process.env);
  if (
    demoAccessSecret &&
    !(await verifyDemoAccessCookie(
      cookieValue(request.headers.get("cookie"), demoAccessCookieName),
      demoAccessSecret,
    ))
  )
    return demoAccessProblem(request);
  if (request.method !== "POST")
    return queueRefreshProblem(
      request,
      405,
      "METHOD_NOT_ALLOWED",
      // i18n-exempt: API problem text for API callers; the UI words failures from status and code (contracts/error-text.ts)
      "Queue refresh requires POST.",
    );
  const proofFailure = validateMutationProof(request);
  if (proofFailure) return proofFailure;
  const idempotencyFailure = validateOrderIdempotency(request);
  if (idempotencyFailure) return idempotencyFailure;
  if (!queueRefreshIsBodyless(request))
    return queueRefreshProblem(
      request,
      422,
      "INVALID_DEMO_QUEUE_REFRESH",
      // i18n-exempt: API problem text for API callers; the UI words failures from status and code (contracts/error-text.ts)
      "Queue refresh does not accept a request body.",
    );
  const identity = await demoCoreSession(request);
  if ("response" in identity) return identity.response;
  if (
    !identity.session.isInternalStaff ||
    !identity.session.roles.some((role) =>
      hasPermission(role, "system:operate"),
    )
  )
    return queueRefreshProblem(
      request,
      403,
      "QUEUE_REFRESH_FORBIDDEN",
      // i18n-exempt: API problem text for API callers; the UI words failures from status and code (contracts/error-text.ts)
      "Internal system-operation authority is required.",
    );
  const requestDigest = createHash("sha256")
    .update(request.method)
    .update("\0")
    .update(new URL(request.url).pathname)
    .update("\0")
    .update(new Uint8Array())
    .digest("hex");
  try {
    const { refreshDemoQueueProjections } =
      await import("@/src/features/experience-server/projection-source");
    const result = await refreshDemoQueueProjections({
      actorId: identity.session.userId,
      idempotencyKey: request.headers.get("idempotency-key")?.trim() ?? "",
      requestDigest,
    });
    return Response.json(result, {
      headers: {
        "cache-control": "private, no-store",
        "idempotency-replayed": String(result.replayed),
      },
    });
  } catch (error) {
    return error instanceof ExperienceProblem
      ? queueRefreshProblem(request, error.status, error.code, error.message)
      : queueRefreshProblem(
          request,
          500,
          "DEMO_QUEUE_REFRESH_FAILED",
          // i18n-exempt: API problem text for API callers; the UI words failures from status and code (contracts/error-text.ts)
          "The demo queue refresh could not be recorded.",
        );
  }
}

export async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const partnerBrandAccountId = demoPartnerBrandAccountId(request, url);
  const partnerRenewalPath = isDemoPartnerRenewalPath(request, url);
  const customerAccountControl = isDemoCustomerAccountControl(request, url);
  const demoInvoicePayment = isDemoInvoicePayment(request, url);
  const paygPolicyPath =
    url.pathname === "/api/v1/core/payg-offers" ||
    url.pathname.startsWith("/api/v1/core/payg-offers/");
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
  if (
    paygPolicyPath ||
    isOrderCommand(request, url) ||
    isPriceBookCommand(request, url) ||
    isDealRegistrationCommand(request, url) ||
    isQuoteCommand(request, url) ||
    partnerBrandAccountId ||
    partnerRenewalPath ||
    customerAccountControl ||
    demoInvoicePayment
  ) {
    if (request.method !== "GET") {
      const idempotencyFailure = validateOrderIdempotency(request);
      if (idempotencyFailure) return idempotencyFailure;
    }
    // Resolve identity from this exact request before its body is consumed or
    // the command lane is loaded. Raw API routes do not rely on Next's ambient
    // cookies()/headers() request store: serverless connection teardown and
    // deferred module loading must not be able to detach authorization from
    // the bytes the destination executes.
    const identity = await demoCoreSession(request);
    if ("response" in identity) return identity.response;
    if (paygPolicyPath) {
      const lane =
        await import("@/src/features/internal-ops/commercial-policies/demo-payg-handler");
      return lane.handleDemoPaygPolicy(request, identity.session);
    }
    if (demoInvoicePayment) {
      const lane =
        await import("@/src/features/experience-server/demo-invoice-payment");
      return lane.handleDemoInvoicePayment(request, identity.session);
    }
    if (customerAccountControl) {
      const lane =
        await import("@/src/features/experience-server/demo-account-controls");
      return lane.handleDemoCustomerAccountControl(request, identity.session);
    }
    if (partnerBrandAccountId) {
      const lane =
        await import("@/src/features/customer-partner/partner/demo-partner-brand");
      return lane.handleDemoPartnerBrand(
        request,
        identity.session,
        partnerBrandAccountId,
      );
    }
    if (partnerRenewalPath) {
      const lane =
        await import("@/src/features/customer-partner/partner/demo-partner-renewal");
      const target = lane.demoPartnerRenewalOrderId(url.pathname);
      // i18n-exempt: server-side invariant for logs; in production readers get the translated error page and a digest
      if (!target) throw new Error("Demo renewal route drifted after matching");
      return lane.handleDemoPartnerRenewal(request, identity.session, target);
    }
    if (isPriceBookCommand(request, url)) {
      const lane =
        await import("@/src/features/internal-ops/price-books/demo-price-book-command");
      return lane.handleDemoPriceBookCommand(request, identity.session);
    }
    if (isDealRegistrationCommand(request, url)) {
      const lane =
        await import("@/src/features/customer-partner/partner/demo-deal-registration");
      return lane.handleDemoDealRegistrationCommand(request, identity.session);
    }
    if (isQuoteCommand(request, url)) {
      const partnerRoles = identity.session.roles.filter(
        (role) => role === "partner_admin" || role === "partner_seller",
      );
      if (partnerRoles.length > 0) {
        if (
          identity.session.isInternalStaff ||
          partnerRoles.length !== identity.session.roles.length
        )
          return quoteRoutingProblem(
            request,
            "AMBIGUOUS_QUOTE_AUTHORITY",
            // i18n-exempt: API problem text for API callers; the UI words failures from status and code (contracts/error-text.ts)
            "A mixed or internal session cannot enter the partner quote lane.",
          );
        const lane =
          await import("@/src/features/customer-partner/partner/demo-partner-quote");
        return lane.handleDemoPartnerQuoteCommand(request, identity.session);
      }
      if (identity.session.isInternalStaff)
        return quoteRoutingProblem(
          request,
          "QUOTE_AUTHORITY_FORBIDDEN",
          // i18n-exempt: API problem text for API callers; the UI words failures from status and code (contracts/error-text.ts)
          "Internal sessions cannot create customer demo quotes.",
        );
      const lane =
        await import("@/src/features/experience-server/demo-quote-command");
      return lane.handleDemoQuoteCommand(request, identity.session);
    }
    // Loaded on demand, the way this route already loads its two apps: the
    // order lane pulls in the domain, the document renderer and the demo state
    // store, and no other request needs any of them.
    const lane =
      await import("@/src/features/experience-server/demo-order-command");
    return lane.handleDemoOrderCommand(request, identity.session);
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
      // i18n-exempt: API problem text for API callers; the UI words failures from status and code (contracts/error-text.ts)
      title: "The demo does not simulate this operation",
      status: 404,
      // i18n-exempt: API problem text for API callers; the UI words failures from status and code (contracts/error-text.ts)
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

export async function handleDemoProvisionOrder(
  request: Request,
): Promise<Response> {
  if (new URL(request.url).pathname !== "/api/demo/orders/provision")
    return queueRefreshProblem(
      request,
      404,
      "DEMO_QUEUE_REFRESH_NOT_FOUND",
      // i18n-exempt: API problem text for API callers; the UI words failures from status and code (contracts/error-text.ts)
      "This demo operation is not available at the requested path.",
    );
  const demoAccessSecret = demoAccessConfiguration(process.env);
  if (
    demoAccessSecret &&
    !(await verifyDemoAccessCookie(
      cookieValue(request.headers.get("cookie"), demoAccessCookieName),
      demoAccessSecret,
    ))
  )
    return demoAccessProblem(request);
  if (request.method !== "POST")
    return queueRefreshProblem(
      request,
      405,
      "METHOD_NOT_ALLOWED",
      // i18n-exempt: API problem text for API callers; the UI words failures from status and code (contracts/error-text.ts)
      "Queue refresh requires POST.",
    );
  const proofFailure = validateMutationProof(request);
  if (proofFailure) return proofFailure;
  const idempotencyFailure = validateOrderIdempotency(request);
  if (idempotencyFailure) return idempotencyFailure;
  const identity = await demoCoreSession(request);
  if ("response" in identity) return identity.response;
  if (
    !identity.session.isInternalStaff ||
    !identity.session.roles.some((role) =>
      hasPermission(role, "system:operate"),
    )
  )
    return queueRefreshProblem(
      request,
      403,
      "PROVISIONING_FORBIDDEN",
      // i18n-exempt: API problem text for API callers; the UI words failures from status and code (contracts/error-text.ts)
      "Internal operations authority is required.",
    );
  try {
    const body = await request.text();
    if (body.length > 1024) return new Response(null, { status: 413 });
    const { submitDemoProvisioning } =
      await import("@/src/features/experience-server/demo-provision-order");
    return Response.json(
      await submitDemoProvisioning(JSON.parse(body), identity.session),
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        // A stable code the handoff can word in the reader's language; the
        // detail stays English for logs and API callers.
        code: "DEMO_PROVISIONING_REFUSED",
        detail:
          error instanceof Error
            ? error.message
            : "Unable to submit provisioning.", // i18n-exempt: API problem detail for logs and API callers; demo-order-handoff words `code`
      },
      { status: 422 },
    );
  }
}

export { validateMutationProof as validateDemoMutationProof };
