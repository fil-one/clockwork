import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { ProviderJsonTransport } from "../provider-transport";
import {
  RuntimeBoundaryInstrumentation,
  TelemetryProviderJsonTransport,
} from "./instrumentation";
import {
  ClockworkTelemetry,
  InMemoryTelemetrySink,
  type TelemetrySink,
} from "./telemetry";

const failingSink: TelemetrySink = {
  export: () => Promise.reject(new Error("collector unavailable")),
};

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
      undefined,
      "accounting",
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
        "provider.name": "accounting",
        "clockwork.request.id": "request-provider-telemetry",
        "clockwork.outbox.id": "outbox-provider-telemetry",
      },
    });
  });

  it("does not turn exporter failure into provider success failure or mask the provider error", async () => {
    const telemetry = new ClockworkTelemetry(failingSink);
    const successful = new TelemetryProviderJsonTransport(
      {
        request: (input) =>
          Promise.resolve(input.response.parse({ id: "provider-object-2" })),
      },
      telemetry,
      () => ({ requestId: "request-provider-export-failure" }),
    );
    await expect(
      successful.request({
        operation: "objects.create",
        path: "/v1/objects",
        body: {},
        response: z.object({ id: z.string() }),
      }),
    ).resolves.toEqual({ id: "provider-object-2" });

    const providerError = new Error("provider operation failed");
    const failed = new TelemetryProviderJsonTransport(
      { request: () => Promise.reject(providerError) },
      telemetry,
      () => ({ requestId: "request-provider-operation-failure" }),
    );
    await expect(
      failed.request({
        operation: "objects.create",
        path: "/v1/objects",
        body: {},
        response: z.object({ id: z.string() }),
      }),
    ).rejects.toBe(providerError);
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

  it("inherits one trace through nested API, database, workflow, and provider boundaries", async () => {
    const sink = new InMemoryTelemetrySink();
    const boundaries = new RuntimeBoundaryInstrumentation(
      new ClockworkTelemetry(sink),
    );
    await boundaries.api({
      name: "api.request",
      correlation: { requestId: "request-correlated-runtime" },
      operation: () =>
        boundaries.db({
          name: "db.authorized_transaction",
          correlation: { requestId: "request-correlated-runtime" },
          operation: () =>
            boundaries.workflow({
              name: "workflow.execute",
              correlation: { workflowId: "workflow-correlated-runtime" },
              operation: () =>
                boundaries.provider({
                  name: "provider.send",
                  correlation: { taskId: "task-correlated-runtime" },
                  operation: () => Promise.resolve("complete"),
                }),
            }),
        }),
    });

    expect(new Set(sink.spans.map(({ traceId }) => traceId)).size).toBe(1);
    const byBoundary = new Map(sink.spans.map((span) => [span.boundary, span]));
    expect(byBoundary.get("db")?.parentSpanId).toBe(
      byBoundary.get("api")?.spanId,
    );
    expect(byBoundary.get("workflow")?.parentSpanId).toBe(
      byBoundary.get("db")?.spanId,
    );
    expect(byBoundary.get("provider")?.parentSpanId).toBe(
      byBoundary.get("workflow")?.spanId,
    );
    expect(byBoundary.get("provider")?.attributes).toMatchObject({
      "clockwork.request.id": "request-correlated-runtime",
      "clockwork.workflow.id": "workflow-correlated-runtime",
      "clockwork.task.id": "task-correlated-runtime",
    });
  });

  it("does not turn exporter failure into runtime success failure or mask the operation error", async () => {
    const boundaries = new RuntimeBoundaryInstrumentation(
      new ClockworkTelemetry(failingSink),
    );
    await expect(
      boundaries.api({
        name: "api.success",
        correlation: { requestId: "request-runtime-export-failure" },
        operation: () => Promise.resolve("business-result"),
      }),
    ).resolves.toBe("business-result");

    const operationError = new Error("business operation failed");
    await expect(
      boundaries.api({
        name: "api.failure",
        correlation: { requestId: "request-runtime-operation-failure" },
        operation: () => Promise.reject(operationError),
      }),
    ).rejects.toBe(operationError);
  });
});
