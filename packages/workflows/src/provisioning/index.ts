import {
  disposeEffectFailure,
  effectIdempotencyKey,
  type EffectFailureDisposition,
  type ProviderFailure,
  workflowEffect,
  type WorkflowEffect,
  type WorkflowIdentity,
} from "../onboarding/durable";

export const provisioningTaskIds = Object.freeze({
  commandDispatch: "lifecycle-provisioning-command-dispatch-v1",
  confirmationIngestion: "lifecycle-provisioning-confirmation-ingestion-v1",
  stuckRecovery: "lifecycle-provisioning-stuck-recovery-v1",
});

export interface RequestedEntitlement {
  entitlementId: string;
  sku: string;
  quantity: string;
  region: string;
  sandbox: boolean;
}

export interface EntitlementMapping {
  sku: string;
  productCode: string;
  allowedRegions: readonly string[];
}

export type ProvisioningEffect = WorkflowEffect<
  | "provision_entitlements"
  | "upgrade_poc_in_place"
  | "record_provisioning_confirmation"
  | "deliver_credentials"
  | "open_provisioning_dead_letter"
  | "alert_stuck_provisioning",
  Readonly<Record<string, unknown>>
>;

function provisioningIdentity(
  orderId: string,
  version: number,
): WorkflowIdentity {
  return {
    aggregateType: "order",
    aggregateId: orderId,
    aggregateVersion: version,
    operation: "provision",
  };
}

function resolveEntitlements(
  entitlements: readonly RequestedEntitlement[],
  mappings: readonly EntitlementMapping[],
): readonly Readonly<Record<string, unknown>>[] {
  return entitlements.map((entitlement) => {
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(entitlement.quantity))
      throw new Error("ENTITLEMENT_QUANTITY_INVALID");
    const mapping = mappings.find(
      (candidate) => candidate.sku === entitlement.sku,
    );
    if (!mapping)
      throw new Error(`ENTITLEMENT_MAPPING_MISSING:${entitlement.sku}`);
    if (!mapping.allowedRegions.includes(entitlement.region))
      throw new Error(
        `ENTITLEMENT_REGION_UNSUPPORTED:${entitlement.sku}:${entitlement.region}`,
      );
    return {
      ...entitlement,
      productCode: mapping.productCode,
      environment: entitlement.sandbox ? "sandbox" : "production",
    };
  });
}

export function planProvisioningCommand(input: {
  orderId: string;
  organizationId: string;
  version: number;
  entitlements: readonly RequestedEntitlement[];
  mappings: readonly EntitlementMapping[];
  pocOrganizationId?: string;
}): ProvisioningEffect {
  if (input.entitlements.length === 0) throw new Error("ENTITLEMENT_REQUIRED");
  const resolved = resolveEntitlements(input.entitlements, input.mappings);
  const upgradeInPlace = input.pocOrganizationId !== undefined;
  if (upgradeInPlace && input.pocOrganizationId !== input.organizationId)
    throw new Error("POC_UPGRADE_MUST_REUSE_ORGANIZATION");
  const identity = provisioningIdentity(input.orderId, input.version);
  return workflowEffect(
    identity,
    upgradeInPlace ? "poc-upgrade-command" : "provision-command",
    upgradeInPlace ? "upgrade_poc_in_place" : "provision_entitlements",
    {
      orderId: input.orderId,
      organizationId: input.organizationId,
      entitlements: resolved,
      preserveTenantAndData: upgradeInPlace,
    },
  );
}

export function handleProvisioningFailure(input: {
  orderId: string;
  version: number;
  attempt: number;
  failedAt: string;
  failure: ProviderFailure;
  pocUpgrade?: boolean;
}): EffectFailureDisposition {
  return disposeEffectFailure({
    identity: provisioningIdentity(input.orderId, input.version),
    effectDiscriminator: input.pocUpgrade
      ? "poc-upgrade-command"
      : "provision-command",
    attempt: input.attempt,
    failure: input.failure,
    failedAt: input.failedAt,
  });
}

export interface ProvisioningConfirmation {
  providerEventId: string;
  operationId: string;
  orderId: string;
  organizationId: string;
  status: "succeeded" | "failed";
  provisionedResourceIds: Readonly<Record<string, string>>;
  credentialReference: string | null;
  occurredAt: string;
}

