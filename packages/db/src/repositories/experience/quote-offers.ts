import { sql } from "drizzle-orm";
import { z } from "zod";

import type { RuntimeTransaction } from "../../client";

const CurrencySchema = z.enum(["USD", "EUR", "GBP"]);
const AccountCurrencyRowSchema = z
  .object({ currency: CurrencySchema })
  .strict();
const QuoteOfferRowSchema = z
  .object({
    price_book_id: z.uuid(),
    price_book_name: z.string().min(1),
    currency: CurrencySchema,
    version: z.number().int().positive(),
    sku: z.string().min(1),
    approved_claim: z.string().min(1),
    region: z.string().min(1),
  })
  .strict();

export type DatabaseQuoteCurrency = z.output<typeof CurrencySchema>;
export type DatabaseQuoteOffer = z.output<typeof QuoteOfferRowSchema>;

/** Reads the caller-scoped account fact that decides compatible books. */
export async function findCustomerQuoteCurrency(
  transaction: RuntimeTransaction,
  input: { accountId: string },
): Promise<DatabaseQuoteCurrency | null> {
  const accountId = z.uuid().parse(input.accountId);
  const rows = await transaction.execute(sql`
    select account.currency
    from public.accounts account
    where account.id = ${accountId}::uuid
    limit 1
  `);
  const row = rows[0];
  return row ? AccountCurrencyRowSchema.parse(row).currency : null;
}

/**
 * Returns every active rate card compatible with the scoped account currency.
 * Confidential prices are deliberately not selected; quote creation sends
 * only the book, SKU and region, and the command prices them server-side.
 */
export async function findActiveCustomerQuoteOffers(
  transaction: RuntimeTransaction,
  input: { currency: DatabaseQuoteCurrency; now: Date },
): Promise<readonly DatabaseQuoteOffer[]> {
  const currency = CurrencySchema.parse(input.currency);
  const onDate = input.now.toISOString().slice(0, 10);
  // Price-book end dates include the final UTC day, as quote pricing does.
  const rows = await transaction.execute(sql`
    select
      book.id as price_book_id,
      book.name as price_book_name,
      book.currency,
      book.version,
      card.sku,
      card.approved_claim,
      card.region
    from public.price_books book
    join public.rate_cards card on card.price_book_id = book.id
    where book.status = 'active'
      and book.currency = ${currency}
      and book.effective_from <= ${onDate}::date
      and (book.effective_to is null or book.effective_to >= ${onDate}::date)
    order by card.approved_claim, card.region, book.name, card.sku
  `);
  return rows.map((row) => QuoteOfferRowSchema.parse(row));
}
