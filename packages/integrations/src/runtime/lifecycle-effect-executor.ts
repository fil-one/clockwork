import { Buffer } from "node:buffer";

import type {
  EvidenceStoragePort,
  NotificationPort,
  ProviderResult,
  ProvisioningPort,
  ScreeningPort,
  SignaturePort,
} from "@clockwork/contracts";
import { IdempotencyKeySchema, ids } from "@clockwork/contracts";
import { z } from "zod";

import type {
  ProviderRuntime,
  ProviderOperationName,
  ProviderRuntimeContext,
} from "./provider-runtime";

export interface LifecycleProviderEffectLike {
  effectKey: string;
  taskId: string;
  aggregateId: string;
  aggregateVersion: number;
  effectBoundary:
    | "screening_provider"
    | "notification_provider"
    | "signature_provider"
    | "evidence_provider"
    | "provisioning_provider"
    | "persisted_transition"
    | "human_wait";
  persistedState: Readonly<Record<string, unknown>>;
}

export interface LifecycleProviderEffectResult {
  reference: string;
  output?: unknown;
}

export interface IdempotentLifecycleScreeningPort {
  screen(
    input: Parameters<ScreeningPort["screen"]>[0] & {
      idempotencyKey: ReturnType<typeof IdempotencyKeySchema.parse>;
    },
  ): ReturnType<ScreeningPort["screen"]>;
}

export interface LifecycleEffectProviderPorts {
  screening: IdempotentLifecycleScreeningPort;
  notifications: NotificationPort;
  signature: SignaturePort;
  evidence: EvidenceStoragePort;
  provisioning: ProvisioningPort;
}

const ScreeningInputSchema = z.object({
  accountId: z.uuid(),
  legalName: z.string().min(1).max(500),
  country: z.string().length(2),
  reason: z.enum(["registration", "pre_signature", "partner_activation"]),
});

const NotificationInputSchema = z.object({
  template: z.string().min(1).max(200),
  recipients: z.array(z.string().email()).min(1).max(50),
  data: z.record(z.string(), z.unknown()),
});

const SignatureInputSchema = z.object({
  accountId: z.uuid(),
  documentId: z.uuid(),
  signerEmail: z.string().email(),
});

const EvidenceInputSchema = z.object({
  kind: z.string().min(1).max(200),
  bytesBase64: z.string().min(1).max(1_500_000),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  retainUntil: z.string().datetime({ offset: true }),
  legalHold: z.boolean().optional(),
});

const ProvisionInputSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("provision"),
    orderId: z.uuid(),
    organizationId: z.uuid(),
    entitlements: z.array(
      z.object({
        sku: z.string().min(1),
        quantity: z.string().min(1),
        region: z.string().min(1),
      }),
    ),
  }),
  z.object({
    operation: z.literal("teardown"),
    organizationId: z.uuid(),
    approvalIds: z.tuple([z.string().min(1), z.string().min(1)]),
  }),
]);

/**
 * Structural implementation of workflows' LifecycleEffectExecutor. The DB
 * planner must persist a typed `providerInput`; absence is a permanent denial,
 * never an invitation to infer credentials, recipients, approvals, or bytes.
 */
export class TypedLifecycleProviderEffectExecutor {
  public constructor(
    private readonly runtime: ProviderRuntime,
    private readonly providers: LifecycleEffectProviderPorts,
    private readonly context: (
      effect: LifecycleProviderEffectLike,
    ) => Omit<ProviderRuntimeContext, "idempotencyKey">,
    private readonly authorizeCapability?: (
      effect: LifecycleProviderEffectLike,
    ) => Promise<void>,
  ) {}

  public async authorize(effect: LifecycleProviderEffectLike): Promise<void> {
    await this.authorizeCapability?.(effect);
    const operation = operationForEffect(effect);
    await this.runtime.authorize(operation, {
      ...this.context(effect),
      idempotencyKey: effect.effectKey,
    });
  }

  public async execute(
    effect: LifecycleProviderEffectLike,
  ): Promise<ProviderResult<LifecycleProviderEffectResult>> {
    await this.authorizeCapability?.(effect);
    const operation = operationForEffect(effect);
    return this.runtime.execute({
      operation,
      context: {
        ...this.context(effect),
        idempotencyKey: effect.effectKey,
      },
      invoke: () => this.executeAuthorized(effect),
    });
  }

  private executeAuthorized(
    effect: LifecycleProviderEffectLike,
  ): Promise<ProviderResult<LifecycleProviderEffectResult>> {
    switch (effect.effectBoundary) {
      case "screening_provider":
        return this.screen(effect);
      case "notification_provider":
        return this.notify(effect);
      case "signature_provider":
        return this.sign(effect);
      case "evidence_provider":
        return this.storeEvidence(effect);
      case "provisioning_provider":
        return this.provision(effect);
      case "human_wait":
      case "persisted_transition":
        return Promise.resolve(
          permanent(
            "LIFECYCLE_INTERNAL_EFFECT_PROVIDER_FORBIDDEN",
            "Internal lifecycle transitions cannot invoke a provider",
          ),
        );
    }
  }

