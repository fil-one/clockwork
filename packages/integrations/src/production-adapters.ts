import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import type {
  NotificationPort,
  OrchestratorUsagePort,
  ProvisioningPort,
  ProviderResult,
} from "@clockwork/contracts";
import { ids } from "@clockwork/contracts";
import type { ExternalGateActivationTestResult } from "@clockwork/domain/system";
import { z } from "zod";

import type {
  AccountingExportSink,
  AccountingExportBatch,
} from "./core/accounting/adapter";
import type {
  NotificationProviderClient,
  ResolvedBrand,
} from "./notifications";
import type {
  EvidenceAccessContext,
  EvidenceKind,
  EvidenceScope,
  EvidenceStoragePort as LifecycleEvidenceStoragePort,
} from "./evidence-storage";
import {
  providerTransportFailure,
  type ProviderJsonTransport,
} from "./provider-transport";

const AccountingResponseSchema = z.object({
  externalBatchId: z.string().min(1).max(255),
});

const NotificationResponseSchema = z.object({
  messageId: z.string().min(1).max(255),
});

const UsageResponseSchema = z.object({
  records: z.array(
    z.object({
      externalId: z.string().min(1).max(255),
      sku: z.string().min(1).max(255),
      quantity: z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d{1,18})?$/),
      measuredAt: z.string().datetime({ offset: true }),
    }),
  ),
});

const ProviderOperationResponseSchema = z.object({
  operationId: z.string().min(1).max(255),
});

const CoreEvidenceObjectSchema = z.object({
  documentId: z.uuid(),
  storageKey: z.string().min(1),
  versionId: z.string().min(1),
});

const EvidenceMetadataSchema = z.object({
  kind: z.enum([
    "agreement",
    "acceptance",
    "quote",
    "order_form",
    "amendment",
    "notice",
    "completion_certificate",
    "deletion_certificate",
    "screening",
    "approval",
  ]),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  contentType: z.string().min(1),
  retainUntil: z.string().datetime({ offset: true }),
  legalHold: z.boolean(),
  source: z.string().min(1),
  scope: z.object({
    kind: z.enum(["account", "organization", "internal"]),
    id: z.string().min(1),
  }),
  scanStatus: z.enum(["pending", "clean", "quarantined"]),
  scanReference: z.string().min(1),
});

const LifecycleEvidenceObjectSchema = CoreEvidenceObjectSchema.extend({
  metadata: EvidenceMetadataSchema,
  scanReference: z.string().min(1),
});

const ActivationTestResponseSchema = z.object({
  status: z.enum(["passed", "failed"]),
  testedAt: z.string().datetime({ offset: true }),
  testedBy: z.string().min(1),
  evidenceReference: z.string().min(8),
  simulatorState: z.enum(["ready", "degraded", "unavailable"]),
  simulatorDetails: z.string().min(1),
});

export class HttpAccountingExportSink implements AccountingExportSink {
  public constructor(private readonly transport: ProviderJsonTransport) {}

  public async write(input: {
    readonly batch: AccountingExportBatch;
    readonly idempotencyKey: string;
  }): Promise<ProviderResult<{ externalBatchId: string }>> {
    try {
      const value = await this.transport.request({
        operation: "accounting.export",
        path: "/v1/accounting/exports",
        body: { batch: input.batch },
        response: AccountingResponseSchema,
        idempotencyKey: input.idempotencyKey,
      });
      return { ok: true, value };
    } catch (error) {
      return providerTransportFailure(error, "ACCOUNTING_PROVIDER_ERROR");
    }
  }
}

export class HttpNotificationProviderClient implements NotificationProviderClient {
  public constructor(private readonly transport: ProviderJsonTransport) {}

  public send(input: {
    template: string;
    recipient: string;
    data: Readonly<Record<string, unknown>>;
    brand: ResolvedBrand;
    idempotencyKey: string;
  }): Promise<{ messageId: string }> {
    return this.transport.request({
      operation: "notifications.send",
      path: "/v1/notifications/messages",
      body: { ...input },
      response: NotificationResponseSchema,
      idempotencyKey: input.idempotencyKey,
    });
  }
}

