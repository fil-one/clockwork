import { useFormattingLocale, useTranslations } from "@/src/i18n/client";
import type { MessageId } from "@/src/i18n";
import { Table } from "@clockwork/ui";
import type {
  PriceBookAdministrationRecord,
  PriceBookImpactRecord,
} from "@clockwork/db";

import type { PriceBookImpactResult } from "../price-books/price-book-impact-model";
import { styles } from "./ui";

const metrics: readonly [
  MessageId,
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
  ["adminPricing.impact.metric.quoteRevisions", "quoteRevisions"],
  ["adminPricing.impact.metric.quoteSeries", "quoteSeries"],
  ["adminPricing.impact.metric.quotedAccounts", "quotedAccounts"],
  ["adminPricing.impact.metric.draftQuotes", "draftQuotes"],
  ["adminPricing.impact.metric.unexpiredIssuedQuotes", "unexpiredIssuedQuotes"],
  ["adminPricing.impact.metric.expiredIssuedQuotes", "expiredIssuedQuotes"],
  ["adminPricing.impact.metric.acceptedQuotes", "acceptedQuotes"],
  ["adminPricing.impact.metric.orders", "orders"],
  ["adminPricing.impact.metric.immutableOrders", "immutableOrders"],
  ["adminPricing.impact.metric.openOrders", "openOrders"],
  ["adminPricing.impact.metric.governingAgreements", "governingAgreements"],
  ["adminPricing.impact.metric.orderLines", "orderLines"],
  ["adminPricing.impact.metric.activeEntitlements", "activeEntitlements"],
  ["adminPricing.impact.metric.suspendedEntitlements", "suspendedEntitlements"],
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
  const t = useTranslations();
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
  const counts = new Intl.NumberFormat(formattingLocale);
  return (
    <section aria-labelledby="price-book-impact-title">
      <h3 id="price-book-impact-title">{t("adminPricing.impact.title")}</h3>
      <p>{t("adminPricing.impact.scope")}</p>
      <p className={styles.notice}>{t("adminPricing.impact.retireNotice")}</p>
      {!current || impact?.availability !== "available" ? (
        <p role="status">{t("adminPricing.impact.unavailable")}</p>
      ) : (
        <>
          <p className={styles.resultMeta}>
            {t(
              impact.source === "demoScenario"
                ? "adminPricing.impact.checked.demo"
                : "adminPricing.impact.checked.retained",
              {
                time: new Intl.DateTimeFormat(formattingLocale, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                  timeZone: "UTC",
                  timeZoneName: "short",
                }).format(new Date(impact.asOf)),
              },
            )}
          </p>
          <Table
            caption={t("adminPricing.impact.tableCaption")}
            density="compact"
            headers={[
              t("adminPricing.impact.header.records"),
              ...books.map((book, index) =>
                t(
                  incumbent && index === 0
                    ? "adminPricing.impact.header.current"
                    : "adminPricing.impact.header.selected",
                  {
                    book: t("adminPricing.bookName", {
                      name: book.name,
                      version: book.version,
                    }),
                  },
                ),
              ),
            ]}
            rowKeys={metrics.map(([, key]) => key)}
            rows={metrics.map(([label, key]) => [
              t(label),
              ...records.map((record) =>
                record
                  ? counts.format(record[key])
                  : t("adminPricing.pill.unavailable"),
              ),
            ])}
          />
          <p className={styles.resultMeta}>
            {t("adminPricing.impact.footnote")}
          </p>
        </>
      )}
    </section>
  );
}
