import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type {
  IdempotencyKey,
  OrderId,
  OrganizationId,
  ProviderResult,
  WebhookVerificationResult,
  WebhookVerifier,
} from "@clockwork/contracts";

export type ProvisioningMode =
  "new_tenant" | "add_entitlements" | "poc" | "poc_upgrade_in_place";

export interface EntitlementCommand {
  entitlementId: string;
  sku: string;
  quantity: string;
  region: string;
  environment: "production" | "sandbox" | "poc";
  cap?: string;
  expiresAt?: string;
}

export interface MappedEntitlement extends EntitlementCommand {
  productCode: string;
  featureCodes: readonly string[];
  mappingVersion: string;
}

export interface CredentialDelivery {
  channel: "email" | "portal" | "partner";
  recipientAccountId: string;
  recipientEmail?: string;
  brandingPolicyId?: string;
}

export interface ProvisionCommand {
  orderId: OrderId;
  organizationId: OrganizationId;
  mode: ProvisioningMode;
  existingTenantId?: string;
  entitlements: readonly EntitlementCommand[];
  credentialDelivery: CredentialDelivery;
  idempotencyKey: IdempotencyKey;
}

export interface TeardownCommand {
  organizationId: OrganizationId;
  tenantId: string;
  approvalIds: readonly [string, string];
  retainedResourceIds: readonly string[];
  reason: string;
  idempotencyKey: IdempotencyKey;
}

export interface ProvisioningOperation {
  operationId: string;
  state: "accepted" | "dead_lettered";
  attempt: number;
  duplicate: boolean;
}

export type ProvisioningConfirmationType =
  | "provisioning.accepted"
  | "provisioning.completed"
  | "provisioning.failed"
  | "teardown.completed"
  | "teardown.failed";

export interface ProvisioningConfirmation {
  eventId: string;
  operationId: string;
  sequence: number;
  type: ProvisioningConfirmationType;
  occurredAt: string;
  organizationId: OrganizationId;
  /** Present for provision operations and bound to the originating command. */
  orderId?: OrderId;
  tenantId: string;
  entitlementResourceIds: Readonly<Record<string, string>>;
  credentialDeliveryReference?: string;
  retainedResourceIds?: readonly string[];
  errorCode?: string;
}

export interface DeadLetterOperation {
  operationId: string;
  idempotencyKey: IdempotencyKey;
  commandType: "provision" | "teardown";
  attempts: number;
  lastError: string;
}

export interface ProvisioningBridgePort {
  provision(
    input: ProvisionCommand,
  ): Promise<ProviderResult<ProvisioningOperation>>;
  teardown(
    input: TeardownCommand,
  ): Promise<ProviderResult<ProvisioningOperation>>;
  drainConfirmations(): Promise<readonly ProvisioningConfirmation[]>;
  listDeadLetters(): Promise<readonly DeadLetterOperation[]>;
  recover(input: {
    operationId: string;
    operatorId: string;
    reason: string;
    idempotencyKey: IdempotencyKey;
  }): Promise<ProviderResult<ProvisioningOperation>>;
}

export interface EntitlementProductMapping {
  version: string;
  map(entitlement: EntitlementCommand): MappedEntitlement;
}

export class FixedEntitlementProductMapping implements EntitlementProductMapping {
  public constructor(
    public readonly version: string,
    private readonly products: Readonly<
      Record<string, { productCode: string; featureCodes: readonly string[] }>
    >,
  ) {}

  public map(entitlement: EntitlementCommand): MappedEntitlement {
    const product = this.products[entitlement.sku];
    if (!product)
      throw new Error(
        `No provisioning product mapping for SKU ${entitlement.sku}`,
      );
    return {
      ...entitlement,
      productCode: product.productCode,
      featureCodes: product.featureCodes,
      mappingVersion: this.version,
    };
  }
}

export interface ProvisioningProviderClient {
  provision(input: {
    operationId: string;
    orderId: string;
    organizationId: string;
    mode: ProvisioningMode;
    existingTenantId?: string;
    entitlements: readonly MappedEntitlement[];
    credentialDelivery: CredentialDelivery;
    idempotencyKey: string;
  }): Promise<{ accepted: true }>;
  teardown(input: {
    operationId: string;
    organizationId: string;
    tenantId: string;
    retainedResourceIds: readonly string[];
    reason: string;
    idempotencyKey: string;
  }): Promise<{ accepted: true }>;
}

