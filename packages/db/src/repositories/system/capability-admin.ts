import { and, asc, eq } from "drizzle-orm";
import { uuidV7, type Actor } from "@clockwork/contracts";
import { sanitizeActivationEvidenceReference } from "@clockwork/domain/system";

import type { RuntimeDatabase, RuntimeTransaction } from "../../client";
import { commerceUsers, memberships } from "../../schema";
import {
  systemCapabilities,
  systemCapabilityRequests,
} from "../../schema/system";
import { withInternalTransaction } from "../../transaction";
import { appendAuditAndOutbox } from "../audit-outbox";
import { systemCapabilityKeys, type SystemCapabilityKey } from "./capabilities";
import {
  assertCapabilityDecision,
  capabilityApprovalRole,
} from "./capability-policy";

interface ControlInput {
  capabilityKey: SystemCapabilityKey;
  expectedRowVersion: number;
  reason: string;
  actor: Actor;
  requestId: string;
  now: Date;
}

async function requireAuthority(
  tx: RuntimeTransaction,
  actor: Actor,
  role: string,
) {
  if (
    actor.kind !== "user" ||
    actor.effectiveUserId ||
    actor.impersonatedAccountId
  )
    throw new Error("CAPABILITY_STAFF_REQUIRED");
  const [staff] = await tx
    .select({ id: commerceUsers.id })
    .from(commerceUsers)
    .innerJoin(memberships, eq(memberships.userId, commerceUsers.id))
    .where(
      and(
        eq(commerceUsers.id, actor.id),
        eq(commerceUsers.isInternalStaff, true),
        eq(commerceUsers.mfaEnrolled, true),
        eq(memberships.role, role),
      ),
    )
    .limit(1);
  if (!staff) throw new Error("CAPABILITY_AUTHORITY_REQUIRED");
}

function validateInput(input: ControlInput) {
  if (!systemCapabilityKeys.includes(input.capabilityKey))
    throw new Error("CAPABILITY_KEY_INVALID");
  if (input.reason.trim().length < 8 || input.reason.length > 2000)
    throw new Error("CAPABILITY_REASON_REQUIRED");
  if (
    !Number.isSafeInteger(input.expectedRowVersion) ||
    input.expectedRowVersion < 1
  )
    throw new Error("CAPABILITY_VERSION_CONFLICT");
}

/** Control plane never substitutes for the external gates checked at execution. */
export class DatabaseSystemCapabilityAdmin {
  public constructor(private readonly db: RuntimeDatabase) {}

  public list(input: { requestId: string }) {
    return withInternalTransaction(this.db, input.requestId, async (tx) => {
      const capabilities = await tx
        .select()
        .from(systemCapabilities)
        .orderBy(asc(systemCapabilities.capabilityKey));
      const pending = await tx
        .select()
        .from(systemCapabilityRequests)
        .where(eq(systemCapabilityRequests.status, "pending"));
      return capabilities.map((row) => ({
        ...row,
        pending:
          pending.find(
            (request) => request.capabilityKey === row.capabilityKey,
          ) ?? null,
      }));
    });
  }

  public propose(
    input: ControlInput & {
      enableRecovery: boolean;
      evidenceReference: string;
    },
  ) {
    validateInput(input);
    const evidenceReference = sanitizeActivationEvidenceReference(
      input.evidenceReference,
    );
    return withInternalTransaction(this.db, input.requestId, async (tx) => {
      await requireAuthority(tx, input.actor, "internal_operator");
      const [before] = await tx
        .select()
        .from(systemCapabilities)
        .where(eq(systemCapabilities.capabilityKey, input.capabilityKey))
        .for("update");
      if (!before || before.rowVersion !== input.expectedRowVersion)
        throw new Error("CAPABILITY_VERSION_CONFLICT");
      if (input.enableRecovery ? before.recoveryEnabled : before.enabled)
        throw new Error("CAPABILITY_ALREADY_ENABLED");
      const [existing] = await tx
        .select()
        .from(systemCapabilityRequests)
        .where(
          and(
            eq(systemCapabilityRequests.capabilityKey, input.capabilityKey),
            eq(systemCapabilityRequests.status, "pending"),
          ),
        );
      if (existing) throw new Error("CAPABILITY_REQUEST_PENDING");
      const [request] = await tx
        .insert(systemCapabilityRequests)
        .values({
          capabilityKey: input.capabilityKey,
          baseVersion: before.rowVersion,
          enableRecovery: input.enableRecovery,
          requestedBy: input.actor.id,
          requestedAt: input.now,
          reason: input.reason.trim(),
          evidenceReference,
        })
        .returning();
      if (!request) throw new Error("CAPABILITY_REQUEST_FAILED");
      await appendAuditAndOutbox(tx, {
        aggregateType: "system_capability",
        aggregateId: request.id,
        aggregateVersion: 1,
        eventType: "system.capability.activation_proposed",
        actor: input.actor,
        requestId: input.requestId,
        occurredAt: input.now,
        before: { ...before },
        after: { ...request },
      });
      return request;
    });
  }

