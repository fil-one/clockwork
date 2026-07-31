import { createHash } from "node:crypto";

const unsignedDecimalPattern = /^(0|[1-9]\d*)(?:\.\d+)?$/;

export type ProvisioningOperation =
  "provision" | "upgrade_poc" | "sandbox" | "teardown";

export interface EntitlementMapping {
  commerceSku: string;
  productCode: string;
  entitlementKind: "storage" | "egress" | "sandbox" | "feature";
  unit: string;
  allowedRegions: readonly string[];
}

export function mapEntitlements(
  lines: readonly { sku: string; quantity: string; region: string }[],
  mappings: readonly EntitlementMapping[],
): readonly {
  sku: string;
  productCode: string;
  entitlementKind: EntitlementMapping["entitlementKind"];
  quantity: string;
  region: string;
}[] {
  return lines.map((line) => {
    const mapping = mappings.find(
      (candidate) => candidate.commerceSku === line.sku,
    );
    if (!mapping) throw new Error(`ENTITLEMENT_MAPPING_MISSING:${line.sku}`);
    if (!mapping.allowedRegions.includes(line.region))
      throw new Error(
        `ENTITLEMENT_REGION_UNSUPPORTED:${line.sku}:${line.region}`,
      );
    if (
      typeof line.quantity !== "string" ||
      !unsignedDecimalPattern.test(line.quantity)
    )
      throw new Error("ENTITLEMENT_QUANTITY_INVALID");
    return {
      sku: line.sku,
      productCode: mapping.productCode,
      entitlementKind: mapping.entitlementKind,
      quantity: line.quantity,
      region: line.region,
    };
  });
}

export interface ProvisioningCommand {
  commandId: string;
  idempotencyKey: string;
  orderId: string;
  orderVersion: number;
  organizationId: string;
  operation: ProvisioningOperation;
  tenantId: string | null;
  entitlements: ReturnType<typeof mapEntitlements>;
  requestedAt: string;
}

export function createProvisioningCommand(input: {
  orderId: string;
  orderVersion: number;
  organizationId: string;
  operation: ProvisioningOperation;
  tenantId?: string;
  lines: readonly { sku: string; quantity: string; region: string }[];
  mappings: readonly EntitlementMapping[];
  requestedAt: string;
}): ProvisioningCommand {
  if (!Number.isInteger(input.orderVersion) || input.orderVersion < 1)
    throw new Error("ORDER_VERSION_INVALID");
  const canonical = `${input.orderId}:${input.orderVersion}:${input.operation}`;
  const digest = createHash("sha256").update(canonical).digest("hex");
  if (input.operation === "upgrade_poc" && !input.tenantId)
    throw new Error("POC_TENANT_REQUIRED");
  return {
    commandId: `provisioning-${digest.slice(0, 32)}`,
    idempotencyKey: `provisioning:${digest}`,
    orderId: input.orderId,
    orderVersion: input.orderVersion,
    organizationId: input.organizationId,
    operation: input.operation,
    tenantId: input.tenantId ?? null,
    entitlements: mapEntitlements(input.lines, input.mappings),
    requestedAt: input.requestedAt,
  };
}

export type ProvisioningAttemptState =
  "pending" | "in_flight" | "retry_scheduled" | "dead_letter" | "confirmed";

export interface ProvisioningAttempt {
  command: ProvisioningCommand;
  state: ProvisioningAttemptState;
  attempts: number;
  nextAttemptAt: string | null;
  lastError: {
    code: string;
    message: string;
    kind: "transient" | "permanent";
  } | null;
  providerOperationId: string | null;
  confirmedAt: string | null;
  operatorRecovery: {
    operatorId: string;
    reason: string;
    recoveredAt: string;
  } | null;
}

export function beginProvisioning(
  command: ProvisioningCommand,
): ProvisioningAttempt {
  return {
    command,
    state: "pending",
    attempts: 0,
    nextAttemptAt: command.requestedAt,
    lastError: null,
    providerOperationId: null,
    confirmedAt: null,
    operatorRecovery: null,
  };
}

export function recordProvisioningDispatch(
  attempt: ProvisioningAttempt,
  result:
    | { ok: true; operationId: string }
    | {
        ok: false;
        kind: "transient" | "permanent";
        code: string;
        message: string;
      },
  input: { now: string; maxAttempts?: number; baseDelayMs?: number },
): ProvisioningAttempt {
  if (attempt.state === "confirmed") return attempt;
  const attempts = attempt.attempts + 1;
  if (result.ok)
    return {
      ...attempt,
      state: "in_flight",
      attempts,
      nextAttemptAt: null,
      lastError: null,
      providerOperationId: result.operationId,
    };
  const maxAttempts = input.maxAttempts ?? 8;
  const retryable = result.kind === "transient" && attempts < maxAttempts;
  const delay = Math.min(
    (input.baseDelayMs ?? 1_000) * 2 ** Math.max(0, attempts - 1),
    300_000,
  );
  return {
    ...attempt,
    state: retryable ? "retry_scheduled" : "dead_letter",
    attempts,
    nextAttemptAt: retryable
      ? new Date(Date.parse(input.now) + delay).toISOString()
      : null,
    lastError: result,
  };
}