export interface ProvisioningOperationExpectation {
  operationId: string;
  commandType: "provision" | "teardown";
  organizationId: OrganizationId;
  orderId?: OrderId;
  /** Canonical command hash prevents an idempotency key changing its effect. */
  commandFingerprint?: string;
}

/**
 * Durable implementations must make register atomic. A command is persisted
 * before the provider call so a callback can always be bound to commerce-owned
 * order and organization identifiers, even after a process restart.
 */
export interface ProvisioningOperationExpectationStore {
  register(
    expectation: ProvisioningOperationExpectation,
  ): Promise<"created" | "existing" | "conflict">;
  get(operationId: string): Promise<ProvisioningOperationExpectation | null>;
}

/** Test/sandbox store. Production composition must inject a durable store. */
export class InMemoryProvisioningOperationExpectationStore implements ProvisioningOperationExpectationStore {
  private readonly values = new Map<string, ProvisioningOperationExpectation>();

  public register(
    expectation: ProvisioningOperationExpectation,
  ): Promise<"created" | "existing" | "conflict"> {
    const existing = this.values.get(expectation.operationId);
    if (!existing) {
      this.values.set(
        expectation.operationId,
        Object.freeze({ ...expectation }),
      );
      return Promise.resolve("created");
    }
    return Promise.resolve(
      stableJsonHash(existing) === stableJsonHash(expectation)
        ? "existing"
        : "conflict",
    );
  }

  public get(
    operationId: string,
  ): Promise<ProvisioningOperationExpectation | null> {
    return Promise.resolve(this.values.get(operationId) ?? null);
  }
}

export class ProvisioningBridgeAdapter {
  public constructor(
    private readonly client: ProvisioningProviderClient,
    private readonly mapping: EntitlementProductMapping,
    private readonly expectations: ProvisioningOperationExpectationStore,
  ) {}

  public async provision(
    input: ProvisionCommand,
  ): Promise<ProviderResult<ProvisioningOperation>> {
    const validation = validateProvision(input);
    if (validation) return validation;
    const operationId = stableId("provision", input.idempotencyKey);
    try {
      const registration = await this.expectations.register({
        operationId,
        commandType: "provision",
        organizationId: input.organizationId,
        orderId: input.orderId,
        commandFingerprint: stableJsonHash(input),
      });
      if (registration === "conflict")
        return permanent(
          "OPERATION_BINDING_CONFLICT",
          "Provisioning operation is already bound to another order or organization",
        );
      const entitlements = input.entitlements.map((item) =>
        this.mapping.map(item),
      );
      await this.client.provision({
        operationId,
        orderId: input.orderId,
        organizationId: input.organizationId,
        mode: input.mode,
        ...(input.existingTenantId
          ? { existingTenantId: input.existingTenantId }
          : {}),
        entitlements,
        credentialDelivery: input.credentialDelivery,
        idempotencyKey: input.idempotencyKey,
      });
      return {
        ok: true,
        value: {
          operationId,
          state: "accepted",
          attempt: 1,
          duplicate: registration === "existing",
        },
        ...(registration === "existing" ? { duplicate: true } : {}),
      };
    } catch (error) {
      return transient(error);
    }
  }

  public async teardown(
    input: TeardownCommand,
  ): Promise<ProviderResult<ProvisioningOperation>> {
    const validation = validateTeardown(input);
    if (validation) return validation;
    const operationId = stableId("teardown", input.idempotencyKey);
    try {
      const registration = await this.expectations.register({
        operationId,
        commandType: "teardown",
        organizationId: input.organizationId,
        commandFingerprint: stableJsonHash(input),
      });
      if (registration === "conflict")
        return permanent(
          "OPERATION_BINDING_CONFLICT",
          "Teardown operation is already bound to another organization",
        );
      await this.client.teardown({
        operationId,
        organizationId: input.organizationId,
        tenantId: input.tenantId,
        retainedResourceIds: input.retainedResourceIds,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
      });
      return {
        ok: true,
        value: {
          operationId,
          state: "accepted",
          attempt: 1,
          duplicate: registration === "existing",
        },
        ...(registration === "existing" ? { duplicate: true } : {}),
      };
    } catch (error) {
      return transient(error);
    }
  }
}

/**
 * Raw-body provisioning verifier. Signature authentication is deliberately
 * separate from API replay claiming: a valid delivery can be retried after an
 * outer transaction fails without the verifier consuming it prematurely.
 */
