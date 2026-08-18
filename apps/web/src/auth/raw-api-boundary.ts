import { uuidV7 } from "@clockwork/contracts";
import {
  applyResponseHeaders,
  authkit,
  getTokenClaims,
  isAuthkitRequestHeader,
  partitionAuthkitHeaders,
  type UserInfo,
} from "@workos-inc/authkit-nextjs";
import { NextRequest, NextResponse } from "next/server";

import {
  demoAccessConfiguration,
  demoAccessCookieName,
  verifyDemoAccessCookie,
} from "./demo-access";
import { demoDeployIdentityEnabled } from "./demo-deploy";
import { releaseProofConfiguration } from "./release-proof";
import {
  type WorkosNextSessionResolver,
  workosAuthenticationConfigured,
} from "./session";

const apiRequestIdPattern = /^[A-Za-z0-9._:-]{8,128}$/u;

type ApiAuthenticationCode =
  | "AUTHENTICATION_REQUIRED"
  | "AUTHENTICATION_NOT_CONFIGURED"
  | "AUTHKIT_UNAVAILABLE"
  | "AUTHKIT_IDENTITY_MISMATCH"
  | "AUTHKIT_HEADER_REJECTED"
  | "DEMO_ACCESS_REQUIRED"
  | "ORGANIZATION_SELECTION_REQUIRED";

function authenticationProblem(input: {
  readonly requestId: string;
  readonly status: 401 | 403 | 503;
  readonly code: ApiAuthenticationCode;
  readonly title: string;
  readonly detail: string;
}): NextResponse {
  return NextResponse.json(
    {
      type: `https://clockwork.test/problems/${input.code
        .toLowerCase()
        .replaceAll("_", "-")}`,
      title: input.title,
      status: input.status,
      detail: input.detail,
      code: input.code,
      requestId: input.requestId,
      retryable: input.status === 503,
    },
    {
      status: input.status,
      headers: {
        "cache-control": "private, no-store",
        "content-type": "application/problem+json",
        "x-request-id": input.requestId,
        "x-content-type-options": "nosniff",
      },
    },
  );
}

function withAuthkitResponseHeaders(
  response: Response,
  headers: Headers,
): NextResponse {
  return applyResponseHeaders(
    new NextResponse(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    }),
    headers,
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

function requestId(request: Request): string {
  const supplied = request.headers.get("x-request-id");
  return supplied && apiRequestIdPattern.test(supplied) ? supplied : uuidV7();
}

function forwardedRequest(request: Request, target: URL): Request {
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers: new Headers(request.headers),
    signal: request.signal,
  };
  // `new Request(target, request)` is not a portable raw-body forwarding
  // mechanism. Move the original stream exactly once, without cloning,
  // buffering, or asking AuthKit to inspect it. The route handler remains the
  // first and only component that interprets the bytes.
  if (request.body) {
    init.body = request.body;
    init.duplex = "half";
  }
  return new Request(target, init);
}

export interface RawApiBoundaryInput {
  readonly request: Request;
  readonly sessionResolver: WorkosNextSessionResolver;
  readonly dispatch: (request: Request, requestId: string) => Promise<Response>;
  /** Rewrites only the URL; method, headers, signal, and body stay untouched. */
  readonly targetUrl?: URL;
  /** Webhooks and the registration bootstrap authenticate in their handlers. */
  readonly authenticationRequired?: boolean;
  /** Direct demo API routes must replace the password gate the proxy provided. */
  readonly requireDemoAccess?: boolean;
}

/**
 * Self-authenticating API boundary for routes excluded from Next middleware.
 *
 * AuthKit receives a bodyless, header-only request. Its verified identity is
 * then bound to the exact Request object dispatched in-process, so neither a
 * caller-supplied internal header nor a second unverified request can inherit
 * the session. Release-proof and explicit demo identity continue to resolve
 * inside `WorkosNextSessionResolver`, using this request's own origin/cookies.
 */
