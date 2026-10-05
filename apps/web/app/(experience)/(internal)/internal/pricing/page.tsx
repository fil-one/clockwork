import type { Metadata } from "next";

import { DatabasePriceBookAdministrationReader } from "@clockwork/db";

import { getOptionalServiceDatabase } from "@/src/db/service";
import { loadPriceBookRecords } from "@/src/features/internal-ops/price-books/server-price-book-loader";
import { indicativePriceBooks } from "@/src/features/internal-ops/sales-pricing/books";
import styles from "@/src/features/internal-ops/sales-pricing/pricing.module.css";
import { PricingWorkspace } from "@/src/features/internal-ops/sales-pricing/pricing-workspace";
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
 * Indicative pricing for the sales workspace. It reads the same price books
 * finance maintains, prices in the browser, and changes nothing.
 */
async function Page() {
  const [t, locale, formattingLocale] = await Promise.all([
    getTranslations(),
    getLocale(),
    getFormattingLocale(),
  ]);
  const database = getOptionalServiceDatabase();
  const result = await loadPriceBookRecords(
    database ? new DatabasePriceBookAdministrationReader(database) : undefined,
    { locale },
  );
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
      <header className={styles.header}>
        <h1>{t("operations.sales.pricing.title")}</h1>
        <p>{t("operations.sales.pricing.description")}</p>
      </header>
      {result.availability === "unavailable" ? (
        <section className={styles.state} role="alert">
          <p>{t("operations.sales.pricing.unavailable")}</p>
        </section>
      ) : books[0] ? (
        <PricingWorkspace books={books} initialBookId={books[0].id} />
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
