import type { Metadata } from "next";

import { DatabaseIndicativePriceBookReader } from "@clockwork/db";
import { PageHeader } from "@clockwork/ui";

import { getOptionalServiceDatabase } from "@/src/db/service";
import { indicativePriceBooks } from "@/src/features/internal-ops/sales-pricing/books";
import styles from "@/src/features/internal-ops/sales-pricing/pricing.module.css";
import { ScenarioBuilder } from "@/src/features/internal-ops/sales-pricing/scenario-builder";
import { loadScenarioPanel } from "@/src/features/internal-ops/sales-pricing/scenario-server";
import { loadIndicativePriceBookRecords } from "@/src/features/internal-ops/sales-pricing/server-books";
import { withStaffPermission } from "@/src/features/shell/staff-access";
import {
  getFormattingLocale,
  getLocale,
  getTranslations,
} from "@/src/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("operations.sales.pricing.title") };
}

/**
 * Pricing for the sales workspace. It reads the same price books finance
 * maintains and prices in the browser: line 1 is the calculator, more lines
 * make a scenario, and saving one is the page's only write.
 */
async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [t, locale, formattingLocale, query] = await Promise.all([
    getTranslations(),
    getLocale(),
    getFormattingLocale(),
    searchParams,
  ]);
  const database = getOptionalServiceDatabase();
  const reading = loadIndicativePriceBookRecords(
    database ? new DatabaseIndicativePriceBookReader(database) : undefined,
    { locale },
  );
  const [result, scenarios] = await Promise.all([
    reading,
    loadScenarioPanel(
      typeof query.scenario === "string" ? query.scenario : undefined,
      reading,
    ),
  ]);
  const dateFormat = new Intl.DateTimeFormat(formattingLocale, {
    dateStyle: "long",
    timeZone: "UTC",
  });
  const books = indicativePriceBooks(
    result.books,
    result.readAt.slice(0, 10),
    (isoDate) => dateFormat.format(new Date(`${isoDate}T00:00:00Z`)),
  );
  return (
    <main className={styles.main} id="main-content">
      <PageHeader
        title={t("operations.sales.pricing.title")}
        description={t("operations.sales.pricing.description")}
      />
      {result.availability === "unavailable" ? (
        <section className={styles.state} role="alert">
          <p>{t("operations.sales.pricing.unavailable")}</p>
        </section>
      ) : books[0] ? (
        <ScenarioBuilder
          // A fresh form for each opened scenario and each saved version.
          key={
            (scenarios.kind === "ready" || scenarios.kind === "demo") &&
            scenarios.opened
              ? `${scenarios.opened.id}:${scenarios.opened.version}`
              : "new"
          }
          books={books}
          state={scenarios}
        />
      ) : (
        <section className={styles.state} role="status">
          <h2>{t("operations.sales.pricing.empty.title")}</h2>
          <p>{t("operations.sales.pricing.empty.description")}</p>
        </section>
      )}
    </main>
  );
}

export default withStaffPermission("sales:read", Page);