export class ProvisioningWebhookVerifier implements WebhookVerifier<ProvisioningConfirmation> {
  public constructor(
    private readonly secret: string,
    private readonly expectations: ProvisioningOperationExpectationStore,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (secret.length < 16)
      throw new Error(
        "Provisioning webhook secret must be at least 16 characters",
      );
  }

  public async verify(
    input: Parameters<WebhookVerifier<ProvisioningConfirmation>["verify"]>[0],
  ): Promise<WebhookVerificationResult<ProvisioningConfirmation>> {
    const signature = parseProvisioningSignature(input.signature);
    const toleranceSeconds = input.toleranceSeconds ?? 300;
    if (
      !Number.isSafeInteger(toleranceSeconds) ||
      toleranceSeconds < 0 ||
      Math.abs(Math.floor(this.now().getTime() / 1000) - signature.timestamp) >
        toleranceSeconds
    )
      throw new Error("Provisioning webhook timestamp is outside tolerance");
    const expected = createHmac("sha256", this.secret)
      .update(`${signature.timestamp}.`)
      .update(input.rawBody)
      .digest();
    const supplied = Buffer.from(signature.digest, "hex");
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      throw new Error("Provisioning webhook signature is invalid");

    const payload = parseProvisioningConfirmation(input.rawBody);
    const binding = await this.expectations.get(payload.operationId);
    if (!binding)
      throw new Error("Provisioning webhook operation is not registered");
    if (binding.organizationId !== payload.organizationId)
      throw new Error(
        "Provisioning webhook organization does not match command",
      );
    if (binding.commandType === "provision") {
      if (!payload.orderId || payload.orderId !== binding.orderId)
        throw new Error("Provisioning webhook order does not match command");
      if (payload.type.startsWith("teardown."))
        throw new Error(
          "Provisioning webhook type does not match provision command",
        );
    } else {
      if (payload.orderId)
        throw new Error("Teardown webhook must not be bound to an order");
      if (!payload.type.startsWith("teardown."))
        throw new Error(
          "Provisioning webhook type does not match teardown command",
        );
    }
    return {
      eventId: payload.eventId,
      occurredAt: payload.occurredAt,
      payload,
    };
  }
}

export function signProvisioningWebhook(input: {
  secret: string;
  timestamp: number;
  rawBody: Uint8Array;
}): string {
  const digest = createHmac("sha256", input.secret)
    .update(`${input.timestamp}.`)
    .update(input.rawBody)
    .digest("hex");
  return `t=${input.timestamp},v1=${digest}`;
}

export type ProvisioningScenarioOutcome =
  "success" | "transient_failure" | "permanent_failure";

export interface ProvisioningScenario {
  outcome: ProvisioningScenarioOutcome;
  delayMs?: number;
  duplicateConfirmations?: boolean;
  confirmationOrder?: "in_order" | "reverse";
  errorCode?: string;
}

export interface ProvisioningDelayScheduler {
  wait(milliseconds: number): Promise<void>;
}

export class ImmediateProvisioningScheduler implements ProvisioningDelayScheduler {
  public readonly delays: number[] = [];

  public wait(milliseconds: number): Promise<void> {
    this.delays.push(milliseconds);
    return Promise.resolve();
  }
}

interface StoredOperation {
  type: "provision" | "teardown";
  fingerprint: string;
  operationId: string;
  key: IdempotencyKey;
  command: ProvisionCommand | TeardownCommand;
  attempts: number;
  accepted: boolean;
  deadLetter?: DeadLetterOperation;
}

export interface FakeProvisioningOptions {
  mapping?: EntitlementProductMapping;
  scheduler?: ProvisioningDelayScheduler;
  maxAttempts?: number;
  now?: () => string;
}

const defaultMapping = new FixedEntitlementProductMapping("fake-2026-07-31", {
  "LOCKED-STORAGE-TB": {
    productCode: "object-lock-storage",
    featureCodes: ["object-lock", "retention-policy"],
  },
  "SANDBOX-STORAGE-TB": {
    productCode: "object-lock-sandbox",
    featureCodes: ["sandbox", "non-production"],
  },
  "POC-STORAGE-TB": {
    productCode: "object-lock-poc",
    featureCodes: ["poc", "expiry-enforced", "capacity-cap"],
  },
});

export class FakeProvisioningBridge implements ProvisioningBridgePort {
  private readonly operationsByKey = new Map<string, StoredOperation>();
  private readonly operationsById = new Map<string, StoredOperation>();
  private readonly confirmations: ProvisioningConfirmation[] = [];
  private readonly scenarios = new Map<
    "provision" | "teardown",
    ProvisioningScenario[]
  >();
  private readonly mapping: EntitlementProductMapping;
  private readonly scheduler: ProvisioningDelayScheduler;
  private readonly maxAttempts: number;
  private readonly now: () => string;

