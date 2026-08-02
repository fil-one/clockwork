import { loadAccountDerivations, parseAccountId } from "./derivation-loader";
import { InvoiceDerivationPanel } from "./invoice-derivation-panel";

/**
 * Billed-amount derivations for the account an operator has open. A record key
 * that names something other than an account carries no invoices, so the
 * surface stays as it was.
 */
export async function AccountDerivationSection({
  recordKey,
  limit = 5,
}: {
  recordKey: string;
  limit?: number;
}) {
  if (!parseAccountId(recordKey)) return null;
  const { derivations } = await loadAccountDerivations(recordKey, limit);
  return <InvoiceDerivationPanel derivations={derivations} />;
}
