import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import { exceptionQueues } from "@clockwork/domain/lifecycle";

import type { RuntimeDatabase } from "../../client";
import { DatabaseLifecycleCommandRepository } from "./command-repository";

const validMarketplacePayload = {
  type: "metering.reported",
  eventId: "marketplace-event-boundary-1",
  provider: "aws" as const,
  providerAccountReference: "seller-account-1",
  accountId: "10000000-0000-4000-8000-000000000001",
  orderId: "50000000-0000-4000-8000-000000000001",
  entitlementId: "60000000-0000-4000-8000-000000000001",
  occurredAt: "2026-08-01T12:00:00.000Z",
  currency: "USD" as const,
  grossMinor: "1",
  feeMinor: "0",
  taxMinor: "0",
  netMinor: "1",
  quantity: "1",
  sequence: 1,
};
const queuePolicies = exceptionQueues.map((queue) => ({
  queue,
  ownerId: "20000000-0000-4000-8000-000000000001",
  backupId: "20000000-0000-4000-8000-000000000002",
  targetBusinessHours: 8,
  escalationOwnerId: "20000000-0000-4000-8000-000000000003",
  separationRequired: true,
}));

describe("marketplace repository pre-write validation", () => {
  it.each([
    ["money overflow", { grossMinor: "9223372036854775808" }],
    ["negative quantity", { quantity: "-1" }],
    ["exponent quantity", { quantity: "1e3" }],
    ["over-precision quantity", { quantity: "0.0000000000000000001" }],
  ])("rejects %s before opening a transaction", async (_label, override) => {
    const transaction = vi.fn();
    const database = { transaction } as unknown as RuntimeDatabase;
    const repository = new DatabaseLifecycleCommandRepository({
      database,
      serviceDatabase: database,
      authorizationSecret: "marketplace-boundary-secret-32-bytes",
      policies: {
        clickThroughThresholdMinor: "1000000",
        migrationFeatureEnabled: false,
        automatedTeardownEnabled: false,
        exceptionQueues: queuePolicies,
      },
    });

    await expect(
      repository.executeInTransaction({
        command: "ingest_marketplace_event",
        payload: { ...validMarketplacePayload, ...override },
        context: {
          requestId: "marketplace-boundary-request-1",
          actor: { kind: "provider", id: "marketplace:aws" },
          idempotencyKey: "marketplace:boundary:event:1",
          ip: null,
          userAgent: null,
          occurredAt: "2026-08-01T12:00:00.000Z",
          authorization: null,
        },
      }),
    ).rejects.toBeInstanceOf(ZodError);
    expect(transaction).not.toHaveBeenCalled();
  });
});
