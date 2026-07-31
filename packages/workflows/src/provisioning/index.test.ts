import { describe, expect, it } from "vitest";

import {
  detectStuckProvisioning,
  handleProvisioningFailure,
  ingestProvisioningConfirmation,
  planOperatorRecovery,
  planProvisioningCommand,
} from "./index";

const mappings = [
  { sku: "storage", productCode: "fil-storage", allowedRegions: ["us-east"] },
];
const entitlement = {
  entitlementId: "entitlement-1",
  sku: "storage",
  quantity: "40.000",
  region: "us-east",
  sandbox: false,
};

describe("provisioning workflow", () => {
  it("maps products and keeps the command idempotent across retries", () => {
    const command = planProvisioningCommand({
      orderId: "order-1",
      organizationId: "org-1",
      version: 3,
      entitlements: [entitlement],
      mappings,
    });
    const recovery = planOperatorRecovery({
      orderId: "order-1",
      version: 3,
      operatorId: "operator-1",
      reason: "Provider outage cleared",
      originalPayload: command.payload,
    });
    expect(recovery.idempotencyKey).toBe(command.idempotencyKey);
  });

  it("enforces POC upgrade in place and preserves data", () => {
    const command = planProvisioningCommand({
      orderId: "order-1",
      organizationId: "org-poc",
      pocOrganizationId: "org-poc",
      version: 1,
      entitlements: [{ ...entitlement, sandbox: true }],
      mappings,
    });
    expect(command.kind).toBe("upgrade_poc_in_place");
    expect(command.payload).toMatchObject({ preserveTenantAndData: true });
    expect(() =>
      planProvisioningCommand({
        orderId: "order-1",
        organizationId: "org-new",
        pocOrganizationId: "org-poc",
        version: 1,
        entitlements: [entitlement],
        mappings,
      }),
    ).toThrow("POC_UPGRADE_MUST_REUSE_ORGANIZATION");
  });

  it("deduplicates and rejects out-of-order confirmation events", () => {
    const confirmation = {
      providerEventId: "event-1",
      operationId: "operation-1",
      orderId: "order-1",
      organizationId: "org-1",
      status: "succeeded" as const,
      provisionedResourceIds: { "entitlement-1": "tenant-1" },
      credentialReference: "vault://credential-1",
      occurredAt: "2026-07-31T16:00:00.000Z",
    };
    expect(
      ingestProvisioningConfirmation({
        version: 1,
        expectedOperationId: "operation-1",
        confirmation,
        processedProviderEventIds: new Set(),
        credentialRecipients: ["owner@example.test"],
      }),
    ).toMatchObject({
      status: "recorded",
      effects: [{}, { kind: "deliver_credentials" }],
    });
    expect(
      ingestProvisioningConfirmation({
        version: 1,
        expectedOperationId: "old-operation",
        confirmation,
        processedProviderEventIds: new Set(),
        credentialRecipients: ["owner@example.test"],
      }).status,
    ).toBe("out_of_order_ignored");
  });

  it("dead-letters exhausted failures and alerts stuck commands once", () => {
    expect(
      handleProvisioningFailure({
        orderId: "order-1",
        version: 1,
        attempt: 8,
        failedAt: "2026-07-31T16:00:00.000Z",
        failure: { kind: "transient", code: "TIMEOUT", message: "again" },
      }).status,
    ).toBe("dead_lettered");
    expect(
      detectStuckProvisioning({
        orderId: "order-1",
        version: 1,
        status: "running",
        lastProgressAt: "2026-07-31T15:00:00.000Z",
        now: "2026-07-31T16:00:00.000Z",
        stuckAfterMinutes: 30,
      })?.kind,
    ).toBe("alert_stuck_provisioning");
  });
});
