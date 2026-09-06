import { desc } from "drizzle-orm";
import type { RuntimeDatabase } from "../../client";
import { agreementTemplates } from "../../schema";
import { withInternalTransaction } from "../../transaction";

/** Read the canonical template registry; never substitute presentation fixtures. */
export async function listAgreementTemplates(
  db: RuntimeDatabase,
  requestId: string,
) {
  return withInternalTransaction(db, requestId, (tx) =>
    tx
      .select()
      .from(agreementTemplates)
      .orderBy(
        desc(agreementTemplates.effectiveOn),
        desc(agreementTemplates.createdAt),
      )
      .limit(501),
  );
}
