import { isIP } from "node:net";

import { ProblemError } from "@clockwork/contracts";
import { createMiddleware } from "hono/factory";

import type { ApiVariables } from "../context";

const requestIdPattern = /^[A-Za-z0-9._:-]{8,128}$/;
const defaultWebhookBodyLimitBytes = 1024 * 1024;

function configuredPositiveInteger(
  name: string,
  fallback: number,
  maximum: number,
): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) return fallback;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= maximum
    ? parsed
    : fallback;
}

function webhookBodyLimitBytes(): number {
  return configuredPositiveInteger(
    "WEBHOOK_MAX_BODY_BYTES",
    defaultWebhookBodyLimitBytes,
    10 * 1024 * 1024,
  );
}

function trustedProxyHops(): number {
  return configuredPositiveInteger("CLOCKWORK_TRUSTED_PROXY_HOPS", 0, 10);
}

/**
 * Forwarded addresses are ignored unless the deployment declares how many
 * right-most hops it controls. Selecting from the trusted edge inward prevents
 * a caller-prepended X-Forwarded-For value from becoming acceptance evidence.
 */
export function trustedClientIp(headers: Headers): string | null {
  const trustedHops = trustedProxyHops();
  if (trustedHops === 0) return null;
  const chain = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (chain.length < trustedHops) return null;
  const candidate = chain[chain.length - trustedHops];
  return candidate && isIP(candidate) !== 0 ? candidate : null;
}

function bodyLimitProblem(requestId: string): ProblemError {
  return new ProblemError({
    type: "https://clockwork.test/problems/webhook-body-too-large",
    title: "Webhook payload is too large",
    status: 413,
    detail: "The webhook payload exceeds the configured byte limit.",
    code: "WEBHOOK_BODY_TOO_LARGE",
    requestId,
    retryable: false,
  });
}

async function readLimitedWebhookBody(
  request: Request,
  requestId: string,
): Promise<Uint8Array> {
  const limit = webhookBodyLimitBytes();
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength &&
    (!/^\d+$/.test(declaredLength) || Number(declaredLength) > limit)
  )
    throw bodyLimitProblem(requestId);
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw bodyLimitProblem(requestId);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export const requestContextMiddleware = createMiddleware<{
  Variables: ApiVariables;
}>(async (context, next) => {
  const incoming = context.req.header("x-request-id");
  const requestId =
    incoming && requestIdPattern.test(incoming)
      ? incoming
      : crypto.randomUUID();
  const rawWebhookBody = context.req.path.startsWith("/v1/webhooks/")
    ? await readLimitedWebhookBody(context.req.raw.clone(), requestId)
    : undefined;
  context.set("requestContext", {
    requestId,
    receivedAt: new Date(),
    origin: context.req.header("origin") ?? null,
    ip: trustedClientIp(context.req.raw.headers),
    userAgent: context.req.header("user-agent") ?? null,
    authorization: null,
    ...(rawWebhookBody ? { rawWebhookBody } : {}),
  });
  context.header("x-request-id", requestId);
  await next();
});
