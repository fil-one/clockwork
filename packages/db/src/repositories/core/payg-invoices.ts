import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { Actor } from "@clockwork/contracts";
import {
  paygEvidenceHash,
  validatePaygPolicy,
  type PaygRating,
} from "@clockwork/domain/core";
import type { RuntimeDatabase, RuntimeTransaction } from "../../client";
import {
  accounts,
  commerceUsers,
  creditNotes,
  invoices,
  memberships,
} from "../../schema";
import {
  paygCreditSources,
  paygEnrollments,
  paygInvoiceSources,
  paygPendingInvoiceEffects,
  paygPeriodRevisions,
} from "../../schema/core/payg-billing";
import { legalEntities } from "../../schema/core/tax";
import { withInternalTransaction } from "../../transaction";
import { appendAuditAndOutbox } from "../audit-outbox";
import { canonicalTaxHash, determineTaxForSubject } from "./tax-determination";

interface Effect {
  idempotencyKey: string;
  kind: "invoice" | "debit_adjustment" | "credit_adjustment";
  enrollmentId: string;
  accountId: string;
  month: string;
  revision: number;
  amount: { currency: string; minor: string };
  ratingEvidenceHash: string;
}

async function requireFinance(
  tx: RuntimeTransaction,
  actor: Actor,
): Promise<void> {
  if (
    actor.kind !== "user" ||
    actor.effectiveUserId ||
    actor.impersonatedAccountId
  )
    throw new Error("PAYG_FINANCE_ACTOR_REQUIRED");
  const [user] = await tx
    .select({ id: commerceUsers.id })
    .from(commerceUsers)
    .innerJoin(memberships, eq(memberships.userId, commerceUsers.id))
    .where(
      and(
        eq(commerceUsers.id, actor.id),
        eq(commerceUsers.isInternalStaff, true),
        eq(commerceUsers.mfaEnrolled, true),
        eq(memberships.role, "finance_approver"),
      ),
    )
    .limit(1);
  if (!user) throw new Error("PAYG_FINANCE_AUTHORITY_REQUIRED");
}

/** Converts retained rating deltas into the shared invoice/audit/outbox ledger. */
export class DatabasePaygInvoiceRepository {
  public constructor(private readonly database: RuntimeDatabase) {}

  public listPending() {
    return withInternalTransaction(this.database, randomUUID(), async (tx) => {
      const rows = await tx
        .select({ payload: paygPendingInvoiceEffects.payload })
        .from(paygPendingInvoiceEffects)
        .leftJoin(
          paygInvoiceSources,
          eq(
            paygInvoiceSources.effectKey,
            paygPendingInvoiceEffects.idempotencyKey,
          ),
        )
        .where(
          and(
            isNull(paygInvoiceSources.invoiceId),
            sql`not exists (select 1 from core_payg_credit_sources credit where credit.effect_key = ${paygPendingInvoiceEffects.idempotencyKey})`,
          ),
        )
        .orderBy(asc(paygPendingInvoiceEffects.createdAt))
        .limit(200);
      return rows.map((row) => row.payload as Effect);
    });
  }