  public constructor(options: FakeProvisioningOptions = {}) {
    this.mapping = options.mapping ?? defaultMapping;
    this.scheduler = options.scheduler ?? new ImmediateProvisioningScheduler();
    this.maxAttempts = options.maxAttempts ?? 3;
    this.now = options.now ?? (() => "2026-07-31T16:00:00.000Z");
  }

  public enqueue(
    operation: "provision" | "teardown",
    ...scenarios: ProvisioningScenario[]
  ): void {
    this.scenarios.set(operation, [
      ...(this.scenarios.get(operation) ?? []),
      ...scenarios,
    ]);
  }

  public provision(
    input: ProvisionCommand,
  ): Promise<ProviderResult<ProvisioningOperation>> {
    const validation = validateProvision(input);
    if (validation) return Promise.resolve(validation);
    try {
      input.entitlements.forEach((item) => this.mapping.map(item));
    } catch (error) {
      return Promise.resolve(
        permanent("ENTITLEMENT_MAPPING_MISSING", String(error)),
      );
    }
    return this.execute("provision", input);
  }

  public teardown(
    input: TeardownCommand,
  ): Promise<ProviderResult<ProvisioningOperation>> {
    const validation = validateTeardown(input);
    if (validation) return Promise.resolve(validation);
    return this.execute("teardown", input);
  }

  public drainConfirmations(): Promise<readonly ProvisioningConfirmation[]> {
    return Promise.resolve(this.confirmations.splice(0));
  }

  public listDeadLetters(): Promise<readonly DeadLetterOperation[]> {
    return Promise.resolve(
      [...this.operationsById.values()]
        .map((operation) => operation.deadLetter)
        .filter((item): item is DeadLetterOperation => item !== undefined),
    );
  }

  public async recover(input: {
    operationId: string;
    operatorId: string;
    reason: string;
    idempotencyKey: IdempotencyKey;
  }): Promise<ProviderResult<ProvisioningOperation>> {
    if (!input.operatorId || input.reason.trim().length < 8)
      return permanent(
        "RECOVERY_EVIDENCE_REQUIRED",
        "Operator identity and a meaningful recovery reason are required",
      );
    const stored = this.operationsById.get(input.operationId);
    if (!stored?.deadLetter)
      return permanent(
        "DEAD_LETTER_NOT_FOUND",
        "Only dead-lettered operations can be recovered",
      );
    delete stored.deadLetter;
    stored.attempts = 0;
    stored.accepted = false;
    return this.executeStored(stored, false);
  }

  private execute(
    type: "provision" | "teardown",
    command: ProvisionCommand | TeardownCommand,
  ): Promise<ProviderResult<ProvisioningOperation>> {
    const fingerprint = stableJsonHash(command);
    const prior = this.operationsByKey.get(command.idempotencyKey);
    if (prior && prior.fingerprint !== fingerprint)
      return Promise.resolve(
        permanent(
          "IDEMPOTENCY_CONFLICT",
          "Provisioning key was reused with a different command",
        ),
      );
    if (prior?.accepted)
      return Promise.resolve({
        ok: true,
        value: {
          operationId: prior.operationId,
          state: "accepted",
          attempt: prior.attempts,
          duplicate: true,
        },
        duplicate: true,
      });
    const stored: StoredOperation = prior ?? {
      type,
      fingerprint,
      operationId: stableId(type, command.idempotencyKey),
      key: command.idempotencyKey,
      command,
      attempts: 0,
      accepted: false,
    };
    this.operationsByKey.set(command.idempotencyKey, stored);
    this.operationsById.set(stored.operationId, stored);
    return this.executeStored(stored, false);
  }

