import { describe, expect, it, vi } from "vitest";

import type { ClaimedOutboxMessage } from "@clockwork/db";
import { FakeWorkosIdentityAdapter } from "@clockwork/integrations";

import { DurableOutboxDispatcher } from "./outbox-dispatcher";
import {
  createWorkosOrganizationOutboxHandler,
  type WorkosOrganizationProvisioningStore,
} from "./workos-organization";

const organizationId = "10000000-0000-4000-8000-000000000001";
const accountId = "20000000-0000-4000-8000-000000000001";
const message: ClaimedOutboxMessage = {
  id: "30000000-0000-4000-8000-000000000001",
  eventId: "40000000-0000-4000-8000-000000000001",
  topic: "organization.created",
  payload: {
    eventType: "organization.created",
    aggregateType: "organization",
    aggregateId: organizationId,
    data: { organizationId, accountId },
  },
  attempt: 1,
  leaseToken: "lease-1",
};

describe("WorkOS organization outbox join", () => {
  it("persists the organization and MFA binding once across a duplicate replay", async () => {
    let binding:
      { workosOrganizationId: string; mfaPolicy: "required" } | undefined;
    const persist = vi.fn<WorkosOrganizationProvisioningStore["persist"]>(
      (input) => {
        binding = {
          workosOrganizationId: input.workosOrganizationId,
          mfaPolicy: "required",
        };
        return Promise.resolve();
      },
    );
    const store: WorkosOrganizationProvisioningStore = {
      load: () =>
        Promise.resolve({
          organizationId,
          accountId,
          legalName: "Northstar Labs",
          ...(binding
            ? {
                workosOrganizationId: binding.workosOrganizationId,
                completed: binding.mfaPolicy === "required",
              }
            : { completed: false }),
        }),
      persist,
    };
    const identity = new FakeWorkosIdentityAdapter();
    const createOrganization = vi.spyOn(identity, "createOrganization");
    const setMfaPolicy = vi.spyOn(identity, "setMfaPolicy");
    const replay = { ...message, attempt: 2, leaseToken: "lease-2" };
    const claimNext = vi
      .fn()
      .mockResolvedValueOnce(message)
      .mockResolvedValueOnce(replay);
    const dispatcher = new DurableOutboxDispatcher(
      {
        claimNext,
        complete: vi.fn().mockResolvedValue(undefined),
        fail: vi.fn().mockResolvedValue(undefined),
      },
      new Map([
        [
          "organization.created",
          createWorkosOrganizationOutboxHandler({ identity, store }),
        ],
      ]),
    );

    await Promise.all([
      dispatcher.dispatchOne("registration-worker-1"),
      Promise.resolve(),
    ]);
    await dispatcher.dispatchOne("registration-worker-2");

    expect(binding).toMatchObject({ mfaPolicy: "required" });
    expect(createOrganization).toHaveBeenCalledTimes(1);
    expect(setMfaPolicy).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(createOrganization).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: `outbox:${message.id}` }),
    );
  });
});
