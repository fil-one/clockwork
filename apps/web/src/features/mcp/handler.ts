// i18n-exempt-file: MCP endpoint responses are read by MCP clients and the model, not rendered in the interface
import "server-only";

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { accessTokenRequestsPerMinute, uuidV7 } from "@clockwork/contracts";

import {
  accessTokenCommerceSession,
  accessTokenRepository,
} from "@/src/auth/access-token-session";
import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";
import {
  explicitDemoIdentityEnabled,
  runWithAccessTokenSession,
} from "@/src/auth/session";
import { getOptionalServiceDatabase } from "@/src/db/service";
import { publicMetadataOrigin } from "@/src/features/shell/public-origin";

import { mcpTools } from "./registry";
import {
  createCommerceMcpServer,
  toolAllowed,
  type RecordCall,
} from "./server";

/** A request body can carry a PDF of about 10 MB as base64. */
const maxRequestBodyBytes = 16 * 1024 * 1024;

const baseHeaders = {
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
};

function problem(
  status: number,
  code: string,
  title: string,
  headers: Record<string, string> = {},
) {
  return Response.json(
    { type: "about:blank", title, status, code },
    {
      status,
      headers: {
        ...baseHeaders,
        "content-type": "application/problem+json",
        ...headers,
      },
    },
  );
}

/**
 * One answer for a missing, unknown, expired or revoked token and for an
 * owner who lost staff access, so the response says nothing about which.
 */
const unauthorizedDescription =
  "Send a valid Fil One Commerce access token as Authorization: Bearer <token>";
const unauthorized = () =>
  problem(401, "MCP_TOKEN_REQUIRED", unauthorizedDescription, {
    "www-authenticate": `Bearer realm="Fil One Commerce", error="invalid_token", error_description="${unauthorizedDescription}"`,
  });

/** The secret from `Authorization: Bearer <token>`; cookies never count. */
export function bearerSecret(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer[ ]+([^\s]+)[ ]*$/iu.exec(header);
  return match?.[1] ?? null;
}

/**
 * The request's one JSON-RPC message. A batch is refused: one request is one
 * message, so the per-token rate limit counts every call, and the protocol
 * version the endpoint speaks has no batches.
 */
async function readMessage(
  request: Request,
): Promise<{ ok: true; message: unknown } | { ok: false; response: Response }> {
  const tooLarge = {
    ok: false as const,
    response: problem(413, "MCP_BODY_TOO_LARGE", "The request is too large"),
  };
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxRequestBodyBytes) return tooLarge;
  // Counted as it streams, so a chunked body or an understated length cannot
  // make the server buffer more than the limit.
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxRequestBodyBytes) {
        await reader.cancel().catch(() => {});
        return tooLarge;
      }
      chunks.push(value);
    }
  }
  const text = Buffer.concat(chunks).toString("utf8");
  let message: unknown;
  try {
    message = JSON.parse(text) as unknown;
  } catch {
    return {
      ok: false,
      response: problem(400, "MCP_INVALID_JSON", "The body is not JSON"),
    };
  }
  if (Array.isArray(message))
    return {
      ok: false,
      response: problem(
        400,
        "MCP_BATCH_REFUSED",
        "Send one JSON-RPC message per request",
      ),
    };
  return { ok: true, message };
}

/** The tool a `tools/call` message names, if it is one. */
function calledTool(message: unknown): string | undefined {
  if (!message || typeof message !== "object") return undefined;
  const { method, params } = message as { method?: unknown; params?: unknown };
  if (method !== "tools/call") return undefined;
  const name = (params as { name?: unknown } | undefined)?.name;
  return typeof name === "string" ? name.slice(0, 80) : "(unnamed)";
}

/**
 * The app's public origin, for links in tool results: the configured
 * canonical origin, never the request's Host in production. Elsewhere the
 * request's own origin stands in. Undefined in production without one.
 */
