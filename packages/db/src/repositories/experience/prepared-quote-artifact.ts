import { sql } from "drizzle-orm";
import { z } from "zod";

import type { RuntimeTransaction } from "../../client";

export interface DatabasePreparedQuoteArtifact {
  documentId: string;
  quoteId: string;
  artifactId: string;
}

const PreparedQuoteArtifactRowSchema = z
  .object({ id: z.uuid(), document_id: z.uuid(), subject_id: z.uuid() })
  .strict();

/**
 * Finds the stored end-client artifact that an issuance pass may bind.
 *
 * The prepare command does not change the quote row. Its durable result lives
 * in `core_commercial_artifact_requests`, and `core_commercial_artifact_select`
 * scopes this read to the addressed account. No application account predicate
 * is added here: the authorized transaction and row policy are the boundary.
 */
export async function findPreparedQuoteArtifact(
  transaction: RuntimeTransaction,
  input: { quoteId: string },
): Promise<DatabasePreparedQuoteArtifact | null> {
  const quoteId = z.uuid().parse(input.quoteId);
  const rows = await transaction.execute(sql`
    select request.id, request.document_id, request.subject_id
    from public.core_commercial_artifact_requests request
    where request.subject_type = 'quote'
      and request.subject_id = ${quoteId}::uuid
      and request.audience = 'end_client'
      and request.document_kind = 'direct_quote'
      and request.status = 'stored'
      and request.document_id is not null
    limit 1
  `);
  const row = rows[0];
  if (!row) return null;
  const parsed = PreparedQuoteArtifactRowSchema.parse(row);
  return {
    documentId: parsed.document_id,
    quoteId: parsed.subject_id,
    artifactId: parsed.id,
  };
}
