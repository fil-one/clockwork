import { describe, expect, it } from "vitest";

import {
  ClockworkTelemetry,
  formatTraceparent,
  InMemoryTelemetrySink,
  parseTraceparent,
  telemetryBoundaries,
} from "./telemetry";

describe("ClockworkTelemetry", () => {
  it("covers every runtime boundary with the complete correlation join", async () => {
    const sink = new InMemoryTelemetrySink();
    const telemetry = new ClockworkTelemetry(sink, () => 1_722_441_600_000);
    const correlation = {
      requestId: "request-1",
      workflowId: "workflow-1",
      taskId: "task-1",
      auditId: "audit-1",
      outboxId: "outbox-1",
    };
    await Promise.all(
      telemetryBoundaries.map((boundary) =>
        telemetry.withSpan({
          boundary,
          name: `${boundary}.operation`,
          correlation,
          operation: () => Promise.resolve(),
        }),
      ),
    );
    expect(sink.spans.map(({ boundary }) => boundary).sort()).toEqual(
      [...telemetryBoundaries].sort(),
    );
    for (const span of sink.spans)
      expect(span.attributes).toMatchObject({
        "clockwork.request.id": "request-1",
        "clockwork.workflow.id": "workflow-1",
        "clockwork.task.id": "task-1",
        "clockwork.audit.id": "audit-1",
        "clockwork.outbox.id": "outbox-1",
      });
  });

  it("redacts unsafe names and never records an error message or arbitrary payload", async () => {
    const sink = new InMemoryTelemetrySink();
    const telemetry = new ClockworkTelemetry(sink);
    const error = Object.assign(
      new Error("alice@example.test bearer super-secret-value"),
      { code: "PROVIDER_TIMEOUT" },
    );
    await expect(
      telemetry.withSpan({
        boundary: "provider",
        name: "provider.authorization-token",
        correlation: { requestId: "request-redaction-1" },
        attributes: {
          "provider.name": "email-provider",
          "provider.operation": "messages.send",
        },
        operation: () => Promise.reject(error),
      }),
    ).rejects.toBe(error);
    const serialized = JSON.stringify(sink.spans);
    expect(serialized).not.toContain("alice@example.test");
    expect(serialized).not.toContain("super-secret-value");
    expect(sink.spans[0]).toMatchObject({
      name: "redacted",
      attributes: {
        "provider.name": "redacted",
        "error.type": "Error",
        "error.code": "PROVIDER_TIMEOUT",
      },
    });
  });

  it("propagates only valid W3C traceparent state", () => {
    const context = parseTraceparent(
      "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    );
    expect(context).toEqual({
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
      traceFlags: "01",
    });
    if (!context) throw new Error("Expected a valid traceparent");
    expect(formatTraceparent(context)).toBe(
      "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    );
    expect(
      parseTraceparent(
        "00-00000000000000000000000000000000-00f067aa0ba902b7-01",
      ),
    ).toBeUndefined();
  });

  it("emits backend-neutral synthetic failures for every alert family", async () => {
    const sink = new InMemoryTelemetrySink();
    const telemetry = new ClockworkTelemetry(sink);
    const scenarios = [
      "auth_anomaly",
      "db_pitr",
      "queue_age",
      "dead_letter",
      "outbox_backlog",
      "provisioning",
      "reconciliation",
      "unhandled_error",
    ] as const;
    await Promise.all(
      scenarios.map((scenario) =>
        telemetry.syntheticFailure({
          boundary: scenario === "auth_anomaly" ? "api" : "workflow",
          scenario,
          correlation: { requestId: `synthetic-${scenario}` },
        }),
      ),
    );
    expect(sink.spans).toHaveLength(8);
    expect(sink.spans.every((span) => span.status === "error")).toBe(true);
    expect(
      sink.spans.every(
        (span) => span.attributes["clockwork.synthetic"] === true,
      ),
    ).toBe(true);
  });
});
