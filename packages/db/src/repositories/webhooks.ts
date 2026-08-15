import { and, desc, eq, isNotNull, isNull, lt } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { RuntimeDatabase } from "../client";
import {
  commerceUsers,
  memberships,
  organizations,
  roleSyncEvents,
  webhookEvents,
} from "../schema";
import { withInternalTransaction } from "../transaction";

/** Persist only an operator-safe classification; provider messages may contain PII or credentials. */
export function sanitizeWebhookProcessingError(_error: unknown): string {
  return "WEBHOOK_PROCESSING_FAILED";
}

export class DatabaseWebhookDeduplicator {
  public constructor(private readonly db: RuntimeDatabase) {}

  public async claim(input: {
    provider: string;
    eventId: string;
    eventType: string;
    payloadHash: string;
    payload: unknown;
    occurredAt: string;
  }): Promise<
    | { status: "claimed"; claimToken: string }
    | { status: "duplicate" }
    | { status: "in_progress" }
  > {
    return withInternalTransaction(
      this.db,
      `webhook:${input.provider}:${input.eventId}`,
      async (transaction) => {
        const now = new Date();
        const lockedUntil = new Date(now.getTime() + 30_000);
        const claimToken = randomUUID();
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
            lockToken: claimToken,
            lockedUntil,
          })
          .onConflictDoNothing()
          .returning({ id: webhookEvents.id });
        if (inserted.length === 1) return { status: "claimed", claimToken };
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
        if (existing.processedAt) return { status: "duplicate" };
        if (existing.lockedUntil > now) return { status: "in_progress" };
        const reclaimedToken = randomUUID();
        const reclaimed = await transaction
          .update(webhookEvents)
          .set({
            lockedUntil,
            lockToken: reclaimedToken,
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
        return reclaimed.length === 1
          ? { status: "claimed", claimToken: reclaimedToken }
          : { status: "in_progress" };
      },
    );
  }

  public async markProcessed(
    provider: string,
    eventId: string,
    claimToken: string,
  ) {
    await withInternalTransaction(
      this.db,
      `webhook-complete:${provider}:${eventId}`,
      async (transaction) => {
        const completed = await transaction
          .update(webhookEvents)
          .set({ processedAt: new Date(), processingError: null })
          .where(
            and(
              eq(webhookEvents.provider, provider),
              eq(webhookEvents.providerEventId, eventId),
              eq(webhookEvents.lockToken, claimToken),
              isNull(webhookEvents.processedAt),
            ),
          )
          .returning({ id: webhookEvents.id });
        if (completed.length !== 1)
          throw new Error("STALE_WEBHOOK_CLAIM_COMPLETION");
      },
    );
  }

  public async markFailed(
    provider: string,
    eventId: string,
    claimToken: string,
    error: unknown,
  ) {
    await withInternalTransaction(
      this.db,
      `webhook-failed:${provider}:${eventId}`,
      async (transaction) => {
        const failed = await transaction
          .update(webhookEvents)
          .set({
            lockedUntil: new Date(),
            processingError: sanitizeWebhookProcessingError(error),
          })
          .where(
            and(
              eq(webhookEvents.provider, provider),
              eq(webhookEvents.providerEventId, eventId),
              eq(webhookEvents.lockToken, claimToken),
              isNull(webhookEvents.processedAt),
            ),
          )
          .returning({ id: webhookEvents.id });
        if (failed.length !== 1) throw new Error("STALE_WEBHOOK_CLAIM_FAILURE");
      },
    );
  }
}

