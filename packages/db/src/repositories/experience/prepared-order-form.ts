import { sql } from "drizzle-orm";
import { z } from "zod";

import type { RuntimeTransaction } from "../../client";

/**
 * A rendered order form, and the order the *prepare* pass named.
 *
 * Both halves travel together because the server refuses them apart:
 * `assertCommercialArtifactBinding` selects the request row by
 * `(document_id, subject_type, subject_id, source_hash, status = 'stored')`,
 * so a create pass quoting this document under any other order identifier
 * matches no row and is refused with `COMMERCIAL_ARTIFACT_BINDING_INVALID`.
 */
export interface DatabasePreparedOrderForm {
  documentId: string;
  orderId: string;
}

const PreparedOrderFormRowSchema = z
  .object({ document_id: z.uuid(), subject_id: z.uuid() })
  .strict();

/**
 * The order form an acceptance in progress is waiting on.
 *
 * Why this exists at all: `orders:prepare_artifact` writes **no order row**.
 * It renders the form from an in-memory `acceptOrder(...)` and persists a
 * `core_commercial_artifact_requests` row keyed on the order identifier the
 * pass named; `mutateOrder`'s create branch is the only writer of
 * `public.orders`. The experience projection for the `order` aggregate reads
 * `public.orders` (see `authoritative-state.ts`), and
 * `orders.order_form_document_id` is written by that same create branch -- so
 * the document a create pass needs as its precondition cannot appear on the
 * orders channel until after the command it is a precondition *for* has run.
 * A surface that waits for it there waits for ever.
 *
 * The request row is where the binding actually lives between the two passes,
 * and it is readable by the party the form is addressed to:
 * `core_commercial_artifact_select` (migration 000931) is
 * `app_is_internal() or app_has_account(audience_account_id)`. This function
 * adds no account predicate of its own and must not -- row-level security is
 * the scope, and repeating it here in application code would be a second,
 * weaker copy of it. One consequence is deliberate: an order form addressed to
 * a partner on a resale route is not visible to the end client, which is the
 * same boundary `mutateOrder` already enforces by refusing an end-client
 * prepare on a resale quote with `NOT_FOUND`.
 *
 * `status = 'stored'` is the only success. A `requested` row means the
 * renderer has not finished, and `document_id` is null until it has; treating
 * that as an answer would hand the create pass a null document.
 */
export async function findPreparedOrderForm(
  transaction: RuntimeTransaction,
  input: { orderId: string },
): Promise<DatabasePreparedOrderForm | null> {
  const orderId = z.uuid().parse(input.orderId);
  const rows = await transaction.execute(sql`
    select request.document_id, request.subject_id
    from public.core_commercial_artifact_requests request
    where request.subject_type = 'order'
      and request.subject_id = ${orderId}::uuid
      and request.document_kind = 'order_form'
      and request.status = 'stored'
      and request.document_id is not null
    limit 1
  `);
  const row = rows[0];
  if (!row) return null;
  const parsed = PreparedOrderFormRowSchema.parse(row);
  return { documentId: parsed.document_id, orderId: parsed.subject_id };
}