  private async screen(
    effect: LifecycleProviderEffectLike,
  ): Promise<ProviderResult<LifecycleProviderEffectResult>> {
    const input = ScreeningInputSchema.safeParse(
      effect.persistedState.providerInput,
    );
    if (!input.success) return invalidInput();
    const result = await this.providers.screening.screen({
      ...input.data,
      accountId: ids.account.parse(input.data.accountId),
      idempotencyKey: IdempotencyKeySchema.parse(effect.effectKey),
    });
    return result.ok
      ? {
          ok: true,
          value: { reference: result.value.reference, output: result.value },
          ...(result.duplicate ? { duplicate: true } : {}),
        }
      : result;
  }

  private async notify(
    effect: LifecycleProviderEffectLike,
  ): Promise<ProviderResult<LifecycleProviderEffectResult>> {
    const input = NotificationInputSchema.safeParse(
      effect.persistedState.providerInput,
    );
    if (!input.success) return invalidInput();
    const result = await this.providers.notifications.send({
      ...input.data,
      idempotencyKey: IdempotencyKeySchema.parse(effect.effectKey),
    });
    return result.ok
      ? {
          ok: true,
          value: { reference: result.value.messageId, output: result.value },
          ...(result.duplicate ? { duplicate: true } : {}),
        }
      : result;
  }

  private async sign(
    effect: LifecycleProviderEffectLike,
  ): Promise<ProviderResult<LifecycleProviderEffectResult>> {
    const input = SignatureInputSchema.safeParse(
      effect.persistedState.providerInput,
    );
    if (!input.success) return invalidInput();
    const result = await this.providers.signature.createEnvelope({
      ...input.data,
      accountId: ids.account.parse(input.data.accountId),
      documentId: ids.document.parse(input.data.documentId),
      idempotencyKey: IdempotencyKeySchema.parse(effect.effectKey),
    });
    return result.ok
      ? {
          ok: true,
          value: {
            reference: result.value.envelopeId,
            output: { envelopeId: result.value.envelopeId },
          },
          ...(result.duplicate ? { duplicate: true } : {}),
        }
      : result;
  }

  private async storeEvidence(
    effect: LifecycleProviderEffectLike,
  ): Promise<ProviderResult<LifecycleProviderEffectResult>> {
    const input = EvidenceInputSchema.safeParse(
      effect.persistedState.providerInput,
    );
    if (!input.success) return invalidInput();
    const { bytesBase64, legalHold, ...metadata } = input.data;
    const result = await this.providers.evidence.putImmutable({
      ...metadata,
      bytes: new Uint8Array(Buffer.from(bytesBase64, "base64")),
      ...(legalHold === undefined ? {} : { legalHold }),
    });
    return result.ok
      ? {
          ok: true,
          value: {
            reference: result.value.documentId,
            output: {
              documentId: result.value.documentId,
              storageKey: result.value.storageKey,
              versionId: result.value.versionId,
            },
          },
          ...(result.duplicate ? { duplicate: true } : {}),
        }
      : result;
  }

  private async provision(
    effect: LifecycleProviderEffectLike,
  ): Promise<ProviderResult<LifecycleProviderEffectResult>> {
    const input = ProvisionInputSchema.safeParse(
      effect.persistedState.providerInput,
    );
    if (!input.success) return invalidInput();
    const idempotencyKey = IdempotencyKeySchema.parse(effect.effectKey);
    const result =
      input.data.operation === "provision"
        ? await this.providers.provisioning.provision({
            orderId: ids.order.parse(input.data.orderId),
            organizationId: ids.organization.parse(input.data.organizationId),
            entitlements: input.data.entitlements,
            idempotencyKey,
          })
        : await this.providers.provisioning.teardown({
            organizationId: ids.organization.parse(input.data.organizationId),
            approvalIds: input.data.approvalIds,
            idempotencyKey,
          });
    return result.ok
      ? {
          ok: true,
          value: { reference: result.value.operationId, output: result.value },
          ...(result.duplicate ? { duplicate: true } : {}),
        }
      : result;
  }
}

function operationForEffect(
  effect: LifecycleProviderEffectLike,
): ProviderOperationName {
  if (effect.effectBoundary !== "provisioning_provider")
    return "provider.effect";
  const operation =
    effect.persistedState.providerInput &&
    typeof effect.persistedState.providerInput === "object" &&
    "operation" in effect.persistedState.providerInput
      ? effect.persistedState.providerInput.operation
      : undefined;
  return operation === "teardown"
    ? "provisioning.teardown"
    : "provisioning.provision";
}

function invalidInput(): ProviderResult<never> {
  return permanent(
    "LIFECYCLE_PROVIDER_INPUT_INVALID",
    "Persisted lifecycle provider input is missing or invalid",
  );
}

function permanent(code: string, message: string): ProviderResult<never> {
  return { ok: false, kind: "permanent", code, message };
}
