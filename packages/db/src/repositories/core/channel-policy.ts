import { randomUUID } from "node:crypto";
import { sql, and, eq } from "drizzle-orm";
import type { Actor } from "@clockwork/contracts";
import {
  ChannelPolicyCommandSchema,
  ChannelPolicyRecordSchema,
  applyChannelPolicyCommand,
  channelPolicySnapshot,
  type ChannelPolicyCommand,
  type ChannelPolicyRecord,
} from "@clockwork/domain/core";
import type { RuntimeDatabase } from "../../client";
import { auditEvents, commerceUsers, memberships } from "../../schema";
import { withInternalTransaction } from "../../transaction";

const projection = sql`id,row_version as "rowVersion",status,terms,created_by as "createdBy",last_edited_by as "lastEditedBy",proposed_by as "proposedBy",approved_by as "approvedBy",decision_reason as "decisionReason",approval_evidence as "approvalEvidence",created_at::text as "createdAt",updated_at::text as "updatedAt"`;
export class DatabaseChannelPolicyRepository {
  public constructor(private readonly database: RuntimeDatabase) {}
  public list(): Promise<ChannelPolicyRecord[]> {
    return withInternalTransaction(this.database, randomUUID(), async (tx) => {
      const rows = await tx.execute(
        sql`select ${projection} from core_channel_policy_versions order by (terms->>'version')::integer desc limit 200`,
      );
      return [...rows].map((row) => ChannelPolicyRecordSchema.parse(row));
    });
  }
  public active(now = new Date()) {
    return withInternalTransaction(this.database, randomUUID(), async (tx) => {
      const rows = await tx.execute(
        sql`select ${projection} from core_channel_policy_versions where status='approved' and terms->>'effectiveFrom' <= ${now.toISOString().slice(0, 10)} order by terms->>'effectiveFrom' desc limit 1`,
      );
      return channelPolicySnapshot(
        rows[0] ? ChannelPolicyRecordSchema.parse(rows[0]) : undefined,
      );
    });
  }
  public command(input: {
    command: ChannelPolicyCommand;
    actor: Actor;
    requestId: string;
    now: string;
  }): Promise<ChannelPolicyRecord> {
    const command = ChannelPolicyCommandSchema.parse(input.command);
    if (
      input.actor.kind !== "user" ||
      input.actor.effectiveUserId ||
      input.actor.impersonatedAccountId
    )
      throw new Error("CHANNEL_POLICY_FINANCE_REQUIRED");
    return withInternalTransaction(
      this.database,
      input.requestId,
      async (tx) => {
        const [staff] = await tx
          .select({ id: commerceUsers.id })
          .from(commerceUsers)
          .innerJoin(memberships, eq(memberships.userId, commerceUsers.id))
          .where(
            and(
              eq(commerceUsers.id, input.actor.id),
              eq(commerceUsers.isInternalStaff, true),
              eq(commerceUsers.mfaEnrolled, true),
              eq(memberships.role, "finance_approver"),
            ),
          )
          .limit(1);
        if (!staff) throw new Error("CHANNEL_POLICY_FINANCE_REQUIRED");
        let current: ChannelPolicyRecord | undefined;
        let next: ChannelPolicyRecord;
        if (command.action === "create") {
          next = ChannelPolicyRecordSchema.parse({
            id: randomUUID(),
            rowVersion: 1,
            status: "draft",
            terms: command.terms,
            createdBy: input.actor.id,
            lastEditedBy: input.actor.id,
            proposedBy: null,
            approvedBy: null,
            approvalEvidence: null,
            decisionReason: "",
            createdAt: input.now,
            updatedAt: input.now,
          });
          await tx.execute(
            sql`insert into core_channel_policy_versions(id,terms,created_by,last_edited_by,created_at,updated_at) values(${next.id},${JSON.stringify(next.terms)}::jsonb,${next.createdBy},${next.lastEditedBy},${input.now}::timestamptz,${input.now}::timestamptz)`,
          );
        } else {
          const rows = await tx.execute(
            sql`select ${projection} from core_channel_policy_versions where id=${command.id} for update`,
          );
          if (!rows[0]) throw new Error("CHANNEL_POLICY_NOT_FOUND");
          current = ChannelPolicyRecordSchema.parse(rows[0]);
          next = applyChannelPolicyCommand({
            current,
            command,
            userId: input.actor.id,
            now: input.now,
          });
          await tx.execute(
            sql`update core_channel_policy_versions set terms=${JSON.stringify(next.terms)}::jsonb,status=${next.status},row_version=${next.rowVersion},last_edited_by=${next.lastEditedBy},proposed_by=${next.proposedBy},approved_by=${next.approvedBy},approval_evidence=${next.approvalEvidence},decision_reason=${next.decisionReason},updated_at=${input.now}::timestamptz where id=${next.id}`,
          );
        }
        await tx.insert(auditEvents).values({
          aggregateType: "channel_policy",
          aggregateId: next.id,
          aggregateVersion: next.rowVersion,
          eventType: `channel.policy.${command.action}`,
          eventVersion: 1,
          actor: input.actor,
          occurredAt: new Date(input.now),
          requestId: input.requestId,
          ...(current ? { before: current } : {}),
          after: next,
          metadata: { salesEnabled: false },
        });
        return next;
      },
    );
  }
}
