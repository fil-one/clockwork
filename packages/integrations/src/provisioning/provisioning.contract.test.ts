import { IdempotencyKeySchema, ids } from "@clockwork/contracts";
import { describe, expect, it } from "vitest";

import {
  FakeProvisioningBridge,
  FixedEntitlementProductMapping,
  InMemoryProvisioningOperationExpectationStore,
  ProvisioningBridgeAdapter,
  ProvisioningWebhookVerifier,
  signProvisioningWebhook,
} from "./index";

const orderId = ids.order.parse("80000000-0000-4000-8000-000000000304");
const organizationId = ids.organization.parse(
  "30000000-0000-4000-8000-000000000304",
);

const command = {
  orderId,
  organizationId,
  mode: "new_tenant" as const,
  entitlements: [
    {
      entitlementId: "entitlement-contract-304",
      sku: "LOCKED-STORAGE-TB",
      quantity: "10",
      region: "us-east-2",
      environment: "production" as const,
    },
  ],
  credentialDelivery: {
    channel: "portal" as const,
    recipientAccountId: "10000000-0000-4000-8000-000000000304",
  },
  idempotencyKey: IdempotencyKeySchema.parse("provisioning:order:contract:304"),
};

describe("provisioning bridge provider contract", () => {
  it("is deterministic and emits replay-safe confirmation references", async () => {
    const bridge = new FakeProvisioningBridge();
    const first = await bridge.provision(command);
    const replay = await bridge.provision(command);
    expect(first.ok && replay.ok).toBe(true);
    if (!first.ok || !replay.ok) throw new Error("expected operation");
    expect(replay.value.operationId).toBe(first.value.operationId);
    expect(replay.duplicate).toBe(true);
    const confirmations = await bridge.drainConfirmations();
    expect(confirmations.map((event) => event.type)).toEqual([
      "provisioning.accepted",
      "provisioning.completed",
    ]);
    expect(confirmations[1]?.credentialDeliveryReference).toContain(
      "credential_delivery_",
    );
    expect(
      confirmations[1]?.entitlementResourceIds["entitlement-contract-304"],
    ).toContain("resource_");
  });

  it("simulates retries, delays, duplicate and out-of-order callbacks, then operator recovery", async () => {
    const bridge = new FakeProvisioningBridge({ maxAttempts: 2 });
    bridge.enqueue(
      "provision",
      { outcome: "transient_failure", delayMs: 250 },
      { outcome: "transient_failure", errorCode: "UPSTREAM_TIMEOUT" },
      {
        outcome: "success",
        duplicateConfirmations: true,
        confirmationOrder: "reverse",
      },
    );
    const first = await bridge.provision(command);
    expect(first).toMatchObject({ ok: false, kind: "transient" });
    const failed = await bridge.provision(command);
    expect(failed).toMatchObject({ ok: false, kind: "permanent" });
    const letters = await bridge.listDeadLetters();
    expect(letters).toHaveLength(1);
    const recovered = await bridge.recover({
      operationId: letters[0]?.operationId ?? "",
      operatorId: "operator-a",
      reason: "upstream restored after timeout",
      idempotencyKey: IdempotencyKeySchema.parse(
        "provisioning:recover:contract:304",
      ),
    });
    expect(recovered).toMatchObject({ ok: true });
    const callbacks = await bridge.drainConfirmations();
    expect(callbacks.map((item) => item.type)).toEqual([
      "provisioning.failed",
      "provisioning.completed",
      "provisioning.accepted",
      "provisioning.completed",
      "provisioning.accepted",
    ]);
  });

  it("upgrades a POC tenant in place and protects destructive teardown", async () => {
    const bridge = new FakeProvisioningBridge();
    const upgraded = await bridge.provision({
      ...command,
      mode: "poc_upgrade_in_place",
      existingTenantId: "tenant_poc_304",
      idempotencyKey: IdempotencyKeySchema.parse(
        "provisioning:poc-upgrade:contract:304",
      ),
    });
    expect(upgraded.ok).toBe(true);
    const confirmations = await bridge.drainConfirmations();
    expect(
      confirmations.every((item) => item.tenantId === "tenant_poc_304"),
    ).toBe(true);

    await expect(
      bridge.teardown({
        organizationId,
        tenantId: "tenant_poc_304",
        approvalIds: ["approval-a", "approval-a"],
        retainedResourceIds: ["retained-object-lock-resource"],
        reason: "Contract termination",
        idempotencyKey: IdempotencyKeySchema.parse(
          "provisioning:teardown:contract:304",
        ),
      }),
    ).resolves.toMatchObject({ ok: false, code: "TWO_PERSON_REQUIRED" });
  });

  it("authenticates raw bytes and binds confirmations to the expected command", async () => {
    const secret = "provisioning-contract-secret-304";
    const now = new Date("2026-07-31T16:00:00.000Z");
    const expectations = new InMemoryProvisioningOperationExpectationStore();
    await expectations.register({
      operationId: "operation-contract-304",
      commandType: "provision",
      organizationId,
      orderId,
    });
    const verifier = new ProvisioningWebhookVerifier(
      secret,
      expectations,
      () => now,
    );
    const confirmation = {
      eventId: "event-contract-304",
      operationId: "operation-contract-304",
      sequence: 2,
      type: "provisioning.completed",
      occurredAt: now.toISOString(),
      organizationId,
      orderId,
      tenantId: "tenant-contract-304",
      entitlementResourceIds: {
        "entitlement-contract-304": "resource-contract-304",
      },
    };
    const rawBody = new TextEncoder().encode(JSON.stringify(confirmation));
    const signature = signProvisioningWebhook({
      secret,
      timestamp: Math.floor(now.getTime() / 1000),
      rawBody,
    });

    await expect(verifier.verify({ rawBody, signature })).resolves.toEqual({
      eventId: confirmation.eventId,
      occurredAt: confirmation.occurredAt,
      payload: confirmation,
    });
    await expect(
      verifier.verify({ rawBody, signature }),
    ).resolves.toMatchObject({
      eventId: confirmation.eventId,
    });

    const wrongOrderBody = new TextEncoder().encode(
      JSON.stringify({
        ...confirmation,
        orderId: ids.order.parse("80000000-0000-4000-8000-000000000305"),
      }),
    );
    await expect(
      verifier.verify({
        rawBody: wrongOrderBody,
        signature: signProvisioningWebhook({
          secret,
          timestamp: Math.floor(now.getTime() / 1000),
          rawBody: wrongOrderBody,
        }),
      }),
    ).rejects.toThrow("order does not match");
    await expect(
      verifier.verify({
        rawBody: new TextEncoder().encode(`${JSON.stringify(confirmation)} `),
        signature,
      }),
    ).rejects.toThrow("signature is invalid");
  });

  it("persists the operation binding before calling a production provider client", async () => {
    const expectations = new InMemoryProvisioningOperationExpectationStore();
    const calls: string[] = [];
    const bridge = new ProvisioningBridgeAdapter(
      {
        provision: async (input) => {
          await expect(
            expectations.get(input.operationId),
          ).resolves.toMatchObject({
            organizationId,
            orderId,
          });
          calls.push(input.operationId);
          return { accepted: true as const };
        },
        teardown: () => Promise.resolve({ accepted: true as const }),
      },
      new FixedEntitlementProductMapping("contract-v1", {
        "LOCKED-STORAGE-TB": {
          productCode: "object-lock-storage",
          featureCodes: ["object-lock"],
        },
      }),
      expectations,
    );

    const first = await bridge.provision(command);
    const replay = await bridge.provision(command);
    expect(first).toMatchObject({ ok: true });
    expect(replay).toMatchObject({ ok: true, duplicate: true });
    if (!first.ok) throw new Error("expected operation");
    const persisted = await expectations.get(first.value.operationId);
    expect(persisted).toMatchObject({
      operationId: first.value.operationId,
      commandType: "provision",
      organizationId,
      orderId,
    });
    expect(persisted?.commandFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(calls).toEqual([first.value.operationId, first.value.operationId]);
    const entitlement = command.entitlements[0];
    if (!entitlement) throw new Error("expected entitlement fixture");
    await expect(
      bridge.provision({
        ...command,
        entitlements: [{ ...entitlement, quantity: "999" }],
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: "OPERATION_BINDING_CONFLICT",
    });
    expect(calls).toHaveLength(2);
  });
});