export function ingestProvisioningConfirmation(input: {
  version: number;
  expectedOperationId: string;
  confirmation: ProvisioningConfirmation;
  processedProviderEventIds: ReadonlySet<string>;
  credentialRecipients: readonly string[];
}):
  | Readonly<{
      status: "replay_ignored" | "out_of_order_ignored";
      effects: readonly [];
    }>
  | Readonly<{ status: "recorded"; effects: readonly ProvisioningEffect[] }> {
  if (input.processedProviderEventIds.has(input.confirmation.providerEventId))
    return { status: "replay_ignored", effects: [] };
  if (input.confirmation.operationId !== input.expectedOperationId)
    return { status: "out_of_order_ignored", effects: [] };
  const identity = provisioningIdentity(
    input.confirmation.orderId,
    input.version,
  );
  const effects: ProvisioningEffect[] = [
    workflowEffect(
      identity,
      `confirmation:${input.confirmation.providerEventId}`,
      "record_provisioning_confirmation",
      { ...input.confirmation },
    ),
  ];
  if (input.confirmation.status === "failed") {
    effects.push(
      workflowEffect(
        { ...identity, operation: "provisioning-dead-letter" },
        `failed-confirmation:${input.confirmation.providerEventId}`,
        "open_provisioning_dead_letter",
        {
          orderId: input.confirmation.orderId,
          operationId: input.confirmation.operationId,
          providerEventId: input.confirmation.providerEventId,
          operatorRecoveryRequired: true,
        },
      ),
    );
  } else {
    if (!input.confirmation.credentialReference)
      throw new Error("CREDENTIAL_REFERENCE_REQUIRED");
    if (input.credentialRecipients.length === 0)
      throw new Error("CREDENTIAL_RECIPIENT_REQUIRED");
    effects.push(
      workflowEffect(identity, "credential-delivery", "deliver_credentials", {
        orderId: input.confirmation.orderId,
        organizationId: input.confirmation.organizationId,
        credentialReference: input.confirmation.credentialReference,
        recipients: [...new Set(input.credentialRecipients)].sort(),
      }),
    );
  }
  return { status: "recorded", effects };
}

export function detectStuckProvisioning(input: {
  orderId: string;
  version: number;
  status: "pending" | "running" | "succeeded" | "failed";
  lastProgressAt: string;
  now: string;
  stuckAfterMinutes: number;
}): ProvisioningEffect | null {
  if (["succeeded", "failed"].includes(input.status)) return null;
  if (!Number.isInteger(input.stuckAfterMinutes) || input.stuckAfterMinutes < 1)
    throw new Error("STUCK_THRESHOLD_INVALID");
  if (
    Date.parse(input.now) - Date.parse(input.lastProgressAt) <
    input.stuckAfterMinutes * 60_000
  )
    return null;
  return workflowEffect(
    {
      ...provisioningIdentity(input.orderId, input.version),
      operation: "stuck-watch",
    },
    `stuck-since:${input.lastProgressAt}`,
    "alert_stuck_provisioning",
    { orderId: input.orderId, lastProgressAt: input.lastProgressAt },
  );
}

/** Operator re-drive keeps the original downstream key, so success still occurs once. */
export function planOperatorRecovery(input: {
  orderId: string;
  version: number;
  operatorId: string;
  reason: string;
  originalPayload: Readonly<Record<string, unknown>>;
  pocUpgrade?: boolean;
}): ProvisioningEffect {
  if (!input.operatorId.trim()) throw new Error("RECOVERY_OPERATOR_REQUIRED");
  if (input.reason.trim().length < 8)
    throw new Error("RECOVERY_REASON_REQUIRED");
  const identity = provisioningIdentity(input.orderId, input.version);
  const discriminator = input.pocUpgrade
    ? "poc-upgrade-command"
    : "provision-command";
  return {
    kind: input.pocUpgrade ? "upgrade_poc_in_place" : "provision_entitlements",
    idempotencyKey: effectIdempotencyKey(identity, discriminator),
    payload: {
      ...input.originalPayload,
      recovery: { operatorId: input.operatorId, reason: input.reason.trim() },
    },
  };
}
