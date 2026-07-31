import { ProblemError } from "@clockwork/contracts";
import { createMiddleware } from "hono/factory";

import type { ApiVariables } from "../context";

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

function cookieValue(
  cookie: string | undefined,
  name: string,
): string | undefined {
  return cookie
    ?.split(";")
    .map((part) => part.trim().split("="))
    .find(([key]) => key === name)?.[1];
}

export const csrfAndOriginMiddleware = createMiddleware<{
  Variables: ApiVariables;
}>(async (context, next) => {
  if (
    safeMethods.has(context.req.method) ||
    context.req.path.startsWith("/v1/webhooks/")
  ) {
    await next();
    return;
  }

  const request = context.get("requestContext");
  const allowedOrigin = new URL(
    process.env.APP_ORIGIN ??
      process.env.NEXT_PUBLIC_APP_URL ??
      "http://localhost:3000",
  ).origin;
  if (request.origin !== allowedOrigin) {
    throw new ProblemError({
      type: "https://clockwork.test/problems/origin",
      title: "Origin rejected",
      status: 403,
      detail: "The request origin is not allowed.",
      code: "ORIGIN_REJECTED",
      requestId: request.requestId,
      retryable: false,
    });
  }

  const headerToken = context.req.header("x-csrf-token");
  const cookieToken = cookieValue(
    context.req.header("cookie"),
    "clockwork-csrf",
  );
  if (
    !headerToken ||
    !cookieToken ||
    headerToken.length < 32 ||
    headerToken !== cookieToken
  ) {
    throw new ProblemError({
      type: "https://clockwork.test/problems/csrf",
      title: "CSRF validation failed",
      status: 403,
      detail: "Provide the double-submit CSRF token.",
      code: "CSRF_REJECTED",
      requestId: request.requestId,
      retryable: false,
    });
  }
  await next();
});
