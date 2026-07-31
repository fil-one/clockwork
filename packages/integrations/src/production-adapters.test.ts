import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { IdempotencyKeySchema, ids } from "@clockwork/contracts";

import {
  CoreNotificationAdapter,
  HttpAccountingExportSink,
  HttpCoreEvidenceStorageAdapter,
  OrchestratorUsageAdapter,
} from "./production-adapters";
import type { ProviderJsonTransport } from "./provider-transport";

class QueuedTransport implements ProviderJsonTransport {
  public readonly calls: {
    operation: string;
    path: string;
    body: Readonly<Record<string, unknown>>;
    idempotencyKey?: string;
  }[] = [];

  public constructor(private readonly responses: unknown[]) {}

  public request<T>(input: {
    operation: string;
    path: string;
    body: Readonly<Record<string, unknown>>;
    response: ZodType<T>;
    idempotencyKey?: string;
  }): Promise<T> {
    this.calls.push({
      operation: input.operation,
      path: input.path,
      body: input.body,
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    });
    return Promise.resolve(input.response.parse(this.responses.shift()));
  }
}

describe("production provider-neutral adapters", () => {
  it("posts immutable accounting batches with the original idempotency key", async () => {
    const transport = new QueuedTransport([
      { externalBatchId: "qbo-batch-123" },
    ]);
    const sink = new HttpAccountingExportSink(transport);
    const result = await sink.write({
      batch: {
        schemaVersion: 1,
        batchId: "batch-1",
        generatedAt: "2026-07-31T16:00:00.000Z",
        records: [],
        checksum: "a".repeat(64),
      },
      idempotencyKey: "accounting:test:123456",
    });

    expect(result).toEqual({
      ok: true,
      value: { externalBatchId: "qbo-batch-123" },
    });
    expect(transport.calls[0]).toMatchObject({
      operation: "accounting.export",
      path: "/v1/accounting/exports",
      idempotencyKey: "accounting:test:123456",
    });
  });

  it("normalizes and de-duplicates notification recipients", async () => {
    const deliveries: string[] = [];
    const adapter = new CoreNotificationAdapter({
      send(input) {
        deliveries.push(input.recipient);
        return Promise.resolve({ messageId: `msg-${deliveries.length}` });
      },
    });
    const result = await adapter.send({
      template: "payment-received",
      recipients: [" Finance@Example.com ", "finance@example.com"],
      data: { invoiceId: "invoice-1" },
      idempotencyKey: IdempotencyKeySchema.parse("notification:test:123456"),
    });

    expect(result).toEqual({ ok: true, value: { messageId: "msg-1" } });
    expect(deliveries).toEqual(["finance@example.com"]);
  });

  it("fails closed on duplicated or out-of-window usage records", async () => {
    const duplicate = new OrchestratorUsageAdapter({
      pull: () =>
        Promise.resolve({
          records: [
            {
              externalId: "usage-1",
              sku: "SKU",
              quantity: "1",
              measuredAt: "2026-07-01T12:00:00.000Z",
            },
            {
              externalId: "usage-1",
              sku: "SKU",
              quantity: "-1",
              measuredAt: "2026-07-02T12:00:00.000Z",
            },
          ],
        }),
    });
    const result = await duplicate.pullUsage({
      organizationId: ids.organization.parse(
        "00000000-0000-4000-8000-000000000001",
      ),
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-08-01T00:00:00.000Z",
    });
    expect(result).toMatchObject({
      ok: false,
      code: "USAGE_PROVIDER_DUPLICATE_ID",
    });
  });

  it("serializes evidence bytes only as base64 and never as a raw typed array", async () => {
    const bytes = new TextEncoder().encode("immutable evidence");
    const contentHash = createHash("sha256").update(bytes).digest("hex");
    const transport = new QueuedTransport([
      {
        documentId: "00000000-0000-4000-8000-000000000099",
        storageKey: "evidence/immutable",
        versionId: "version-1",
      },
    ]);
    const evidence = new HttpCoreEvidenceStorageAdapter(transport);

    const result = await evidence.putImmutable({
      kind: "agreement",
      bytes,
      contentHash,
      retainUntil: "2036-07-31T00:00:00.000Z",
    });

    expect(result.ok).toBe(true);
    expect(transport.calls[0]?.body).toMatchObject({
      kind: "agreement",
      contentHash,
      bytesBase64: Buffer.from(bytes).toString("base64"),
    });
    expect(transport.calls[0]?.body).not.toHaveProperty("bytes");
  });
});
