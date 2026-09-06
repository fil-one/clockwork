import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Actor } from "@clockwork/contracts";
import { sanitizeActivationEvidenceReference } from "@clockwork/domain/system";
import type { RuntimeDatabase } from "../../client";
import {
  approvals,
  commerceUsers,
  memberships,
  priceBooks,
  rateCards,
} from "../../schema";
import { providerResourceBindings } from "../../schema/system/providers";
import { priceBookSchedules } from "../../schema/core/price-book-schedules";
import { withInternalTransaction } from "../../transaction";
import { appendAuditAndOutbox } from "../audit-outbox";

export const CatalogMappingSchema = z
  .object({
    rateCardId: z.uuid(),
    expectedRowVersion: z.number().int().positive(),
    providerSku: z.string().trim().min(1).max(120),
    providerRegion: z.string().trim().min(1).max(120),
    meterId: z.string().trim().min(1).max(160),
    sourceEvidence: z
      .string()
      .trim()
      .min(1)
      .max(1000)
      .transform((value, context) => {
        try {
          return sanitizeActivationEvidenceReference(value);
        } catch {
          context.addIssue({
            code: "custom",
            message: "Use a safe absolute source evidence URI",
          });
          return z.NEVER;
        }
      }),
    reason: z.string().trim().min(8).max(2000),
  })
  .strict();

/** Draft configuration only. Provider claims remain attestations until the real boundary is qualified. */
export class DatabaseCatalogAdmin {
  public constructor(private readonly db: RuntimeDatabase) {}

  public list(requestId: string) {
    return withInternalTransaction(this.db, requestId, async (tx) => {
      const rows = await tx
        .select({
          rateCardId: rateCards.id,
          sku: rateCards.sku,
          region: rateCards.region,
          unit: rateCards.unit,
          approvedClaim: rateCards.approvedClaim,
          bookName: priceBooks.name,
          bookId: priceBooks.id,
          bookVersion: priceBooks.version,
          rowVersion: priceBooks.rowVersion,
          status: priceBooks.status,
          binding: providerResourceBindings.binding,
        })
        .from(rateCards)
        .innerJoin(priceBooks, eq(priceBooks.id, rateCards.priceBookId))
        .leftJoin(
          providerResourceBindings,
          and(
            eq(providerResourceBindings.aggregateId, rateCards.id),
            eq(providerResourceBindings.aggregateType, "rate_card"),
            eq(providerResourceBindings.provider, "fil_one"),
            eq(providerResourceBindings.providerResourceType, "sku_region"),
          ),
        )
        .orderBy(
          asc(priceBooks.name),
          asc(priceBooks.version),
          asc(rateCards.sku),
          asc(rateCards.region),
        );
      const pending = await tx
        .select({ id: approvals.objectId })
        .from(approvals)
        .where(
          and(
            eq(approvals.action, "price_book_activation"),
            eq(approvals.status, "pending"),
          ),
        );
      const scheduled = await tx
        .select({ id: priceBookSchedules.priceBookId })
        .from(priceBookSchedules)
        .where(eq(priceBookSchedules.status, "approved"));
      return rows.map(({ binding, ...row }) => {
        const mapping = CatalogMappingSchema.omit({
          rateCardId: true,
          expectedRowVersion: true,
          reason: true,
        }).safeParse(binding);
        return {
          ...row,
          mapping: mapping.success ? mapping.data : null,
          editable:
            row.status === "draft" &&
            !pending.some((item) => item.id === row.bookId) &&
            !scheduled.some((item) => item.id === row.bookId),
        };
      });
    });
  }

  public save(input: {
    command: z.input<typeof CatalogMappingSchema>;
    actor: Actor;
    requestId: string;
  }) {
    const command = CatalogMappingSchema.parse(input.command);
    return withInternalTransaction(this.db, input.requestId, async (tx) => {
      if (
        input.actor.kind !== "user" ||
        input.actor.effectiveUserId ||
        input.actor.impersonatedAccountId
      )
        throw new Error("CATALOG_AUTHORITY_REQUIRED");
      const [staff] = await tx
        .select({ id: commerceUsers.id })
        .from(commerceUsers)
        .innerJoin(memberships, eq(memberships.userId, commerceUsers.id))
        .where(
          and(
            eq(commerceUsers.id, input.actor.id),
            eq(commerceUsers.isInternalStaff, true),
            eq(commerceUsers.mfaEnrolled, true),
            inArray(memberships.role, [
              "internal_operator",
              "finance_approver",
            ]),
          ),
        )
        .limit(1);
      if (!staff) throw new Error("CATALOG_AUTHORITY_REQUIRED");
      const [rate] = await tx
        .select()
        .from(rateCards)
        .where(eq(rateCards.id, command.rateCardId));
      if (!rate) throw new Error("CATALOG_RATE_NOT_FOUND");
      const [book] = await tx
        .select()
        .from(priceBooks)
        .where(eq(priceBooks.id, rate.priceBookId))
        .for("update");
      if (!book || book.rowVersion !== command.expectedRowVersion)
        throw new Error("CATALOG_VERSION_CONFLICT");
      const [pending] = await tx
        .select({ id: approvals.id })
        .from(approvals)
        .where(
          and(
            eq(approvals.objectId, book.id),
            eq(approvals.action, "price_book_activation"),
            eq(approvals.status, "pending"),
          ),
        )
        .limit(1);
      const scheduled = await tx.query.priceBookSchedules.findFirst({
        where: and(
          eq(priceBookSchedules.priceBookId, book.id),
          eq(priceBookSchedules.status, "approved"),
        ),
      });
      if (book.status !== "draft" || pending || scheduled)
        throw new Error("CATALOG_DRAFT_FROZEN");
      const [before] = await tx
        .select()
        .from(providerResourceBindings)
        .where(
          and(
            eq(providerResourceBindings.aggregateId, rate.id),
            eq(providerResourceBindings.aggregateType, "rate_card"),
            eq(providerResourceBindings.provider, "fil_one"),
            eq(providerResourceBindings.providerResourceType, "sku_region"),
          ),
        );
      const binding = {
        providerSku: command.providerSku,
        providerRegion: command.providerRegion,
        meterId: command.meterId,
        sourceEvidence: command.sourceEvidence,
      };
      if (before)
        await tx
          .update(providerResourceBindings)
          .set({ binding })
          .where(eq(providerResourceBindings.id, before.id));
      else
        await tx.insert(providerResourceBindings).values({
          provider: "fil_one",
          providerResourceType: "sku_region",
          providerResourceId: `rate-card:${rate.id}`,
          aggregateType: "rate_card",
          aggregateId: rate.id,
          binding,
        });
      await tx
        .update(priceBooks)
        .set({ rowVersion: book.rowVersion + 1, updatedAt: new Date() })
        .where(eq(priceBooks.id, book.id));
      await appendAuditAndOutbox(tx, {
        aggregateType: "price_book",
        aggregateId: book.id,
        aggregateVersion: book.rowVersion + 1,
        eventType: "core.catalog.mapping_updated",
        actor: input.actor,
        requestId: input.requestId,
        before: { rateCardId: rate.id, mapping: before?.binding ?? null },
        after: { rateCardId: rate.id, mapping: binding },
        metadata: { reason: command.reason },
      });
    });
  }
}
