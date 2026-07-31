import { and, desc, eq, isNotNull, lt } from "drizzle-orm";

import type { RuntimeDatabase } from "../client";
import {
  commerceUsers,
  memberships,
  organizations,
  roleSyncEvents,
  webhookEvents,
} from "../schema";
import { withInternalTransaction } from "../transaction";

export class DatabaseWebhookDeduplicator {
  public constructor(private readonly db: RuntimeDatabase) {}

  public async claim(input: {
    provider: string;
    eventId: string;
    eventType: string;
    payloadHash: string;
    payload: unknown;
    occurredAt: string;
  }): Promise<"claimed" | "duplicate" | "in_progress"> {
    return withInternalTransaction(
      this.db,
      `webhook:${input.provider}:${input.eventId}`,
      async (transaction) => {
        const now = new Date();
        const lockedUntil = new Date(now.getTime() + 30_000);
        const inserted = await transaction
          .insert(webhookEvents)
          .values({
            provider: input.provider,
            providerEventId: input.eventId,
            eventType: input.eventType,
            signatureVerifiedAt: new Date(),
            payloadHash: input.payloadHash,
            payload: input.payload,
            occurredAt: new Date(input.occurredAt),
            lockedUntil,
          })
          .onConflictDoNothing()
          .returning({ id: webhookEvents.id });
        if (inserted.length === 1) return "claimed";
        const existing = await transaction.query.webhookEvents.findFirst({
          where: and(
            eq(webhookEvents.provider, input.provider),
            eq(webhookEvents.providerEventId, input.eventId),
          ),
        });
        if (!existing) throw new Error("Webhook deduplication race");
        if (existing.payloadHash !== input.payloadHash)
          throw new Error(
            "Webhook event ID was reused with a different payload",
          );
        if (existing.processedAt) return "duplicate";
        if (existing.lockedUntil > now) return "in_progress";
        const reclaimed = await transaction
          .update(webhookEvents)
          .set({
            lockedUntil,
            attemptCount: existing.attemptCount + 1,
            processingError: null,
          })
          .where(
            and(
              eq(webhookEvents.id, existing.id),
              lt(webhookEvents.lockedUntil, now),
            ),
          )
          .returning({ id: webhookEvents.id });
        return reclaimed.length === 1 ? "claimed" : "in_progress";
      },
    );
  }

  public async markProcessed(provider: string, eventId: string) {
    await withInternalTransaction(
      this.db,
      `webhook-complete:${provider}:${eventId}`,
      async (transaction) => {
        await transaction
          .update(webhookEvents)
          .set({ processedAt: new Date(), processingError: null })
          .where(
            and(
              eq(webhookEvents.provider, provider),
              eq(webhookEvents.providerEventId, eventId),
            ),
          );
      },
    );
  }

  public async markFailed(provider: string, eventId: string, error: string) {
    await withInternalTransaction(
      this.db,
      `webhook-failed:${provider}:${eventId}`,
      async (transaction) => {
        await transaction
          .update(webhookEvents)
          .set({
            lockedUntil: new Date(),
            processingError: error.slice(0, 2_000),
          })
          .where(
            and(
              eq(webhookEvents.provider, provider),
              eq(webhookEvents.providerEventId, eventId),
            ),
          );
      },
    );
  }
}

export class DatabaseRoleSynchronizationSink {
  public constructor(private readonly db: RuntimeDatabase) {}

  public async apply(input: {
    eventId: string;
    action: "upsert" | "delete";
    workosMembershipId: string;
    workosOrganizationId: string;
    workosUserId: string;
    roleSlugs: readonly string[];
    membershipStatus?: string;
    occurredAt: string;
  }) {
    await withInternalTransaction(
      this.db,
      `role-sync:${input.eventId}`,
      async (transaction) => {
        const existingEvent = await transaction.query.roleSyncEvents.findFirst({
          where: eq(roleSyncEvents.workosEventId, input.eventId),
        });
        if (existingEvent?.processedAt) return;

        const organization = await transaction.query.organizations.findFirst({
          where: eq(
            organizations.workosOrganizationId,
            input.workosOrganizationId,
          ),
        });
        const user = await transaction.query.commerceUsers.findFirst({
          where: eq(commerceUsers.workosUserId, input.workosUserId),
        });
        if (!organization || !user)
          throw new Error("WorkOS membership references an unlinked identity");

        const occurredAt = new Date(input.occurredAt);
        const latest = await transaction.query.roleSyncEvents.findFirst({
          where: and(
            eq(roleSyncEvents.organizationId, organization.id),
            eq(roleSyncEvents.userId, user.id),
            isNotNull(roleSyncEvents.processedAt),
          ),
          orderBy: desc(roleSyncEvents.providerOccurredAt),
        });

        await transaction
          .insert(roleSyncEvents)
          .values({
            workosEventId: input.eventId,
            organizationId: organization.id,
            userId: user.id,
            action: input.action,
            payload: input,
            providerOccurredAt: occurredAt,
          })
          .onConflictDoNothing();

        let synchronizationError: string | null = null;
        if (latest && latest.providerOccurredAt >= occurredAt) {
          synchronizationError = "STALE_WORKOS_EVENT_IGNORED";
        } else if (
          input.action === "delete" ||
          (input.membershipStatus && input.membershipStatus !== "active")
        ) {
          await transaction
            .delete(memberships)
            .where(
              and(
                eq(memberships.organizationId, organization.id),
                eq(memberships.userId, user.id),
              ),
            );
        } else {
          const membership = await transaction.query.memberships.findFirst({
            where: and(
              eq(memberships.organizationId, organization.id),
              eq(memberships.userId, user.id),
            ),
          });
          if (!membership) {
            synchronizationError = "AWAITING_COMMERCE_MEMBERSHIP_APPROVAL";
          } else {
            await transaction
              .update(memberships)
              .set({
                workosMembershipId: input.workosMembershipId,
                updatedAt: new Date(),
              })
              .where(eq(memberships.id, membership.id));
          }
        }
        await transaction
          .update(roleSyncEvents)
          .set({ processedAt: new Date(), error: synchronizationError })
          .where(eq(roleSyncEvents.workosEventId, input.eventId));
      },
    );
  }
}