  private async materializeCredit(
    tx: RuntimeTransaction,
    effect: Effect,
    input: { actor: Actor; requestId: string; now: string },
  ) {
    // All corrections for one enrollment serialize, including credits against
    // several prior debit invoices. Each allocation uses cumulative tax rounding.
    await tx
      .select()
      .from(paygEnrollments)
      .where(eq(paygEnrollments.id, effect.enrollmentId))
      .for("update");
    const existing = await tx
      .select()
      .from(paygCreditSources)
      .where(eq(paygCreditSources.effectKey, effect.idempotencyKey))
      .orderBy(asc(paygCreditSources.allocationIndex));
    const [firstExisting] = existing;
    if (firstExisting)
      return {
        invoiceId: firstExisting.invoiceId,
        creditNoteIds: existing.map((row) => row.creditNoteId),
        replay: true,
      };
    const candidates = await tx
      .select({ invoice: invoices, source: paygInvoiceSources })
      .from(paygInvoiceSources)
      .innerJoin(invoices, eq(invoices.id, paygInvoiceSources.invoiceId))
      .where(eq(paygInvoiceSources.enrollmentId, effect.enrollmentId))
      .orderBy(desc(paygInvoiceSources.createdAt), desc(invoices.id));
    let remaining = BigInt(effect.amount.minor);
    const creditNoteIds: string[] = [];
    let firstInvoiceId: string | undefined;
    candidates.sort(
      (left, right) =>
        (right.source.sourceSnapshot as { effect: Effect }).effect.revision -
        (left.source.sourceSnapshot as { effect: Effect }).effect.revision,
    );
    for (const candidate of candidates) {
      const { invoice, source } = candidate;
      const original = source.sourceSnapshot as { effect: Effect };
      if (
        original.effect.month !== effect.month ||
        original.effect.revision >= effect.revision ||
        invoice.status === "void"
      )
        continue;
      if (
        !invoice.stripeInvoiceId ||
        !["open", "paid"].includes(invoice.status)
      )
        throw new Error("PAYG_CREDIT_ORIGINAL_INVOICE_NOT_ISSUED");
      await tx
        .select()
        .from(invoices)
        .where(eq(invoices.id, invoice.id))
        .for("update");
      const prior = await tx
        .select()
        .from(paygCreditSources)
        .where(eq(paygCreditSources.invoiceId, invoice.id));
      const priorNet = prior.reduce((sum, row) => sum + row.netMinor, 0n);
      const priorTax = prior.reduce((sum, row) => sum + row.taxMinor, 0n);
      const originalNet = invoice.amountMinor - invoice.taxMinor;
      const available = originalNet - priorNet;
      if (available <= 0n) continue;
      const net = remaining < available ? remaining : available;
      const tax =
        ((priorNet + net) * invoice.taxMinor * 2n + originalNet) /
          (2n * originalNet) -
        priorTax;
      const creditNoteId = randomUUID();
      const sourceSnapshot = {
        effect,
        invoiceSourceHash: source.sourceHash,
        netMinor: net.toString(),
        taxMinor: tax.toString(),
        amountMinor: (net + tax).toString(),
      };
      await tx.insert(creditNotes).values({
        id: creditNoteId,
        invoiceId: invoice.id,
        orderId: null,
        currency: invoice.currency,
        amountMinor: net + tax,
        reasonCode: "payg_usage_correction",
        approvedBy: input.actor.id,
        status: "approved",
        createdAt: new Date(input.now),
      });
      await tx.insert(paygCreditSources).values({
        creditNoteId,
        effectKey: effect.idempotencyKey,
        invoiceId: invoice.id,
        allocationIndex: creditNoteIds.length + 1,
        netMinor: net,
        taxMinor: tax,
        amountMinor: net + tax,
        sourceSnapshot,
        sourceHash: canonicalTaxHash(sourceSnapshot),
        createdAt: new Date(input.now),
      });
      await tx.execute(
        sql`select public.core_create_stripe_adjustment_operation(${creditNoteId}::uuid, 'credit_note'::text, 'order_change'::text, 'payg_usage_correction'::text)`,
      );
      await appendAuditAndOutbox(tx, {
        accountId: effect.accountId,
        aggregateType: "credit_note",
        aggregateId: creditNoteId,
        aggregateVersion: 1,
        eventType: "core.credit_notes.issue",
        actor: input.actor,
        requestId: input.requestId,
        after: {
          id: creditNoteId,
          invoiceId: invoice.id,
          accountId: effect.accountId,
          amount: { currency: invoice.currency, minor: (net + tax).toString() },
          status: "approved",
        },
        occurredAt: new Date(input.now),
      });
      creditNoteIds.push(creditNoteId);
      firstInvoiceId ??= invoice.id;
      remaining -= net;
      if (remaining === 0n) break;
    }
    if (remaining !== 0n || !firstInvoiceId)
      throw new Error("PAYG_CREDIT_INVOICE_BALANCE_INSUFFICIENT");
    return { invoiceId: firstInvoiceId, creditNoteIds, replay: false };
  }

