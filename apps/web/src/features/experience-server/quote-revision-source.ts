import "server-only";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withAuthorizedTransaction } from "@clockwork/db";
import {
  getCommerceSession,
  explicitDemoIdentityEnabled,
} from "@/src/auth/session";
import { getOptionalRuntimeDatabase } from "@/src/db/service";
import { authorizationContext } from "./authorization";
import { loadPortalRecords } from "./portal-view-loader";

const sourceSchema = z.object({
  quoteId: z.uuid(),
  version: z.number().int().positive(),
  seriesId: z.uuid(),
  priceBookId: z.uuid(),
  status: z.string(),
  lines: z
    .array(
      z.object({
        sku: z.string(),
        region: z.string(),
        quantity: z.string(),
        termMonths: z.number(),
      }),
    )
    .min(1),
});

/** Read editable commercial facts under the same tenant policy as the quote. */
export async function loadQuoteRevisionSource(reference: string) {
  const { records } = await loadPortalRecords("customer", "quotes");
  const record = records.find((record) => record.recordKey === reference);
  if (!record) return undefined;
  if (explicitDemoIdentityEnabled(process.env)) {
    const parsed = sourceSchema.safeParse({
      ...(record.data.authoritative as object),
      quoteId: record.aggregateId,
      version: record.version,
    });
    return parsed.success ? parsed.data : undefined;
  }
  const session = await getCommerceSession();
  const runtime = getOptionalRuntimeDatabase();
  const secret = process.env.AUTHORIZATION_CONTEXT_SECRET?.trim();
  if (!session || !runtime || !secret) return undefined;
  return withAuthorizedTransaction(
    runtime,
    authorizationContext(session, `quote-revision:${crypto.randomUUID()}`),
    { secret },
    async (transaction) => {
      const rows = await transaction.execute(sql`
      select q.id as "quoteId", q.row_version as version, q.series_id as "seriesId",
        q.price_book_id as "priceBookId", q.status,
        coalesce((select jsonb_agg(jsonb_build_object('sku', l.sku, 'region', l.region, 'quantity', l.quantity::text, 'termMonths', l.term_months) order by l.id)
          from public.quote_lines l where l.quote_id = q.id), '[]'::jsonb) as lines
      from public.quotes q where q.id = ${record.aggregateId}::uuid and q.account_id = ${record.accountId}::uuid
    `);
      const parsed = sourceSchema.safeParse(rows[0]);
      return parsed.success ? parsed.data : undefined;
    },
  );
}
