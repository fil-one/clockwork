import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { ProviderJsonTransport } from "../provider-transport";
import {
  RuntimeBoundaryInstrumentation,
  TelemetryProviderJsonTransport,
} from "./instrumentation";
import { ClockworkTelemetry, InMemoryTelemetrySink } from "./telemetry";

describe("TelemetryProviderJsonTransport", () => {
  it("traces a concrete provider request without capturing body, path, or idempotency value", async () => {
    const sink = new InMemoryTelemetrySink();
    const telemetry = new ClockworkTelemetry(sink);
    const inner: ProviderJsonTransport = {
      request: (input) =>
        Promise.resolve(input.response.parse({ id: "provider-object-1" })),
    };
    const transport = new TelemetryProviderJsonTransport(
      inner,
      telemetry,
      () => ({
        requestId: "request-provider-telemetry",
        workflowId: "workflow-provider-telemetry",
        taskId: "task-provider-telemetry",
        auditId: "audit-provider-telemetry",
        outboxId: "outbox-provider-telemetry",
      }),
    );
    await expect(
      transport.request({
        operation: "objects.create",
        path: "/v1/private/alice@example.test",
        body: { password: "do-not-record", email: "alice@example.test" },
        response: z.object({ id: z.string() }),
        idempotencyKey: "secret-idempotency-value",
      }),
    ).resolves.toEqual({ id: "provider-object-1" });
    const serialized = JSON.stringify(sink.spans);
    expect(serialized).not.toContain("alice@example.test");
    expect(serialized).not.toContain("do-not-record");
    expect(serialized).not.toContain("secret-idempotency-value");
    expect(sink.spans[0]).toMatchObject({
      boundary: "provider",
      attributes: {
        "provider.operation": "objects.create",
        "clockwork.request.id": "request-provider-telemetry",
        "clockwork.outbox.id": "outbox-provider-telemetry",
      },
    });
  });

  it("exposes production-callable wrappers for every non-provider runtime boundary", async () => {
    const sink = new InMemoryTelemetrySink();
    const boundaries = new RuntimeBoundaryInstrumentation(
      new ClockworkTelemetry(sink),
    );
    const input = (name: string) => ({
      name,
      correlation: {
        requestId: "request-runtime-hooks",
        workflowId: "workflow-runtime-hooks",
        taskId: "task-runtime-hooks",
        auditId: "audit-runtime-hooks",
        outboxId: "outbox-runtime-hooks",
      },
      operation: () => Promise.resolve(name),
    });
    await Promise.all([
      boundaries.server(input("server.request")),
      boundaries.api(input("api.route")),
      boundaries.db(input("db.transaction")),
      boundaries.workflow(input("workflow.task")),
      boundaries.webhook(input("webhook.verify")),
      boundaries.queue(input("queue.claim")),
      boundaries.outbox(input("outbox.dispatch")),
    ]);
    expect(sink.spans.map(({ boundary }) => boundary).sort()).toEqual([
      "api",
      "db",
      "outbox",
      "queue",
      "server",
      "webhook",
      "workflow",
    ]);
  });
});
