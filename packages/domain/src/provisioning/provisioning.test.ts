import { describe, expect, it } from "vitest";

import {
  applyProvisioningConfirmation,
  beginProvisioning,
  createProvisioningCommand,
  presentPassThroughTerms,
  recordProvisioningDispatch,
  recoverDeadLetter,
} from ".";

const command = createProvisioningCommand({
  orderId: "order-1",
  orderVersion: 3,
  organizationId: "org-1",
  operation: "provision",
  lines: [{ sku: "STORAGE", quantity: "10", region: "us-east-2" }],
  mappings: [
    {
      commerceSku: "STORAGE",
      productCode: "locked-storage",
      entitlementKind: "storage",
      unit: "TB",
      allowedRegions: ["us-east-2"],
    },
  ],
  requestedAt: "2026-07-31T16:00:00.000Z",
});

describe("provisioning bridge policy", () => {
  it("derives deterministic command and idempotency identifiers", () => {
    expect(
      createProvisioningCommand({
        orderId: "order-1",
        orderVersion: 3,
        organizationId: "org-1",
        operation: "provision",
        lines: [{ sku: "STORAGE", quantity: "10", region: "us-east-2" }],
        mappings: [
          {
            commerceSku: "STORAGE",
            productCode: "locked-storage",
            entitlementKind: "storage",
            unit: "TB",
            allowedRegions: ["us-east-2"],
          },
        ],
        requestedAt: "2026-08-01T00:00:00.000Z",
      }).idempotencyKey,
    ).toBe(command.idempotencyKey);
  });

  it.each(["NaN", "Infinity", "1e3", " 10", "-0", "00", ".5"])(
    "rejects non-canonical entitlement quantity %s",
    (quantity) => {
      expect(() =>
        createProvisioningCommand({
          orderId: "order-invalid-quantity",
          orderVersion: 1,
          organizationId: "org-1",
          operation: "provision",
          lines: [{ sku: "STORAGE", quantity, region: "us-east-2" }],
          mappings: [
            {
              commerceSku: "STORAGE",
              productCode: "locked-storage",
              entitlementKind: "storage",
              unit: "TB",
              allowedRegions: ["us-east-2"],
            },
          ],
          requestedAt: "2026-07-31T16:00:00.000Z",
        }),
      ).toThrow("ENTITLEMENT_QUANTITY_INVALID");
    },
  );

  it("retries transient failure, dead-letters, and requires operator evidence", () => {
    let attempt = beginProvisioning(command);
    attempt = recordProvisioningDispatch(
      attempt,
      { ok: false, kind: "transient", code: "TIMEOUT", message: "timeout" },
      { now: "2026-07-31T16:00:00.000Z", maxAttempts: 1 },
    );
    expect(attempt.state).toBe("dead_letter");
    expect(() =>
      recoverDeadLetter(attempt, {
        operatorId: "op-1",
        reason: "retry",
        recoveredAt: "2026-07-31T16:01:00.000Z",
      }),
    ).toThrow("RECOVERY_REASON_REQUIRED");
    expect(
      recoverDeadLetter(attempt, {
        operatorId: "op-1",
        reason: "Provider recovered after timeout",
        recoveredAt: "2026-07-31T16:01:00.000Z",
      }).state,
    ).toBe("retry_scheduled");
  });

  it("deduplicates replayed confirmations", () => {
    const dispatched = recordProvisioningDispatch(
      beginProvisioning(command),
      { ok: true, operationId: "operation-1" },
      { now: "2026-07-31T16:00:00.000Z" },
    );
    const confirmation = {
      confirmationId: "confirmation-1",
      commandId: command.commandId,
      operationId: "operation-1",
      status: "succeeded" as const,
      tenantId: "tenant-1",
      resources: [{ entitlementSku: "STORAGE", resourceId: "bucket-1" }],
      occurredAt: "2026-07-31T16:02:00.000Z",
    };
    const first = applyProvisioningConfirmation(
      dispatched,
      confirmation,
      new Set(),
    );
    expect(first.attempt.state).toBe("confirmed");
    expect(
      applyProvisioningConfirmation(
        first.attempt,
        confirmation,
        new Set(["confirmation-1"]),
      ).duplicate,
    ).toBe(true);
  });

  it("presents resale first-login terms without commercial data", () => {
    expect(
      presentPassThroughTerms({
        sourcing: "resale",
        firstLogin: true,
        acceptedVersion: null,
        templateId: "terms-1",
        templateVersion: "1.0.0",
        exactTextHash: "a".repeat(64),
        productOrganizationId: "org-1",
        serviceName: "Fil One Storage",
        endClientAccountId: "account-end-client",
        commercialData: { transferPrice: "secret" },
      }),
    ).toEqual({
      templateId: "terms-1",
      templateVersion: "1.0.0",
      exactTextHash: "a".repeat(64),
      productOrganizationId: "org-1",
      serviceName: "Fil One Storage",
      accountId: "account-end-client",
    });
  });
});