  private async executeStored(
    stored: StoredOperation,
    duplicate: boolean,
  ): Promise<ProviderResult<ProvisioningOperation>> {
    stored.attempts += 1;
    const scenario = this.scenarios.get(stored.type)?.shift() ?? {
      outcome: "success",
    };
    if (scenario.delayMs) await this.scheduler.wait(scenario.delayMs);
    if (scenario.outcome !== "success") {
      const code =
        scenario.errorCode ??
        (scenario.outcome === "transient_failure"
          ? "SIMULATED_TRANSIENT"
          : "SIMULATED_PERMANENT");
      const terminal =
        scenario.outcome === "permanent_failure" ||
        stored.attempts >= this.maxAttempts;
      if (terminal) {
        stored.deadLetter = {
          operationId: stored.operationId,
          idempotencyKey: stored.key,
          commandType: stored.type,
          attempts: stored.attempts,
          lastError: code,
        };
        this.pushFailureConfirmation(stored, code);
      }
      return {
        ok: false,
        kind: terminal ? "permanent" : "transient",
        code,
        message: `Simulated ${stored.type} failure`,
        ...(terminal ? {} : { retryAfterMs: scenario.delayMs ?? 1_000 }),
      };
    }
    const generated = this.successConfirmations(stored);
    if (scenario.confirmationOrder === "reverse") generated.reverse();
    this.confirmations.push(...generated);
    if (scenario.duplicateConfirmations)
      this.confirmations.push(...generated.map((event) => ({ ...event })));
    stored.accepted = true;
    return {
      ok: true,
      value: {
        operationId: stored.operationId,
        state: "accepted",
        attempt: stored.attempts,
        duplicate,
      },
      ...(duplicate ? { duplicate: true } : {}),
    };
  }

  private successConfirmations(
    stored: StoredOperation,
  ): ProvisioningConfirmation[] {
    const organizationId = stored.command.organizationId;
    const tenantId =
      "existingTenantId" in stored.command && stored.command.existingTenantId
        ? stored.command.existingTenantId
        : "tenantId" in stored.command
          ? stored.command.tenantId
          : stableId("tenant", organizationId);
    if (stored.type === "teardown") {
      const command = stored.command as TeardownCommand;
      return [
        this.confirmation(stored, 1, "teardown.completed", tenantId, {
          retainedResourceIds: command.retainedResourceIds,
        }),
      ];
    }
    const command = stored.command as ProvisionCommand;
    const entitlementResourceIds = Object.fromEntries(
      command.entitlements.map((item) => [
        item.entitlementId,
        stableId("resource", `${tenantId}:${item.entitlementId}`),
      ]),
    );
    return [
      this.confirmation(stored, 1, "provisioning.accepted", tenantId, {
        orderId: command.orderId,
      }),
      this.confirmation(stored, 2, "provisioning.completed", tenantId, {
        orderId: command.orderId,
        entitlementResourceIds,
        credentialDeliveryReference: stableId(
          "credential_delivery",
          stored.operationId,
        ),
      }),
    ];
  }

  private pushFailureConfirmation(stored: StoredOperation, code: string): void {
    const tenantId =
      "tenantId" in stored.command
        ? stored.command.tenantId
        : "existingTenantId" in stored.command &&
            stored.command.existingTenantId
          ? stored.command.existingTenantId
          : stableId("tenant", stored.command.organizationId);
    this.confirmations.push(
      this.confirmation(
        stored,
        stored.attempts,
        stored.type === "teardown" ? "teardown.failed" : "provisioning.failed",
        tenantId,
        { errorCode: code },
      ),
    );
  }

  private confirmation(
    stored: StoredOperation,
    sequence: number,
    type: ProvisioningConfirmationType,
    tenantId: string,
    extra: Partial<ProvisioningConfirmation> = {},
  ): ProvisioningConfirmation {
    return {
      eventId: stableId(
        "provisioning_event",
        `${stored.operationId}:${sequence}:${type}`,
      ),
      operationId: stored.operationId,
      sequence,
      type,
      occurredAt: this.now(),
      organizationId: stored.command.organizationId,
      tenantId,
      entitlementResourceIds: {},
      ...extra,
    };
  }
}

function validateProvision(
  input: ProvisionCommand,
): ProviderResult<never> | null {
  if (input.entitlements.length === 0)
    return permanent(
      "ENTITLEMENTS_REQUIRED",
      "At least one entitlement is required",
    );
  const identifiers = new Set<string>();
  for (const entitlement of input.entitlements) {
    if (identifiers.has(entitlement.entitlementId))
      return permanent(
        "DUPLICATE_ENTITLEMENT",
        "Entitlement IDs must be unique within a command",
      );
    identifiers.add(entitlement.entitlementId);
    if (entitlement.environment === "poc" && !entitlement.expiresAt)
      return permanent(
        "POC_EXPIRY_REQUIRED",
        "POC entitlements require expiry",
      );
    if (
      entitlement.environment === "sandbox" &&
      entitlement.sku === "LOCKED-STORAGE-TB"
    )
      return permanent(
        "SANDBOX_SKU_REQUIRED",
        "Production SKUs cannot be provisioned into a sandbox",
      );
  }
  if (input.mode === "poc_upgrade_in_place" && !input.existingTenantId)
    return permanent(
      "POC_TENANT_REQUIRED",
      "POC upgrade-in-place must reference the existing tenant",
    );
  return null;
}

