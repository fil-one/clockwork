import { z } from "zod";

import { IdempotencyKeySchema, ids } from "@clockwork/contracts";
import type { WorkosIdentityPort } from "@clockwork/integrations";

import type { OutboxTopicHandler } from "./outbox-dispatcher";

const OrganizationCreatedPayloadSchema = z.object({
  eventType: z.literal("organization.created"),
  aggregateType: z.literal("organization"),
  aggregateId: z.uuid(),
  data: z.object({
    organizationId: z.uuid(),
    accountId: z.uuid(),
  }),
});

export interface WorkosOrganizationProvisioningStore {
  load(
    organizationId: string,
    requestId: string,
  ): Promise<{
    organizationId: string;
    accountId: string;
    legalName: string;
    workosOrganizationId?: string;
    completed: boolean;
  }>;
  persist(input: {
    organizationId: string;
    accountId: string;
    workosOrganizationId: string;
    mfaPolicy: "required" | "inherited_from_sso";
    requestId: string;
  }): Promise<void>;
}

/** Durable registration join: provider calls precede one atomic local binding. */
export function createWorkosOrganizationOutboxHandler(input: {
  identity: WorkosIdentityPort;
  store: WorkosOrganizationProvisioningStore;
}): OutboxTopicHandler {
  return async (delivery) => {
    const event = OrganizationCreatedPayloadSchema.parse(delivery.payload);
    if (event.aggregateId !== event.data.organizationId)
      throw new Error("WORKOS_ORGANIZATION_EVENT_BINDING_MISMATCH");
    const target = await input.store.load(
      event.data.organizationId,
      delivery.messageId,
    );
    if (target.accountId !== event.data.accountId)
      throw new Error("WORKOS_ORGANIZATION_ACCOUNT_BINDING_MISMATCH");
    if (target.completed) return;

    let providerOrganizationId = target.workosOrganizationId;
    if (!providerOrganizationId) {
      const created = await input.identity.createOrganization({
        commerceOrganizationId: ids.organization.parse(target.organizationId),
        legalName: target.legalName,
        idempotencyKey: IdempotencyKeySchema.parse(delivery.idempotencyKey),
      });
      if (!created.ok)
        throw new Error(`WORKOS_ORGANIZATION_CREATE_FAILED:${created.code}`);
      providerOrganizationId = created.value.id;
    }
    const policy = await input.identity.setMfaPolicy({
      organizationId: providerOrganizationId,
      policy: "required",
      idempotencyKey: IdempotencyKeySchema.parse(
        `${delivery.idempotencyKey}:mfa`,
      ),
    });
    if (!policy.ok) throw new Error(`WORKOS_MFA_POLICY_FAILED:${policy.code}`);
    await input.store.persist({
      organizationId: target.organizationId,
      accountId: target.accountId,
      workosOrganizationId: providerOrganizationId,
      mfaPolicy: policy.value.policy,
      requestId: delivery.messageId,
    });
  };
}
