import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import type { Actor } from "@clockwork/contracts";
import {
  appendAuditAndOutbox,
  withInternalTransaction,
  type RuntimeDatabase,
} from "@clockwork/db";

import {
  blocksClose,
  reconciliationQueue,
  varianceClassificationLabels,
  varianceClassifiedEvent,
  type VarianceClassification,
} from "./model";

export interface VarianceDispositionInput {
  caseId: string;
  expectedRowVersion: number;
  classification: VarianceClassification;
  reason: string;
  expectedClearingPeriod?: string;
  evidenceReference?: string;
  actor: Actor;
  requestId: string;
  occurredAt?: Date;
}

export interface VarianceDispositionRecord {
  caseId: string;
  classification: VarianceClassification;
  rowVersion: number;
  blocksClose: boolean;
}

const CaseSchema = z
  .object({
    id: z.string(),
    account_id: z.string(),
    object_type: z.string(),
    object_id: z.string(),
    row_version: z.coerce.number().int().positive(),
    status: z.string(),
  })
  .strict();

const UpdatedSchema = z
  .object({ row_version: z.coerce.number().int().positive() })
  .strict();

/**
 * Records the disposition `## Variance handling` asks for against one open
 * reconciliation case.
 *
 * It deliberately does not close the case. `decideException` in the lifecycle
 * command repository is the signed decision, and it requires an immutable
 * evidence document; a second closing path here would be a way around that
 * requirement, not a convenience.
 *
 * The write follows the same optimistic-concurrency protocol as every other
 * writer of this table: the row is locked, the expected `row_version` is the
 * CAS predicate, and the audit row is numbered from the version the update
 * produced. That keeps operator dispositions and lifecycle decisions in one
 * numbering, so `audit_aggregate_version_unique` orders them instead of
 * colliding on them.
 */
// `async` rather than a plain promise-returning function so the guard below
// rejects like every other refusal here. A synchronous throw from a function
// typed as returning a promise is a refusal half its callers would miss.
export async function recordVarianceDisposition(
  database: RuntimeDatabase,
  input: VarianceDispositionInput,
): Promise<VarianceDispositionRecord> {
  const reason = input.reason.trim();
  if (reason.length < 8) throw new Error("RECONCILIATION_REASON_REQUIRED");
  return await withInternalTransaction(
    database,
    input.requestId,
    async (transaction) => {
      const rows = await transaction.execute(sql`
        select id::text as id,
               account_id::text as account_id,
               object_type,
               object_id::text as object_id,
               row_version,
               status
        from public.exception_cases
        where id = ${input.caseId}::uuid
          and queue = ${reconciliationQueue}
          and status = 'open'
        for update
      `);
      const row = rows[0];
      if (!row) throw new Error("RECONCILIATION_CASE_NOT_FOUND");
      const current = CaseSchema.parse(row);
      if (current.row_version !== input.expectedRowVersion)
        throw new Error("RECONCILIATION_VERSION_CONFLICT");

      // `decision_reason` is the operator-visible summary the queue surfaces
      // already read. The structured disposition lives on the audit row, which
      // is the record the runbook says the evidence is attached to.
      const updatedRows = await transaction.execute(sql`
        update public.exception_cases
        set decision_reason = ${`${varianceClassificationLabels[input.classification]}: ${reason}`}
        where id = ${current.id}::uuid
          and row_version = ${current.row_version}
        returning row_version
      `);
      const updated = updatedRows[0];
      if (!updated) throw new Error("RECONCILIATION_VERSION_CONFLICT");
      const nextVersion = UpdatedSchema.parse(updated).row_version;

      await appendAuditAndOutbox(transaction, {
        accountId: current.account_id,
        aggregateType: "exception_case",
        aggregateId: current.id,
        aggregateVersion: nextVersion,
        eventType: varianceClassifiedEvent,
        actor: input.actor,
        requestId: input.requestId,
        occurredAt: input.occurredAt ?? new Date(),
        before: {
          status: current.status,
          rowVersion: current.row_version,
        },
        after: {
          classification: input.classification,
          blocksClose: blocksClose(input.classification),
          reason,
          objectType: current.object_type,
          objectId: current.object_id,
          ...(input.expectedClearingPeriod
            ? { expectedClearingPeriod: input.expectedClearingPeriod }
            : {}),
          ...(input.evidenceReference
            ? { evidenceReference: input.evidenceReference }
            : {}),
        },
      });

      return {
        caseId: current.id,
        classification: input.classification,
        rowVersion: nextVersion,
        blocksClose: blocksClose(input.classification),
      };
    },
  );
}
