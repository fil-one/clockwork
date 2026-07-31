import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";

import type { ApiVariables } from "../../context";

const route = createRoute({
  method: "get",
  path: "/v1/core/status",
  tags: ["core"],
  responses: {
    200: {
      description: "Core-finance lane mount",
      content: {
        "application/json": {
          schema: z.object({
            lane: z.literal("core"),
            status: z.literal("ready"),
          }),
        },
      },
    },
  },
});

export function registerCoreRoutes(
  app: OpenAPIHono<{ Variables: ApiVariables }>,
): void {
  app.openapi(route, (context) =>
    context.json({ lane: "core", status: "ready" }),
  );
}
