import { parseTaxRuleBook, type TaxRuleBook } from "@clockwork/domain/core";

import seed from "./seed-rule-book.json" with { type: "json" };

/**
 * The seeded rule book the fake and the demo determine against.
 *
 * It is a document, not code: rates, territory membership, carve-outs, number
 * formats, notations and thresholds are all rows, and amending it is an edit to
 * data. Nothing in it is authority — it is a fixture standing in for the books
 * an approved engine or the finance team will supply, and it is parsed on the
 * way in so a malformed amendment fails loudly rather than determining
 * something wrong.
 */
export function seedTaxRuleBook(): TaxRuleBook {
  return parseTaxRuleBook(seed);
}