/**
 * The complete set of reasons `DatabaseRoleSynchronizationSink.apply` records
 * on `role_sync_events.error`.
 *
 * Both are terminal for the delivery: redelivering the same WorkOS event cannot
 * change either outcome, so the event is acknowledged rather than retried, and
 * the reason is left on the row for `listUnresolvedRoleSynchronizations` to
 * surface.
 *
 * - `STALE_WORKOS_EVENT_IGNORED` -- a later event for the same organization and
 *   user was already processed. Informational; nothing is owed.
 * - `AWAITING_COMMERCE_MEMBERSHIP_APPROVAL` -- the identity and organization are
 *   linked but no commerce membership joins them, so there is no row to carry
 *   the WorkOS membership id. Per ADR 0004 this is the expected ordering, not a
 *   fault: WorkOS can create a membership before commerce approves one. It is
 *   the actionable reason -- an operator either approves the membership in
 *   commerce or the WorkOS membership stays unlinked.
 *
 * Neither is raised to the caller. Raising `AWAITING_COMMERCE_MEMBERSHIP_APPROVAL`
 * would make the route return a retryable non-2xx for a state that no retry can
 * clear, so WorkOS would redeliver until it disabled the endpoint and took the
 * whole webhook down with it.
 */
export const roleSynchronizationReasons = [
  "STALE_WORKOS_EVENT_IGNORED",
  "AWAITING_COMMERCE_MEMBERSHIP_APPROVAL",
] as const;

export type RoleSynchronizationReason =
  (typeof roleSynchronizationReasons)[number];

export interface UnresolvedRoleSynchronization {
  workosEventId: string;
  organizationId: string | null;
  userId: string | null;
  action: string;
  reason: string;
  providerOccurredAt: Date;
  processedAt: Date | null;
  createdAt: Date;
}

/**
 * Operator read surface for the reasons `apply` records.
 *
 * `role_sync_events.error` is written on every event the sink acknowledged
 * without linking anything, and before this function existed it was read by
 * nothing in the tree: a WorkOS membership that commerce never approved was
 * recorded durably and invisible at the same time. Returns every event carrying
 * a reason, newest first; the caller distinguishes the actionable
 * `AWAITING_COMMERCE_MEMBERSHIP_APPROVAL` from the informational
 * `STALE_WORKOS_EVENT_IGNORED` by `reason`.
 */
export async function listUnresolvedRoleSynchronizations(
  db: RuntimeDatabase,
  input: { requestId: string; limit?: number },
): Promise<readonly UnresolvedRoleSynchronization[]> {
  const rows = await withInternalTransaction(
    db,
    input.requestId,
    (transaction) =>
      transaction.query.roleSyncEvents.findMany({
        where: isNotNull(roleSyncEvents.error),
        orderBy: desc(roleSyncEvents.createdAt),
        limit: input.limit ?? 100,
      }),
  );
  return rows.map((row) => ({
    workosEventId: row.workosEventId,
    organizationId: row.organizationId,
    userId: row.userId,
    action: row.action,
    reason: row.error ?? "",
    providerOccurredAt: row.providerOccurredAt,
    processedAt: row.processedAt,
    createdAt: row.createdAt,
  }));
}

export class DatabaseRoleSynchronizationSink {
  public constructor(private readonly db: RuntimeDatabase) {}

  /**
   * Links or revokes the WorkOS identity record on an existing commerce
   * membership. `input.roleSlugs` is deliberately NOT written to
   * `memberships.role`; it is kept only in the event payload for audit.
   *
   * ADR 0004 (Accepted, 2026-07-31) states the contract twice: "WorkOS role
   * webhooks synchronize identifiers into commerce; they do not grant access
   * without a matching commerce membership" and "WorkOS role slugs never grant
   * commerce roles: membership webhooks link or revoke identity records, while
   * commerce approval remains authoritative."
   *
   * Writing the slug here would be a privilege escalation, not a bug fix.
   * `resolveWorkosIdentity` (./identity.ts) selects `memberships.role` straight
   * into the session identity used by apps/web/src/auth/session.ts and
   * apps/web/app/auth/callback/route.ts, so a WorkOS-side actor who controls an
   * organization's role slugs would set the commerce role directly:
   * `evaluateMembershipPolicy` (@clockwork/domain) would never run, and its
   * COMMERCE_APPROVAL_REQUIRED, STAFF_BOUNDARY and MFA_POLICY_REQUIRED refusals
   * would all be bypassed. See webhooks.test.ts, which pins this.
   */
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

        let synchronizationError: RoleSynchronizationReason | null = null;
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
            // Identifier only. `role` is owned by commerce approval -- ADR 0004.
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