  public materialize(input: {
    effectKey: string;
    actor: Actor;
    requestId: string;
    now: string;
  }) {
    return withInternalTransaction(
      this.database,
      input.requestId,
      async (tx) => {
        await requireFinance(tx, input.actor);
        const [identity] = await tx
          .select({ enrollmentId: paygPendingInvoiceEffects.enrollmentId })
          .from(paygPendingInvoiceEffects)
          .where(eq(paygPendingInvoiceEffects.idempotencyKey, input.effectKey));
        if (!identity) throw new Error("PAYG_EFFECT_NOT_FOUND");
        await tx
          .select()
          .from(paygEnrollments)
          .where(eq(paygEnrollments.id, identity.enrollmentId))
          .for("update");
        const [retained] = await tx
          .select()
          .from(paygPendingInvoiceEffects)
          .where(eq(paygPendingInvoiceEffects.idempotencyKey, input.effectKey))
          .for("update");
        if (!retained) throw new Error("PAYG_EFFECT_NOT_FOUND");
        const effect = retained.payload as Effect;
        const [existing] = await tx
          .select()
          .from(invoices)
          .where(eq(invoices.paygEffectKey, input.effectKey));
        if (existing) return { invoiceId: existing.id, replay: true };
        if (effect.kind === "credit_adjustment")
          return this.materializeCredit(tx, effect, input);
        const [enrollment] = await tx
          .select()
          .from(paygEnrollments)
          .where(eq(paygEnrollments.id, retained.enrollmentId))
          .for("share");
        const [revision] = await tx
          .select()
          .from(paygPeriodRevisions)
          .where(
            and(
              eq(paygPeriodRevisions.enrollmentId, retained.enrollmentId),
              eq(paygPeriodRevisions.month, effect.month),
              eq(paygPeriodRevisions.revision, effect.revision),
            ),
          );
        if (!enrollment || !revision)
          throw new Error("PAYG_EFFECT_SOURCE_MISSING");
        const snapshot = enrollment.snapshot as {
          supplierLegalEntityId?: string;
          stripeCustomerId?: string;
          billingAuthority: string;
          cutoverEvidenceId?: string;
          policy: PaygRating["policy"];
        };
        const rating = (revision.snapshot as { rating: PaygRating }).rating;
        validatePaygPolicy(snapshot.policy);
        if (
          snapshot.billingAuthority !== "clockwork" ||
          !snapshot.cutoverEvidenceId ||
          !snapshot.supplierLegalEntityId ||
          !snapshot.stripeCustomerId ||
          effect.ratingEvidenceHash !== rating.evidenceHash ||
          paygEvidenceHash(snapshot.policy) !==
            paygEvidenceHash(rating.policy) ||
          BigInt(effect.amount.minor) <= 0n
        )
          throw new Error("PAYG_INVOICE_SOURCE_INVALID");
        const [supplier] = await tx
          .select()
          .from(legalEntities)
          .where(eq(legalEntities.id, snapshot.supplierLegalEntityId));
        const [customer] = await tx
          .select()
          .from(accounts)
          .where(eq(accounts.id, effect.accountId));
        if (!supplier || !customer)
          throw new Error("PAYG_INVOICE_PARTIES_MISSING");
        const tax = await determineTaxForSubject(tx, {
          paygSource: {
            enrollmentId: enrollment.id,
            effectKey: effect.idempotencyKey,
          },
          supplierLegalEntityId: supplier.id,
          customerAccountId: customer.id,
          currency: effect.amount.currency,
          documentType: "invoice",
          taxPointDate: input.now,
          lines: [
            {
              lineId: effect.idempotencyKey,
              taxCode: rating.policy.stripeTaxCode,
              netMinor: BigInt(effect.amount.minor),
            },
          ],
        });
        if (
          tax.detail.confidence !== "determined" ||
          tax.detail.reviewReasons.length > 0
        )
          throw new Error(
            `PAYG_TAX_REVIEW_REQUIRED:${tax.detail.reviewReasons.join(",")}`,
          );
        const sourceSnapshot = {
          rating,
          effect,
          supplier: {
            legalEntityId: supplier.id,
            legalName: supplier.legalName,
            registeredAddress: supplier.registeredAddress,
            establishedCountry: supplier.establishedCountry,
            invoiceHeaderText: supplier.invoiceHeaderText,
            invoiceFooterText: supplier.invoiceFooterText,
          },
          customer: {
            accountId: customer.id,
            legalName: customer.legalName,
            registeredAddress: customer.registeredAddress,
            country: customer.country,
            invoiceDeliveryEmail: customer.invoiceDeliveryEmail,
          },
          stripeCustomerId: snapshot.stripeCustomerId,
          taxDetermination: {
            currency: tax.currency,
            netMinor: tax.netMinor.toString(),
            taxMinor: tax.taxMinor.toString(),
            treatment: tax.treatment,
            detail: {
              ...tax.detail,
              lines: tax.detail.lines.map((line) => ({
                ...line,
                taxableMinor: line.taxableMinor.toString(),
                taxMinor: line.taxMinor.toString(),
              })),
            },
          },
        };
        const invoiceId = randomUUID();
        await tx.insert(invoices).values({
          id: invoiceId,
          billingSource: "payg",
          orderId: null,
          paygEffectKey: effect.idempotencyKey,
          accountId: customer.id,
          currency: effect.amount.currency,
          amountMinor: tax.netMinor + tax.taxMinor,
          taxMinor: tax.taxMinor,
          taxTreatment: tax.treatment,
          status: "draft",
          createdAt: new Date(input.now),
          updatedAt: new Date(input.now),
        });
        await tx.insert(paygInvoiceSources).values({
          invoiceId,
          enrollmentId: enrollment.id,
          effectKey: effect.idempotencyKey,
          sourceSnapshot,
          sourceHash: canonicalTaxHash(sourceSnapshot),
          createdAt: new Date(input.now),
        });
        await appendAuditAndOutbox(tx, {
          accountId: customer.id,
          aggregateType: "invoice",
          aggregateId: invoiceId,
          aggregateVersion: 1,
          eventType: "core.invoices.create",
          actor: input.actor,
          requestId: input.requestId,
          after: {
            id: invoiceId,
            billingSource: "payg",
            paygEffectKey: effect.idempotencyKey,
            accountId: customer.id,
            amount: {
              currency: effect.amount.currency,
              minor: (tax.netMinor + tax.taxMinor).toString(),
            },
            status: "draft",
          },
          occurredAt: new Date(input.now),
        });
        return { invoiceId, replay: false };
      },
    );
  }
}
