import Link from "next/link";

import {
  partnerListLimit,
  type PartnerListQuery,
  type PartnerOwnerOption,
  type PartnerSummary,
} from "@clockwork/contracts";
import type { PartnerListResult } from "@clockwork/db";
import {
  EmptyState,
  InlineNotice,
  PageHeader,
  StatusBadge,
  Table,
  Tag,
  buttonClassName,
} from "@clockwork/ui";

import type { Translator } from "@/src/i18n";

import { formatContractDate } from "../contracts/copy";
import {
  partnerHref,
  partnerListHref,
  partnerModelLabels,
  partnerStatusLabels,
  partnerStatusTone,
} from "./model";
import { PartnerFilters } from "./partner-filters";
import styles from "./partners.module.css";

/** The headline commercial terms, short enough for one cell. */
export function headlineTerms(row: PartnerSummary, t: Translator): string {
  const parts = [
    row.commissionPct
      ? t("operations.partners.commissionShort", { rate: row.commissionPct })
      : null,
    row.marginPct
      ? t("operations.partners.marginShort", { rate: row.marginPct })
      : null,
    row.currency,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : t("operations.partners.notSet");
}

function NextStep({
  row,
  today,
  t,
  locale,
}: {
  row: PartnerSummary;
  today: string;
  t: Translator;
  locale: string;
}) {
  if (!row.nextStep && !row.nextStepDue)
    return (
      <span className={styles.secondary}>{t("operations.partners.none")}</span>
    );
  const date = row.nextStepDue
    ? formatContractDate(row.nextStepDue, locale)
    : null;
  const overdue = row.nextStepDue !== null && row.nextStepDue < today;
  return (
    <span className={styles.cellStack}>
      {row.nextStep ? <span>{row.nextStep}</span> : null}
      {date ? (
        <span className={overdue ? styles.overdue : styles.secondary}>
          {overdue
            ? t("operations.partners.overdueOn", { date })
            : t("operations.partners.dueOn", { date })}
        </span>
      ) : null}
    </span>
  );
}

function Models({ row, t }: { row: PartnerSummary; t: Translator }) {
  if (!row.models.length)
    return (
      <span className={styles.secondary}>
        {t("operations.partners.notSet")}
      </span>
    );
  return (
    <span className={styles.tags}>
      {row.models.map((model) => (
        <Tag key={model}>{t(partnerModelLabels[model])}</Tag>
      ))}
    </span>
  );
}

/** The partner list at /internal/partners. */
export function PartnerList({
  t,
  locale,
  query,
  result,
  owners,
  today,
  canEdit,
  demo,
}: {
  t: Translator;
  locale: string;
  query: PartnerListQuery;
  result: PartnerListResult;
  owners: readonly PartnerOwnerOption[];
  today: string;
  canEdit: boolean;
  demo: boolean;
}) {
  const filtered = Boolean(
    query.q ||
    query.status ||
    query.model ||
    query.owner ||
    query.mine ||
    query.due,
  );
  const status = (row: PartnerSummary) => (
    <StatusBadge tone={partnerStatusTone[row.status]}>
      {t(partnerStatusLabels[row.status])}
    </StatusBadge>
  );
  const owner = (row: PartnerSummary) =>
    row.ownerName ?? t("operations.partners.unowned");
  return (
    <main className={styles.main} id="main-content">
      <PageHeader
        title={t("operations.partners.title")}
        description={t("operations.partners.description")}
        actions={
          <span className={styles.headerActions}>
            {canEdit ? (
              <Link
                className={buttonClassName({ variant: "primary" })}
                href="/internal/partners/new"
              >
                {t("operations.partners.new")}
              </Link>
            ) : null}
            {/* A route handler, not a page: a plain link downloads the file. */}
            <a
              className={buttonClassName({ variant: "secondary" })}
              href={partnerListHref(query, "export")}
              download
            >
              {t("operations.partners.export")}
            </a>
          </span>
        }
      />
      {demo ? (
        <InlineNotice tone="info" title={t("operations.partners.demo")} />
      ) : null}
      <PartnerFilters query={query} owners={owners} />
      {result.truncated ? (
        <InlineNotice
          tone="warning"
          title={t("operations.partners.truncated", {
            count: partnerListLimit,
          })}
        />
      ) : null}
      {result.rows.length === 0 ? (
        filtered ? (
          <EmptyState
            title={t("operations.partners.emptyFiltered.title")}
            description={t("operations.partners.emptyFiltered.description")}
          />
        ) : (
          <EmptyState
            title={t("operations.partners.empty.title")}
            description={t("operations.partners.empty.description")}
          />
        )
      ) : (
        <>
          <div className={styles.desktopOnly}>
            <Table
              caption={t("operations.partners.title")}
              captionHidden
              density="compact"
              headers={[
                t("operations.partners.column.partner"),
                t("operations.partners.column.status"),
                t("operations.partners.column.models"),
                t("operations.partners.column.terms"),
                t("operations.partners.column.owner"),
                t("operations.partners.column.nextStep"),
                t("operations.partners.column.openDeals"),
              ]}
              numericColumns={[6]}
              rowKeys={result.rows.map((row) => row.id)}
              rows={result.rows.map((row) => [
                <span key="name" className={styles.cellStack}>
                  <Link className={styles.rowLink} href={partnerHref(row.id)}>
                    {row.name}
                  </Link>
                  {row.region ? (
                    <span className={styles.secondary}>{row.region}</span>
                  ) : null}
                </span>,
                status(row),
                <Models key="models" row={row} t={t} />,
                headlineTerms(row, t),
                owner(row),
                <NextStep
                  key="next"
                  row={row}
                  today={today}
                  t={t}
                  locale={locale}
                />,
                row.openDeals,
              ])}
            />
          </div>
          <ul className={`${styles.mobileOnly} ${styles.mobileList}`}>
            {result.rows.map((row) => (
              <li className={styles.mobileCard} key={row.id}>
                <h2>
                  <Link href={partnerHref(row.id)}>{row.name}</Link>
                </h2>
                <span>{status(row)}</span>
                <dl className={styles.facts}>
                  <dt>{t("operations.partners.column.models")}</dt>
                  <dd>
                    <Models row={row} t={t} />
                  </dd>
                  <dt>{t("operations.partners.column.terms")}</dt>
                  <dd>{headlineTerms(row, t)}</dd>
                  <dt>{t("operations.partners.column.owner")}</dt>
                  <dd>{owner(row)}</dd>
                  <dt>{t("operations.partners.column.nextStep")}</dt>
                  <dd>
                    <NextStep row={row} today={today} t={t} locale={locale} />
                  </dd>
                  <dt>{t("operations.partners.column.openDeals")}</dt>
                  <dd>{row.openDeals}</dd>
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