  public decide(
    input: ControlInput & { proposalId: string; approve: boolean },
  ) {
    validateInput(input);
    return withInternalTransaction(this.db, input.requestId, async (tx) => {
      await requireAuthority(
        tx,
        input.actor,
        capabilityApprovalRole(input.capabilityKey),
      );
      const [before] = await tx
        .select()
        .from(systemCapabilities)
        .where(eq(systemCapabilities.capabilityKey, input.capabilityKey))
        .for("update");
      if (!before || before.rowVersion !== input.expectedRowVersion)
        throw new Error("CAPABILITY_VERSION_CONFLICT");
      const [request] = await tx
        .select()
        .from(systemCapabilityRequests)
        .where(
          and(
            eq(systemCapabilityRequests.id, input.proposalId),
            eq(systemCapabilityRequests.capabilityKey, input.capabilityKey),
            eq(systemCapabilityRequests.status, "pending"),
          ),
        );
      if (!request) throw new Error("CAPABILITY_REQUEST_NOT_PENDING");
      if (input.approve) {
        assertCapabilityDecision({
          requestedBy: request.requestedBy,
          actorId: input.actor.id,
          requestedAt: request.requestedAt,
          now: input.now,
          baseVersion: request.baseVersion,
          currentVersion: before.rowVersion,
        });
        // Requester may have lost their staff membership since proposing.
        await requireAuthority(
          tx,
          { kind: "user", id: request.requestedBy },
          "internal_operator",
        );
        await tx
          .update(systemCapabilities)
          .set({
            ...(request.enableRecovery
              ? { recoveryEnabled: true }
              : { enabled: true }),
            changedBy: input.actor.id,
            changeReason: input.reason.trim(),
          })
          .where(eq(systemCapabilities.capabilityKey, input.capabilityKey));
      }
      await tx
        .update(systemCapabilityRequests)
        .set({
          status: input.approve ? "approved" : "rejected",
          decidedBy: input.actor.id,
          decidedAt: input.now,
          decisionReason: input.reason.trim(),
        })
        .where(eq(systemCapabilityRequests.id, request.id));
      await appendAuditAndOutbox(tx, {
        aggregateType: "system_capability",
        aggregateId: request.id,
        aggregateVersion: 2,
        eventType: input.approve
          ? "system.capability.activation_approved"
          : "system.capability.activation_rejected",
        actor: input.actor,
        requestId: input.requestId,
        occurredAt: input.now,
        before: { ...before },
        after: {
          capabilityKey: input.capabilityKey,
          enabled:
            input.approve && !request.enableRecovery ? true : before.enabled,
          recoveryEnabled:
            input.approve && request.enableRecovery
              ? true
              : before.recoveryEnabled,
          proposalId: request.id,
          requestedBy: request.requestedBy,
          reason: input.reason.trim(),
          evidenceReference: request.evidenceReference,
        },
      });
    });
  }

  public disable(input: ControlInput & { disableRecovery: boolean }) {
    validateInput(input);
    return withInternalTransaction(this.db, input.requestId, async (tx) => {
      await requireAuthority(tx, input.actor, "internal_operator");
      const [before] = await tx
        .select()
        .from(systemCapabilities)
        .where(eq(systemCapabilities.capabilityKey, input.capabilityKey))
        .for("update");
      if (!before || before.rowVersion !== input.expectedRowVersion)
        throw new Error("CAPABILITY_VERSION_CONFLICT");
      const [after] = await tx
        .update(systemCapabilities)
        .set({
          ...(input.disableRecovery
            ? { recoveryEnabled: false }
            : { enabled: false }),
          changedBy: input.actor.id,
          changeReason: input.reason.trim(),
        })
        .where(eq(systemCapabilities.capabilityKey, input.capabilityKey))
        .returning();
      // Invalidates every earlier proposal so a delayed approval cannot undo a kill switch.
      await tx
        .update(systemCapabilityRequests)
        .set({
          status: "canceled",
          decidedBy: input.actor.id,
          decidedAt: input.now,
          decisionReason: input.reason.trim(),
        })
        .where(
          and(
            eq(systemCapabilityRequests.capabilityKey, input.capabilityKey),
            eq(systemCapabilityRequests.status, "pending"),
          ),
        );
      await appendAuditAndOutbox(tx, {
        aggregateType: "system_capability",
        aggregateId: uuidV7(),
        aggregateVersion: 1,
        eventType: "system.capability.disabled",
        actor: input.actor,
        requestId: input.requestId,
        occurredAt: input.now,
        before: { ...before },
        after: { ...after },
      });
    });
  }
}
