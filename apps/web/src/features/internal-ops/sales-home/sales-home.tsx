import { use, type ReactNode } from "react";
import type { Route } from "next";
import Link from "next/link";

import { buttonClassName } from "@clockwork/ui";

import { getFormattingLocale, getTranslations } from "@/src/i18n/server";

import type { SalesHomeRow, SalesHomeSection } from "./model";
import styles from "./sales-home.module.css";
import { StartGuide } from "./start-guide";

function WorkRow({ row }: { row: SalesHomeRow }) {
  const t = use(getTranslations());
  const locale = use(getFormattingLocale());
  const number = new Intl.NumberFormat(locale);
  const titleId = `sales-home-${row.id}`;
  return (
    <li className={styles.row} data-empty={row.mine === 0 ? "" : undefined}>
      <div className={styles.rowText}>
        <h3 id={titleId}>{t(row.title)}</h3>
        <p>{t(row.hint)}</p>
      </div>
      <div className={styles.rowFigures}>
        {row.mine === 0 ? (
          <span className={styles.none}>
            {t("operations.sales.home.card.none")}
          </span>
        ) : (
          <strong className={styles.count}>{number.format(row.mine)}</strong>
        )}
        {row.team !== undefined ? (
          row.teamHref ? (
            <Link
              className={styles.team}
              href={row.teamHref as Route}
              aria-describedby={titleId}
            >
              {t("operations.sales.home.card.team", {
                count: number.format(row.team),
              })}
            </Link>
          ) : (
            <span className={styles.team}>
              {t("operations.sales.home.card.team", {
                count: number.format(row.team),
              })}
            </span>
          )
        ) : null}
        {row.href && row.mine > 0 ? (
          <Link
            className={styles.view}
            href={row.href as Route}
            aria-describedby={titleId}
          >
            {t("operations.sales.home.card.view")}
          </Link>
        ) : null}
      </div>
    </li>
  );
}

function WorkSection({ section }: { section: SalesHomeSection }) {
  const t = use(getTranslations());
  const headingId = `sales-home-section-${section.id}`;
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h2 id={headingId}>{t(section.heading)}</h2>
      {section.rows === null ? (
        <div className={styles.unavailable} role="status">
          <p>{t(section.unavailable.message)}</p>
          {section.unavailable.href && section.unavailable.action ? (
            <Link href={section.unavailable.href as Route}>
              {t(section.unavailable.action)}
            </Link>
          ) : null}
        </div>
      ) : (
        <ul className={styles.ledger}>
          {section.rows.map((row) => (
            <WorkRow key={row.id} row={row} />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The staff home page for anyone with the sales workspace: what waits on the
 * reader or a partner, what finished recently, and the first-run guide.
 */
export function SalesHome({
  userId,
  sections,
  canSendMnda,
  cards,
}: {
  userId: string;
  sections: readonly SalesHomeSection[];
  /** Whether the MNDA register exists here and the reader may send. */
  canSendMnda: boolean;
  /** Self-contained cards from other workspaces, shown after the sections. */
  cards?: ReactNode;
}) {
  const t = use(getTranslations());
  return (
    <main className={styles.main} id="main-content">
      <header className={styles.header}>
        <div>
          <h1>{t("operations.sales.home.title")}</h1>
          <p>{t("operations.sales.home.description")}</p>
        </div>
        <div className={styles.actions}>
          {canSendMnda ? (
            <Link
              className={buttonClassName({ variant: "primary" })}
              href="/internal/mndas"
            >
              {t("operations.sales.home.sendMnda")}
            </Link>
          ) : null}
          <Link
            className={buttonClassName({ variant: "secondary" })}
            href="/internal/pricing"
          >
            {t("operations.sales.home.openPricing")}
          </Link>
        </div>
      </header>
      <StartGuide userId={userId} />
      {sections.map((section) => (
        <WorkSection key={section.id} section={section} />
      ))}
      {cards}
    </main>
  );
}
