import { createMiddleware } from "hono/factory";

import type { ApiVariables } from "../context";

const requestIdPattern = /^[A-Za-z0-9._:-]{8,128}$/;

export const requestContextMiddleware = createMiddleware<{
  Variables: ApiVariables;
}>(async (context, next) => {
  const incoming = context.req.header("x-request-id");
  const requestId =
    incoming && requestIdPattern.test(incoming)
      ? incoming
      : crypto.randomUUID();
  const rawWebhookBody = context.req.path.startsWith("/v1/webhooks/")
    ? new Uint8Array(await context.req.raw.clone().arrayBuffer())
    : undefined;
  context.set("requestContext", {
    requestId,
    receivedAt: new Date(),
    origin: context.req.header("origin") ?? null,
    ip: context.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: context.req.header("user-agent") ?? null,
    authorization: null,
    ...(rawWebhookBody ? { rawWebhookBody } : {}),
  });
  context.header("x-request-id", requestId);
  await next();
});