const filOneBrand: ResolvedBrand = {
  kind: "fil_one",
  displayName: "Fil One",
  fromDomain: "notifications.fil.one",
};

function notificationBatchId(messageIds: readonly string[]): string {
  if (messageIds.length === 1) return messageIds[0] ?? "";
  return `notification_batch_${createHash("sha256")
    .update(messageIds.join("\0"))
    .digest("hex")
    .slice(0, 24)}`;
}

/** Core finance notifications use the same selected delivery client as lifecycle. */
export class CoreNotificationAdapter implements NotificationPort {
  public constructor(
    private readonly client: NotificationProviderClient,
    private readonly brand: ResolvedBrand = filOneBrand,
  ) {}

  public async send(
    input: Parameters<NotificationPort["send"]>[0],
  ): Promise<ProviderResult<{ messageId: string }>> {
    const recipients = [
      ...new Set(input.recipients.map((item) => item.trim().toLowerCase())),
    ];
    if (
      recipients.length === 0 ||
      recipients.some((item) => !z.string().email().safeParse(item).success)
    )
      return {
        ok: false,
        kind: "permanent",
        code: "NOTIFICATION_RECIPIENT_INVALID",
        message: "At least one valid notification recipient is required",
      };
    try {
      const messages = await Promise.all(
        recipients.map((recipient, index) =>
          this.client.send({
            template: input.template,
            recipient,
            data: input.data,
            brand: this.brand,
            idempotencyKey: `${input.idempotencyKey}:${index}`,
          }),
        ),
      );
      return {
        ok: true,
        value: {
          messageId: notificationBatchId(
            messages.map((message) => message.messageId),
          ),
        },
      };
    } catch (error) {
      return providerTransportFailure(error, "NOTIFICATION_PROVIDER_ERROR");
    }
  }
}

export interface UsageProviderClient {
  pull(input: { organizationId: string; from: string; to: string }): Promise<{
    records: readonly {
      externalId: string;
      sku: string;
      quantity: string;
      measuredAt: string;
    }[];
  }>;
}

export class HttpUsageProviderClient implements UsageProviderClient {
  public constructor(private readonly transport: ProviderJsonTransport) {}

  public pull(input: { organizationId: string; from: string; to: string }) {
    return this.transport.request({
      operation: "usage.pull",
      path: "/v1/usage/records/query",
      body: input,
      response: UsageResponseSchema,
    });
  }
}

export class OrchestratorUsageAdapter implements OrchestratorUsagePort {
  public constructor(private readonly client: UsageProviderClient) {}

  public async pullUsage(
    input: Parameters<OrchestratorUsagePort["pullUsage"]>[0],
  ): ReturnType<OrchestratorUsagePort["pullUsage"]> {
    const from = Date.parse(input.from);
    const to = Date.parse(input.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to)
      return {
        ok: false,
        kind: "permanent",
        code: "USAGE_WINDOW_INVALID",
        message: "Usage window must contain valid increasing instants",
      };
    try {
      const result = await this.client.pull(input);
      const parsed = UsageResponseSchema.safeParse(result);
      if (!parsed.success)
        return {
          ok: false,
          kind: "permanent",
          code: "USAGE_PROVIDER_RESPONSE_INVALID",
          message: "Usage provider returned invalid records",
        };
      const seen = new Set<string>();
      for (const record of parsed.data.records) {
        if (seen.has(record.externalId))
          return {
            ok: false,
            kind: "permanent",
            code: "USAGE_PROVIDER_DUPLICATE_ID",
            message: "Usage provider returned duplicate record identifiers",
          };
        seen.add(record.externalId);
        const measuredAt = Date.parse(record.measuredAt);
        if (measuredAt < from || measuredAt >= to)
          return {
            ok: false,
            kind: "permanent",
            code: "USAGE_RECORD_OUTSIDE_WINDOW",
            message:
              "Usage provider returned a record outside the requested window",
          };
      }
      return { ok: true, value: parsed.data.records };
    } catch (error) {
      return providerTransportFailure(error, "USAGE_PROVIDER_ERROR");
    }
  }
}