function validateTeardown(
  input: TeardownCommand,
): ProviderResult<never> | null {
  if (input.approvalIds[0] === input.approvalIds[1])
    return permanent(
      "TWO_PERSON_REQUIRED",
      "Two distinct destructive approvals are required",
    );
  if (input.reason.trim().length < 8)
    return permanent(
      "TEARDOWN_REASON_REQUIRED",
      "A teardown reason is required",
    );
  return null;
}

function stableJsonHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(sortValue(value)))
    .digest("hex");
}

function parseProvisioningSignature(value: string): {
  timestamp: number;
  digest: string;
} {
  const fields = new Map(
    value.split(",").map((part) => {
      const separator = part.indexOf("=");
      return [part.slice(0, separator), part.slice(separator + 1)] as const;
    }),
  );
  const timestamp = Number(fields.get("t"));
  const digest = fields.get("v1") ?? "";
  if (!Number.isSafeInteger(timestamp) || !/^[a-f0-9]{64}$/.test(digest))
    throw new Error("Provisioning webhook signature header is malformed");
  return { timestamp, digest };
}

function parseProvisioningConfirmation(
  rawBody: Uint8Array,
): ProvisioningConfirmation {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    throw new Error("Provisioning webhook body is not valid JSON");
  }
  if (!isRecord(value))
    throw new Error("Provisioning webhook body must be an object");
  const requiredStrings = [
    "eventId",
    "operationId",
    "type",
    "occurredAt",
    "organizationId",
    "tenantId",
  ] as const;
  for (const field of requiredStrings)
    if (typeof value[field] !== "string" || value[field].length === 0)
      throw new Error(`Provisioning webhook ${field} is required`);
  const types: readonly ProvisioningConfirmationType[] = [
    "provisioning.accepted",
    "provisioning.completed",
    "provisioning.failed",
    "teardown.completed",
    "teardown.failed",
  ];
  if (!types.includes(value.type as ProvisioningConfirmationType))
    throw new Error("Provisioning webhook type is unsupported");
  if (
    !Number.isSafeInteger(value.sequence) ||
    (value.sequence as number) < 0 ||
    !Number.isFinite(Date.parse(value.occurredAt as string))
  )
    throw new Error("Provisioning webhook sequence or timestamp is invalid");
  if (!isStringRecord(value.entitlementResourceIds))
    throw new Error("Provisioning webhook entitlement resource map is invalid");
  if (value.orderId !== undefined && typeof value.orderId !== "string")
    throw new Error("Provisioning webhook orderId is invalid");
  if (
    value.retainedResourceIds !== undefined &&
    (!Array.isArray(value.retainedResourceIds) ||
      !value.retainedResourceIds.every((item) => typeof item === "string"))
  )
    throw new Error("Provisioning webhook retained resources are invalid");
  return {
    eventId: value.eventId as string,
    operationId: value.operationId as string,
    sequence: value.sequence as number,
    type: value.type as ProvisioningConfirmationType,
    occurredAt: value.occurredAt as string,
    organizationId: value.organizationId as OrganizationId,
    ...(value.orderId ? { orderId: value.orderId as OrderId } : {}),
    tenantId: value.tenantId as string,
    entitlementResourceIds: value.entitlementResourceIds,
    ...(typeof value.credentialDeliveryReference === "string"
      ? { credentialDeliveryReference: value.credentialDeliveryReference }
      : {}),
    ...(Array.isArray(value.retainedResourceIds)
      ? { retainedResourceIds: value.retainedResourceIds }
      : {}),
    ...(typeof value.errorCode === "string"
      ? { errorCode: value.errorCode }
      : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    isRecord(value) &&
    Object.values(value).every((item) => typeof item === "string")
  );
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (typeof value === "object" && value !== null)
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortValue(item)]),
    );
  return value;
}

function stableId(prefix: string, value: string): string {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

function permanent(code: string, message: string): ProviderResult<never> {
  return { ok: false, kind: "permanent", code, message };
}

function transient(error: unknown): ProviderResult<never> {
  return {
    ok: false,
    kind: "transient",
    code: "PROVISIONING_PROVIDER_ERROR",
    message:
      error instanceof Error ? error.message : "Unknown provisioning error",
  };
}
