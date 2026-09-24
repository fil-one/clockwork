import { useFormattingLocale } from "@/src/i18n/client";
import { Table } from "@clockwork/ui";
import type {
  PriceBookAdministrationRecord,
  PriceBookImpactRecord,
} from "@clockwork/db";

import type { PriceBookImpactResult } from "../price-books/price-book-impact-model";
import { styles } from "./ui";

const metrics: readonly [
  string,
  keyof Pick<
    PriceBookImpactRecord,
    | "quoteRevisions"
    | "quoteSeries"
    | "quotedAccounts"
    | "draftQuotes"
    | "unexpiredIssuedQuotes"
    | "expiredIssuedQuotes"
    | "acceptedQuotes"
    | "orders"
    | "immutableOrders"
    | "openOrders"
    | "governingAgreements"
    | "orderLines"
    | "activeEntitlements"
    | "suspendedEntitlements"
  >,
][] = [
  ["Quote revisions (all statuses)", "quoteRevisions"],
  ["Distinct quote series", "quoteSeries"],
  ["Distinct quoted accounts", "quotedAccounts"],
  ["Draft quotes", "draftQuotes"],
  ["Issued quotes before expiry", "unexpiredIssuedQuotes"],
  ["Issued quotes past expiry", "expiredIssuedQuotes"],
  ["Accepted quote revisions", "acceptedQuotes"],
  ["Orders (all statuses)", "orders"],
  ["Orders with immutable snapshots", "immutableOrders"],
  ["Accepted / provisioning / active / amended orders", "openOrders"],
  ["Distinct governing agreements", "governingAgreements"],
  ["Retained order lines", "orderLines"],
  ["Retained active entitlements", "activeEntitlements"],
  ["Retained write-suspended entitlements", "suspendedEntitlements"],
];

export function PriceBookImpactPanel({
  candidate,
  incumbent,
  impact,
}: {
  candidate: PriceBookAdministrationRecord;
  incumbent?: PriceBookAdministrationRecord | undefined;
  impact?: PriceBookImpactResult | undefined;
}) {
  const formattingLocale = useFormattingLocale();
  const books = incumbent ? [incumbent, candidate] : [candidate];
  const records = books.map((book) =>
    impact?.availability === "available"
      ? impact.records.find(
          (record) =>
            record.id === book.id &&
            record.rowVersion === book.rowVersion &&
            record.status === book.status,
        )
      : undefined,
  );
  const current = records.every((record) => record !== undefined);
  return (
    <section aria-labelledby="price-book-impact-title">
      <h3 id="price-book-impact-title">Existing business impact</h3>
      <p>
        Activation changes the eligible price book for new quotes in this
        currency. It does not reprice retained quote, order, invoice or
        commitment snapshots. Issued quotes keep their quoted economics and
        acceptance still checks their expiry, agreement and other existing
        controls.
      </p>
      <p className={styles.notice}>
        Retiring the current book stops draft issuance and revisions on that
        book. Review open quote work before activation; using the new rates
        requires a new quote, not a repriced historical revision.
      </p>
      {!current || impact?.availability !== "available" ? (
        <p role="status">
          Reference counts are unavailable or the price-book version changed.
          Refresh before relying on the impact review. Unavailable counts do not
          mean zero business.
        </p>
      ) : (
        <>
          <p className={styles.resultMeta}>
            {impact.source} · checked{" "}
            {new Date(impact.asOf).toLocaleString(formattingLocale, {
              timeZone: "UTC",
            })}{" "}
            UTC.
            {impact.source === "Illustrative demo scenario"
              ? " These examples demonstrate the review; they are not live customer or demo-action totals."
              : " Complete reference counts for these books at the read snapshot; not a forecast or approval attestation."}
          </p>
          <Table
            caption="References retained on each price book"
            density="compact"
            headers={[
              "Retained records",
              ...books.map(
                (book, index) =>
                  `${incumbent && index === 0 ? "Current active" : "Selected"}: ${book.name} v${book.version}`,
              ),
            ]}
            rowKeys={metrics.map(([, key]) => key)}
            rows={metrics.map(([label, key]) => [
              label,
              ...records.map(
                (record) =>
                  record?.[key].toLocaleString(formattingLocale) ??
                  "Unavailable",
              ),
            ])}
          />
          <p className={styles.resultMeta}>
            Revisions and orders are separate counts and must not be added
            together. Agreements count distinct governing records, not new
            contracts created by activation. Entitlements describe retained
            state, not a live provider check. Revenue, margin and renewal
            forecasts require additional approved inputs.
          </p>
        </>
      )}
    </section>
  );
}