export async function withRawApiAuthentication(
  input: RawApiBoundaryInput,
): Promise<Response> {
  const id = requestId(input.request);
  for (const name of input.request.headers.keys())
    if (isAuthkitRequestHeader(name))
      return authenticationProblem({
        requestId: id,
        status: 403,
        code: "AUTHKIT_HEADER_REJECTED",
        title: "Authentication header rejected",
        detail: "Internal AuthKit headers cannot be supplied by an API caller.",
      });

  if (input.requireDemoAccess) {
    const secret = demoAccessConfiguration(process.env);
    if (
      secret &&
      !(await verifyDemoAccessCookie(
        cookieValue(input.request.headers.get("cookie"), demoAccessCookieName),
        secret,
      ))
    )
      return authenticationProblem({
        requestId: id,
        status: 403,
        code: "DEMO_ACCESS_REQUIRED",
        title: "Demo access is required",
        detail: "A valid demo access grant is required.",
      });
  }

  const authenticationRequired = input.authenticationRequired ?? true;
  const releaseProof = releaseProofConfiguration();
  const workosConfigured = workosAuthenticationConfigured();
  const demoIdentity = demoDeployIdentityEnabled(process.env);
  if (
    authenticationRequired &&
    !releaseProof &&
    !workosConfigured &&
    !demoIdentity &&
    process.env.NODE_ENV === "production"
  )
    return authenticationProblem({
      requestId: id,
      status: 503,
      code: "AUTHENTICATION_NOT_CONFIGURED",
      title: "Authentication is not configured",
      detail: "This API cannot accept authenticated requests right now.",
    });

  let verifiedWorkosSession: UserInfo | undefined;
  let authkitResponseHeaders: Headers | undefined;
  if (authenticationRequired && !releaseProof && workosConfigured) {
    const authHeaders = new Headers(input.request.headers);
    authHeaders.set("x-request-id", id);
    const authRequest = new NextRequest(input.request.url, {
      method: input.request.method,
      headers: authHeaders,
    });
    let verified: Awaited<ReturnType<typeof authkit>>;
    try {
      verified = await authkit(authRequest, {
        redirectUri:
          process.env.WORKOS_REDIRECT_URI ??
          "http://localhost:3000/auth/callback",
      });
    } catch {
      return authenticationProblem({
        requestId: id,
        status: 503,
        code: "AUTHKIT_UNAVAILABLE",
        title: "Authentication is temporarily unavailable",
        detail: "The authentication service could not verify this request.",
      });
    }
    authkitResponseHeaders = partitionAuthkitHeaders(
      authRequest,
      verified.headers,
    ).responseHeaders;
    if (!verified.session.user)
      return withAuthkitResponseHeaders(
        authenticationProblem({
          requestId: id,
          status: 401,
          code: "AUTHENTICATION_REQUIRED",
          title: "Authentication required",
          detail: "A valid WorkOS session is required for this API route.",
        }),
        authkitResponseHeaders,
      );
    if (!verified.session.organizationId)
      return withAuthkitResponseHeaders(
        authenticationProblem({
          requestId: id,
          status: 403,
          code: "ORGANIZATION_SELECTION_REQUIRED",
          title: "Organization selection required",
          detail: "Select a WorkOS organization before using this API route.",
        }),
        authkitResponseHeaders,
      );
    const tokenClaims = await getTokenClaims<{ sub?: unknown }>(
      verified.session.accessToken,
    ).catch(() => undefined);
    if (
      typeof tokenClaims?.sub !== "string" ||
      tokenClaims.sub !== verified.session.user.id
    )
      return withAuthkitResponseHeaders(
        authenticationProblem({
          requestId: id,
          status: 401,
          code: "AUTHKIT_IDENTITY_MISMATCH",
          title: "Authenticated identity is invalid",
          detail:
            "The WorkOS session user does not match the verified access token.",
        }),
        authkitResponseHeaders,
      );
    verifiedWorkosSession = verified.session;
  }

  const apiRequest = forwardedRequest(
    input.request,
    input.targetUrl ?? new URL(input.request.url),
  );
  apiRequest.headers.set("x-request-id", id);
  if (verifiedWorkosSession)
    input.sessionResolver.bindVerifiedSession(
      apiRequest,
      verifiedWorkosSession,
    );
  const response = await input.dispatch(apiRequest, id);
  const finalResponse = authkitResponseHeaders
    ? withAuthkitResponseHeaders(response, authkitResponseHeaders)
    : response;
  finalResponse.headers.set("cache-control", "private, no-store");
  finalResponse.headers.set("x-request-id", id);
  return finalResponse;
}