export class HttpProvisioningAdapter implements ProvisioningPort {
  public constructor(private readonly transport: ProviderJsonTransport) {}

  public async provision(input: Parameters<ProvisioningPort["provision"]>[0]) {
    try {
      const value = await this.transport.request({
        operation: "provisioning.provision",
        path: "/v1/provisioning/operations",
        body: input,
        response: ProviderOperationResponseSchema,
        idempotencyKey: input.idempotencyKey,
      });
      return { ok: true as const, value };
    } catch (error) {
      return providerTransportFailure(error, "PROVISIONING_PROVIDER_ERROR");
    }
  }

  public async teardown(input: Parameters<ProvisioningPort["teardown"]>[0]) {
    if (input.approvalIds[0] === input.approvalIds[1])
      return {
        ok: false as const,
        kind: "permanent" as const,
        code: "TWO_PERSON_REQUIRED",
        message: "Two distinct approvals are required",
      };
    try {
      const value = await this.transport.request({
        operation: "provisioning.teardown",
        path: "/v1/provisioning/teardowns",
        body: input,
        response: ProviderOperationResponseSchema,
        idempotencyKey: input.idempotencyKey,
      });
      return { ok: true as const, value };
    } catch (error) {
      return providerTransportFailure(error, "PROVISIONING_PROVIDER_ERROR");
    }
  }
}

export class HttpCoreEvidenceStorageAdapter {
  public constructor(private readonly transport: ProviderJsonTransport) {}

  public async putImmutable(input: {
    kind: string;
    bytes: Uint8Array;
    contentHash: string;
    retainUntil: string;
    legalHold?: boolean;
  }) {
    try {
      const { bytes, ...metadata } = input;
      const value = await this.transport.request({
        operation: "evidence.put_immutable",
        path: "/v1/evidence/objects",
        body: {
          ...metadata,
          bytesBase64: Buffer.from(bytes).toString("base64"),
        },
        response: CoreEvidenceObjectSchema,
        idempotencyKey: `evidence:${input.contentHash}`,
      });
      return {
        ok: true as const,
        value: { ...value, documentId: ids.document.parse(value.documentId) },
      };
    } catch (error) {
      return providerTransportFailure(error, "EVIDENCE_PROVIDER_ERROR");
    }
  }

  public async get(documentId: ReturnType<typeof ids.document.parse>) {
    try {
      const value = await this.transport.request({
        operation: "evidence.get",
        path: "/v1/evidence/objects/read",
        body: { documentId },
        response: z.object({
          bytesBase64: z.string().min(1),
          contentHash: z.string().regex(/^[a-f0-9]{64}$/),
        }),
      });
      const bytes = new Uint8Array(Buffer.from(value.bytesBase64, "base64"));
      const actual = createHash("sha256").update(bytes).digest("hex");
      if (actual !== value.contentHash)
        return {
          ok: false as const,
          kind: "permanent" as const,
          code: "EVIDENCE_CONTENT_HASH_MISMATCH",
          message: "Evidence bytes failed content-hash verification",
        };
      return { ok: true as const, value: { bytes, contentHash: actual } };
    } catch (error) {
      return providerTransportFailure(error, "EVIDENCE_PROVIDER_ERROR");
    }
  }
}

export class HttpLifecycleEvidenceStorageAdapter implements LifecycleEvidenceStoragePort {
  public constructor(private readonly transport: ProviderJsonTransport) {}

  public async putImmutable(input: {
    kind: EvidenceKind;
    bytes: Uint8Array;
    contentHash: string;
    contentType: string;
    retainUntil: string;
    legalHold?: boolean;
    source: string;
    scope: EvidenceScope;
    idempotencyKey: Parameters<
      LifecycleEvidenceStoragePort["putImmutable"]
    >[0]["idempotencyKey"];
  }) {
    try {
      const { bytes, ...metadata } = input;
      const value = await this.transport.request({
        operation: "evidence.put_immutable",
        path: "/v1/evidence/objects",
        body: {
          ...metadata,
          bytesBase64: Buffer.from(bytes).toString("base64"),
        },
        response: LifecycleEvidenceObjectSchema,
        idempotencyKey: input.idempotencyKey,
      });
      return {
        ok: true as const,
        value: {
          ...value,
          documentId: ids.document.parse(value.documentId),
        },
      };
    } catch (error) {
      return providerTransportFailure(error, "EVIDENCE_PROVIDER_ERROR");
    }
  }

