import { ProblemError, uuidV7 } from "@clockwork/contracts";
import { OpenAPIHono } from "@hono/zod-openapi";

import { LocalSessionResolver, sessionMiddleware } from "./auth/session";
import type { SessionResolver } from "./auth/session";
import type { ApiVariables } from "./context";
import { withExperienceOpenApiContract } from "./experience-openapi";
import {
  idempotencyMiddleware,
  MemoryIdempotencyStore,
} from "./middleware/idempotency";
import type { IdempotencyStore } from "./middleware/idempotency";
import { requestContextMiddleware } from "./middleware/request-context";
import { createCsrfAndOriginMiddleware } from "./middleware/security";
import type { TrustedOriginResolver } from "./middleware/security";
import { registerCoreRoutes } from "./routes/core";
import type { CoreRouteDependencies } from "./routes/core";
import { registerLifecycleRoutes } from "./routes/lifecycle";
import type { LifecycleRouteDependencies } from "./routes/lifecycle";
import { registerSystemRoutes } from "./routes/system";
import type { SystemRouteDependencies } from "./routes/system";

export interface ApiAppOptions {
  sessionResolver?: SessionResolver;
  idempotencyStore?: IdempotencyStore;
  core?: CoreRouteDependencies;
  lifecycle?: LifecycleRouteDependencies;
  system?: SystemRouteDependencies;
  trustedOriginResolver?: TrustedOriginResolver;
}

export function createApiApp(options: ApiAppOptions = {}) {
  const app = new OpenAPIHono<{ Variables: ApiVariables }>({
    defaultHook: (result, context) => {
      if (result.success) return;
      const requestId = context.get("requestContext")?.requestId ?? uuidV7();
      return context.json(
        {
          type: "https://clockwork.test/problems/validation",
          title: "Request validation failed",
          status: 422,
          detail: "The request did not match its schema.",
          code: "VALIDATION_FAILED",
          requestId,
          errors: {
            request: result.error.issues.map((issue) => issue.message),
          },
          retryable: false,
        },
        422,
        { "content-type": "application/problem+json" },
      );
    },
  });

  app.use("*", requestContextMiddleware);
  app.use("*", createCsrfAndOriginMiddleware(options.trustedOriginResolver));
  app.use(
    "*",
    sessionMiddleware(options.sessionResolver ?? new LocalSessionResolver()),
  );
  app.use(
    "*",
    idempotencyMiddleware(
      options.idempotencyStore ?? new MemoryIdempotencyStore(),
    ),
  );

  app.onError((error, context) => {
    const requestId = context.get("requestContext")?.requestId ?? uuidV7();
    const problem =
      error instanceof ProblemError
        ? error.problem
        : {
            type: "https://clockwork.test/problems/internal",
            title: "Internal server error",
            status: 500,
            detail:
              process.env.NODE_ENV === "production" ? undefined : error.message,
            code: "INTERNAL_ERROR",
            requestId,
            retryable: false,
          };
    return context.json(problem, problem.status as 500, {
      "content-type": "application/problem+json",
      "x-request-id": requestId,
    });
  });

  registerCoreRoutes(app, options.core);
  registerLifecycleRoutes(app, options.lifecycle);
  registerSystemRoutes(app, options.system);

  app.get("/openapi.json", (context) =>
    context.json(
      withExperienceOpenApiContract(
        app.getOpenAPIDocument({
          openapi: "3.1.0",
          info: { title: "Clockwork Commerce API", version: "1.0.0" },
        }),
      ),
    ),
  );
  return app;
}

export type ClockworkApi = ReturnType<typeof createApiApp>;