export function recoverDeadLetter(
  attempt: ProvisioningAttempt,
  input: { operatorId: string; reason: string; recoveredAt: string },
): ProvisioningAttempt {
  if (attempt.state !== "dead_letter")
    throw new Error("COMMAND_NOT_DEAD_LETTERED");
  if (input.reason.trim().length < 8)
    throw new Error("RECOVERY_REASON_REQUIRED");
  return {
    ...attempt,
    state: "retry_scheduled",
    nextAttemptAt: input.recoveredAt,
    lastError: null,
    operatorRecovery: { ...input, reason: input.reason.trim() },
  };
}

export interface ProvisioningConfirmation {
  confirmationId: string;
  commandId: string;
  operationId: string;
  status: "succeeded" | "failed";
  tenantId: string;
  resources: readonly { entitlementSku: string; resourceId: string }[];
  occurredAt: string;
}

export function applyProvisioningConfirmation(
  attempt: ProvisioningAttempt,
  confirmation: ProvisioningConfirmation,
  processedConfirmationIds: ReadonlySet<string>,
): { attempt: ProvisioningAttempt; duplicate: boolean } {
  if (processedConfirmationIds.has(confirmation.confirmationId))
    return { attempt, duplicate: true };
  if (confirmation.commandId !== attempt.command.commandId)
    throw new Error("CONFIRMATION_COMMAND_MISMATCH");
  if (
    attempt.providerOperationId &&
    confirmation.operationId !== attempt.providerOperationId
  )
    throw new Error("CONFIRMATION_OPERATION_MISMATCH");
  if (attempt.state === "confirmed") return { attempt, duplicate: true };
  if (confirmation.status === "failed")
    return {
      duplicate: false,
      attempt: {
        ...attempt,
        state: "dead_letter",
        nextAttemptAt: null,
        lastError: {
          kind: "permanent",
          code: "PROVISIONING_CONFIRMATION_FAILED",
          message: "Provisioning provider reported a failed operation",
        },
      },
    };
  return {
    duplicate: false,
    attempt: {
      ...attempt,
      state: "confirmed",
      providerOperationId: confirmation.operationId,
      confirmedAt: confirmation.occurredAt,
      nextAttemptAt: null,
      lastError: null,
    },
  };
}

export function credentialDeliveryRoute(input: {
  sourcing: "direct" | "referral" | "resale";
  clientAdmins: readonly string[];
  partnerAdmins: readonly string[];
  endClientAdmins: readonly string[];
}): { recipients: readonly string[]; revealCommercialData: false } {
  const recipients =
    input.sourcing === "resale"
      ? [...new Set([...input.partnerAdmins, ...input.endClientAdmins])]
      : [...new Set(input.clientAdmins)];
  return { recipients, revealCommercialData: false };
}

export interface PassThroughTermsPresentation {
  templateId: string;
  templateVersion: string;
  exactTextHash: string;
  productOrganizationId: string;
  serviceName: string;
  accountId: string;
}

export function presentPassThroughTerms(input: {
  sourcing: "direct" | "referral" | "resale";
  firstLogin: boolean;
  acceptedVersion: string | null;
  templateId: string;
  templateVersion: string;
  exactTextHash: string;
  productOrganizationId: string;
  serviceName: string;
  endClientAccountId: string;
  commercialData?: unknown;
}): PassThroughTermsPresentation | null {
  if (input.sourcing !== "resale" || !input.firstLogin) return null;
  if (input.acceptedVersion === input.templateVersion) return null;
  return {
    templateId: input.templateId,
    templateVersion: input.templateVersion,
    exactTextHash: input.exactTextHash,
    productOrganizationId: input.productOrganizationId,
    serviceName: input.serviceName,
    accountId: input.endClientAccountId,
  };
}

export function acceptPassThroughTerms(input: {
  presentation: PassThroughTermsPresentation;
  userId: string;
  acceptedHash: string;
  acceptedAt: string;
  ip: string;
}): Readonly<typeof input> {
  if (input.acceptedHash !== input.presentation.exactTextHash)
    throw new Error("PASS_THROUGH_TEXT_MISMATCH");
  if (
    !input.userId ||
    !input.ip ||
    !Number.isFinite(Date.parse(input.acceptedAt))
  )
    throw new Error("PASS_THROUGH_EVIDENCE_INCOMPLETE");
  return Object.freeze({ ...input });
}