  public async get(input: {
    documentId: ReturnType<typeof ids.document.parse>;
    contentHash: string;
    versionId?: string;
    access: EvidenceAccessContext;
  }) {
    try {
      const value = await this.transport.request({
        operation: "evidence.get",
        path: "/v1/evidence/objects/read",
        body: input,
        response: LifecycleEvidenceObjectSchema.extend({
          bytesBase64: z.string().min(1),
        }),
      });
      const bytes = new Uint8Array(Buffer.from(value.bytesBase64, "base64"));
      if (
        createHash("sha256").update(bytes).digest("hex") !==
        value.metadata.contentHash
      )
        return {
          ok: false as const,
          kind: "permanent" as const,
          code: "EVIDENCE_CONTENT_HASH_MISMATCH",
          message: "Evidence bytes failed content-hash verification",
        };
      return {
        ok: true as const,
        value: {
          ...value,
          documentId: ids.document.parse(value.documentId),
          bytes,
        },
      };
    } catch (error) {
      return providerTransportFailure(error, "EVIDENCE_PROVIDER_ERROR");
    }
  }

  public async createPresignedUpload(
    input: Parameters<LifecycleEvidenceStoragePort["createPresignedUpload"]>[0],
  ) {
    try {
      const value = await this.transport.request({
        operation: "evidence.create_upload",
        path: "/v1/evidence/uploads",
        body: input,
        response: z.object({
          uploadId: z.string().min(1),
          method: z.literal("PUT"),
          url: z.string().url(),
          headers: z.record(z.string(), z.string()),
          storageKey: z.string().min(1),
          expiresAt: z.string().datetime({ offset: true }),
        }),
        idempotencyKey: input.idempotencyKey,
      });
      return { ok: true as const, value };
    } catch (error) {
      return providerTransportFailure(error, "EVIDENCE_PROVIDER_ERROR");
    }
  }

  public async completePresignedUpload(
    input: Parameters<
      LifecycleEvidenceStoragePort["completePresignedUpload"]
    >[0],
  ) {
    try {
      const value = await this.transport.request({
        operation: "evidence.complete_upload",
        path: "/v1/evidence/uploads/complete",
        body: input,
        response: LifecycleEvidenceObjectSchema,
        idempotencyKey: input.idempotencyKey,
      });
      return {
        ok: true as const,
        value: {
          ...value,
          documentId: ids.document.parse(value.documentId),
        },
      };
    } catch (error) {
      return providerTransportFailure(error, "EVIDENCE_PROVIDER_ERROR");
    }
  }

  public async createPresignedDownload(
    input: Parameters<
      LifecycleEvidenceStoragePort["createPresignedDownload"]
    >[0],
  ) {
    try {
      const value = await this.transport.request({
        operation: "evidence.create_download",
        path: "/v1/evidence/downloads",
        body: input,
        response: z.object({
          url: z.string().url(),
          expiresAt: z.string().datetime({ offset: true }),
        }),
      });
      return { ok: true as const, value };
    } catch (error) {
      return providerTransportFailure(error, "EVIDENCE_PROVIDER_ERROR");
    }
  }
}

export class HttpProviderActivationTestClient {
  public constructor(private readonly transport: ProviderJsonTransport) {}

  public run(provider: string): Promise<ExternalGateActivationTestResult> {
    return this.transport.request({
      operation: "provider.activation_test",
      path: "/v1/activation-tests/run",
      body: { provider },
      response: ActivationTestResponseSchema,
      idempotencyKey: `activation:${provider}:${new Date().toISOString().slice(0, 13)}`,
    });
  }
}
