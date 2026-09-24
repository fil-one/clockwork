import type { Metadata } from "next";
import Link from "next/link";
import { DatabaseCatalogAdmin } from "@clockwork/db";
import { getCommerceSession } from "@/src/auth/session";
import { getOptionalServiceDatabase } from "@/src/db/service";
import {
  PriceBookStatusPill,
  PricingPill,
  unitLabel,
  type PriceBookStatus,
} from "@/src/features/internal-ops/administration-safety/price-book-presentation";
import { AdministrationPage } from "@/src/features/internal-ops/administration-safety/ui";
import styles from "@/src/features/internal-ops/administration-safety/administration-safety.module.css";
import { richText } from "@/src/i18n/rich";
import { getTranslations } from "@/src/i18n/server";
import { CatalogMappingControls } from "./controls";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("adminPricing.catalog.title") };
}

function isPriceBookStatus(value: string): value is PriceBookStatus {
  return value === "draft" || value === "active" || value === "retired";
}

export default async function Page() {
  const session = await getCommerceSession();
  if (!session.isInternalStaff)
    // i18n-exempt: server-side guard; Next.js masks server errors, the reader never sees this text
    throw new Error("Internal staff authority is required");
  const t = await getTranslations();
  let rows: Awaited<ReturnType<DatabaseCatalogAdmin["list"]>> | null = null;
  try {
    const db = getOptionalServiceDatabase();
    if (db && session.providerBacked)
      rows = await new DatabaseCatalogAdmin(db).list(
        `catalog:${crypto.randomUUID()}`,
      );
  } catch {
    rows = null;
  }
  const canEdit = session.roles.some(
    (role) => role === "internal_operator" || role === "finance_approver",
  );
  const priceBooksSentence = richText(
    t,
    "adminPricing.catalog.priceBooksSentence",
    {
      link: (
        <Link className={styles.proseLink} href="/internal/price-books">
          {t("adminPricing.catalog.priceBooksLink")}
        </Link>
      ),
    },
  );
  const gatesSentence = richText(t, "adminPricing.catalog.gatesSentence", {
    link: (
      <Link className={styles.proseLink} href="/internal/gates">
        {t("adminPricing.catalog.gatesLink")}
      </Link>
    ),
  });
  return (
    <AdministrationPage
      title={t("adminPricing.catalog.title")}
      eyebrow={t("adminPricing.catalog.eyebrow")}
      description={t("adminPricing.catalog.description")}
    >
      <p>
        {richText(t, "common.join.sentences", {
          first: richText(t, "common.join.sentences", {
            first: priceBooksSentence,
            second: t("adminPricing.catalog.evidenceNote"),
          }),
          second: gatesSentence,
        })}
      </p>
      {rows === null ? (
        <p role="status">
          {session.providerBacked
            ? t("adminPricing.catalog.registryUnavailable")
            : t("adminPricing.catalog.demoUnavailable")}
        </p>
      ) : rows.length === 0 ? (
        <p>{t("adminPricing.catalog.empty")}</p>
      ) : (
        rows.map((row) => (
          <section className={styles.panel} key={row.rateCardId}>
            <div className={styles.panelHeading}>
              <div>
                <h2>
                  {t("common.join.labels", {
                    first: row.sku,
                    second: row.region,
                  })}
                </h2>
                <p>
                  {t("common.join.labels", {
                    first: t("adminPricing.bookName", {
                      name: row.bookName,
                      version: row.bookVersion,
                    }),
                    second: unitLabel(row.unit, t),
                  })}
                </p>
              </div>
              {isPriceBookStatus(row.status) ? (
                <PriceBookStatusPill status={row.status} t={t} />
              ) : (
                <PricingPill label={row.status} tone="warning" />
              )}
            </div>
            <div className={styles.panelBody}>
              <p>{row.approvedClaim}</p>
              {row.mapping ? (
                <dl>
                  <dt>{t("adminPricing.catalog.providerSkuRegion")}</dt>
                  <dd>
                    {row.mapping.providerSku} / {row.mapping.providerRegion}
                  </dd>
                  <dt>{t("adminPricing.catalog.sourceMeter")}</dt>
                  <dd>{row.mapping.meterId}</dd>
                  <dt>{t("adminPricing.catalog.sourceEvidence")}</dt>
                  <dd>{row.mapping.sourceEvidence}</dd>
                </dl>
              ) : (
                <p>{t("adminPricing.catalog.notQualified")}</p>
              )}
              {!row.editable ? <p>{t("adminPricing.catalog.frozen")}</p> : null}
            </div>
            {row.editable && canEdit ? (
              <CatalogMappingControls
                key={`${row.rateCardId}:${row.rowVersion}`}
                row={row}
              />
            ) : null}
          </section>
        ))
      )}
    </AdministrationPage>
  );
}
