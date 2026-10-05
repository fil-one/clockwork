import type { ProjectionRecord } from "@/src/features/experience-server/model";

/**
 * Account names by account identity, from the internal `dashboard` channel,
 * which projects the account aggregate. Staff tables lead with the customer's
 * name and keep the record reference beside it.
 *
 * The name is whatever that projection titles the account: the company name
 * where the projection carries one, otherwise its own account reference. A
 * session that cannot read an account gets no entry, and the row falls back to
 * its own reference.
 */
export function accountNamesFromProjection(
  accountRecords: readonly ProjectionRecord[],
): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  for (const record of accountRecords) {
    for (const key of ["title", "name"]) {
      const value = record.data[key];
      if (typeof value === "string" && value.trim()) {
        names.set(record.aggregateId, value.trim());
        break;
      }
    }
  }
  return names;
}

/** The first of the given account identities that has a name. */
export function accountName(
  names: ReadonlyMap<string, string>,
  ...accountIds: readonly (string | null | undefined)[]
): string | null {
  for (const id of accountIds) {
    const name = id ? names.get(id) : undefined;
    if (name) return name;
  }
  return null;
}

/**
 * Who a staff row names: the end customer first, and the paying account
 * beneath it only when someone else pays (a reseller or distributor). With no
 * nameable customer the payer leads, so the row still carries a name.
 */
export function partyNames(
  names: ReadonlyMap<string, string>,
  customerIds: readonly (string | null | undefined)[],
  payerId: string | null | undefined,
): { customer: string | null; payer: string | null } {
  const customer = accountName(names, ...customerIds);
  const payer = accountName(names, payerId);
  if (!customer) return { customer: payer, payer: null };
  return { customer, payer: payer && payer !== customer ? payer : null };
}
