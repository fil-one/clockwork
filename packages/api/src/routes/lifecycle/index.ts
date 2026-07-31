import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";

import type { ApiVariables } from "../../context";

const route = createRoute({
  method: "get",
  path: "/v1/lifecycle/status",
  tags: ["lifecycle"],
  responses: {
    200: {
      description: "Lifecycle-platform lane mount",
      content: {
        "application/json": {
          schema: z.object({
            lane: z.literal("lifecycle"),
            status: z.literal("ready"),
          }),
        },
      },
    },
  },
});

export function registerLifecycleRoutes(
  app: OpenAPIHono<{ Variables: ApiVariables }>,
): void {
  app.openapi(route, (context) =>
    context.json({ lane: "lifecycle", status: "ready" }),
  );
}