function appOrigin(request: Request): string | undefined {
  if (process.env.CLOCKWORK_CANONICAL_ORIGIN)
    return publicMetadataOrigin(process.env);
  return process.env.NODE_ENV === "production"
    ? undefined
    : new URL(request.url).origin;
}

/**
 * The MCP endpoint: Streamable HTTP, stateless, JSON responses. A request
 * authenticates with a personal access token in the Authorization header and
 * nothing else; the person's staff membership is read afresh, the token is
 * rate limited, and every tool call runs as that person with the same server
 * code the app uses. The guided demo has no MCP endpoint.
 */
export async function handleMcpRequest(request: Request): Promise<Response> {
  if (explicitDemoIdentityEnabled() || demoDeployIdentityEnabled(process.env))
    return problem(404, "MCP_UNAVAILABLE", "MCP is not available in the demo");
  if (request.method !== "POST")
    return problem(405, "MCP_METHOD_NOT_ALLOWED", "Use POST", {
      allow: "POST",
    });
  const secret = bearerSecret(request);
  if (!secret) return unauthorized();
  const origin = appOrigin(request);
  if (!getOptionalServiceDatabase() || !origin)
    return problem(503, "MCP_UNAVAILABLE", "MCP is not available here");
  const repository = accessTokenRepository();
  const token = await repository.authenticate(secret);
  if (!token) return unauthorized();
  if (token.windowCount > accessTokenRequestsPerMinute)
    return problem(
      429,
      "MCP_RATE_LIMITED",
      "Too many requests for this token",
      {
        "retry-after": String(token.windowResetSeconds),
      },
    );
  const session = await accessTokenCommerceSession(token);
  if (!session?.accessToken) return unauthorized();
  const body = await readMessage(request);
  if (!body.ok) return body.response;
  const accessToken = session.accessToken;
  const actor = {
    kind: "user" as const,
    id: session.userId,
    display: session.profile.name,
  };
  let ran = false;
  const record = (call: Parameters<RecordCall>[0]) => {
    ran = true;
    return repository
      .recordToolCall({
        ...call,
        tokenId: token.id,
        actor,
        requestId: uuidV7(),
      })
      .catch((error: unknown) => {
        // The call itself has happened and wrote its own audit event; the
        // missing MCP event is logged rather than reported as a failed call,
        // which a client would retry.
        // i18n-exempt: server log, never shown to readers
        console.error("MCP tool call audit failed", {
          tokenId: token.id,
          tool: call.tool,
          error: error instanceof Error ? error.name : typeof error,
        });
      });
  };
  const server = createCommerceMcpServer(
    { session: { ...session, accessToken }, origin },
    record,
  );
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
    maxRequestBodySize: maxRequestBodyBytes,
  });
  await server.connect(transport);
  try {
    const response = await runWithAccessTokenSession(session, () =>
      transport.handleRequest(request, { parsedBody: body.message }),
    );
    // A call that never reached its tool is audited too. The transport
    // refusing the request (wrong Accept or Content-Type, a malformed
    // envelope) answers with an HTTP error; the SDK refusing the call (a
    // write tool on a read-only token, an unknown tool, invalid arguments)
    // answers 200 with an error result.
    const tool = calledTool(body.message);
    if (tool && !ran) {
      const known = mcpTools.find(({ name }) => name === tool);
      await record(
        response.status !== 200
          ? {
              tool,
              outcome: "refused",
              code: "TRANSPORT_REFUSED",
              httpStatus: response.status,
            }
          : {
              tool,
              outcome: "refused",
              code: !known
                ? "UNKNOWN_TOOL"
                : toolAllowed(known, accessToken.scope)
                  ? "INVALID_ARGUMENTS"
                  : "READ_ONLY_TOKEN",
            },
      );
    }
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(baseHeaders))
      headers.set(name, value);
    return new Response(response.body, { status: response.status, headers });
  } finally {
    await server.close().catch(() => {});
  }
}
