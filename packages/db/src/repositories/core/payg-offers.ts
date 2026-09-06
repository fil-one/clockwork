import { randomUUID } from "node:crypto";
import type { Actor } from "@clockwork/contracts";
import {
  applyPaygOfferCommand,
  PaygOfferCommandSchema,
  PaygOfferRecordSchema,
  type PaygOfferCommand,
  type PaygOfferRecord,
} from "@clockwork/domain/core";
import { and, desc, eq } from "drizzle-orm";

import type { RuntimeDatabase } from "../../client";
import { auditEvents, commerceUsers, memberships } from "../../schema";
import { paygOfferVersions } from "../../schema/core/payg-offers";
import { withInternalTransaction } from "../../transaction";

function mapRow(row: typeof paygOfferVersions.$inferSelect): PaygOfferRecord {
  const record = { ...row };
  Reflect.deleteProperty(record, "sku");
  Reflect.deleteProperty(record, "region");
  Reflect.deleteProperty(record, "version");
  return PaygOfferRecordSchema.parse({
    ...record,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

/** Service pool only; all writers re-check the persisted internal finance role. */
export class DatabasePaygOfferRepository {
  public constructor(private readonly database: RuntimeDatabase) {}

  public list(): Promise<PaygOfferRecord[]> {
    return withInternalTransaction(
      this.database,
      `payg-offers:${randomUUID()}`,
      async (transaction) => {
        const rows = await transaction
          .select()
          .from(paygOfferVersions)
          .orderBy(desc(paygOfferVersions.updatedAt))
          .limit(200);
        return rows.map(mapRow);
      },
    );
  }

  public command(input: {
    command: PaygOfferCommand;
    actor: Actor;
    requestId: string;
    now: string;
  }): Promise<PaygOfferRecord> {
    const command = PaygOfferCommandSchema.parse(input.command);
    if (
      input.actor.kind !== "user" ||
      input.actor.effectiveUserId ||
      input.actor.impersonatedAccountId
    )
      return Promise.reject(new Error("PAYG_OFFER_STAFF_ACTOR_REQUIRED"));
    return withInternalTransaction(
      this.database,
      input.requestId,
      async (transaction) => {
        const [user] = await transaction
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
        if (!user) throw new Error("PAYG_OFFER_FINANCE_AUTHORITY_REQUIRED");
        let current: PaygOfferRecord | undefined;
        let next: PaygOfferRecord;
        if (command.action === "create") {
          if (Date.parse(command.terms.sourceCheckedAt) > Date.parse(input.now))
            throw new Error("PAYG_OFFER_SOURCE_CHECKED_IN_FUTURE");
          next = PaygOfferRecordSchema.parse({
            id: randomUUID(),
            rowVersion: 1,
            status: "draft",
            terms: command.terms,
            createdBy: input.actor.id,
            lastEditedBy: input.actor.id,
            proposedBy: null,
            approvedBy: null,
            approvalEvidenceId: null,
            decisionReason: "",
            createdAt: input.now,
            updatedAt: input.now,
          });
          await transaction.insert(paygOfferVersions).values({
            ...next,
            terms: next.terms,
            sku: next.terms.sku,
            region: next.terms.region,
            version: next.terms.version,
            createdAt: new Date(next.createdAt),
            updatedAt: new Date(next.updatedAt),
          });
        } else {
          const [row] = await transaction
            .select()
            .from(paygOfferVersions)
            .where(eq(paygOfferVersions.id, command.id))
            .for("update");
          if (!row) throw new Error("PAYG_OFFER_NOT_FOUND");
          current = mapRow(row);
          next = applyPaygOfferCommand({
            current,
            command,
            userId: input.actor.id,
            now: input.now,
          });
          await transaction
            .update(paygOfferVersions)
            .set({
              terms: next.terms,
              sku: next.terms.sku,
              region: next.terms.region,
              version: next.terms.version,
              status: next.status,
              lastEditedBy: next.lastEditedBy,
              proposedBy: next.proposedBy,
              approvedBy: next.approvedBy,
              approvalEvidenceId: next.approvalEvidenceId,
              decisionReason: next.decisionReason,
              updatedAt: new Date(input.now),
              rowVersion: next.rowVersion,
            })
            .where(eq(paygOfferVersions.id, next.id));
        }
        // No dispatch effect: approval is not activation or a provider write.
        await transaction.insert(auditEvents).values({
          aggregateType: "payg_offer_version",
          aggregateId: next.id,
          aggregateVersion: next.rowVersion,
          eventType: `payg.offer.${command.action}`,
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
