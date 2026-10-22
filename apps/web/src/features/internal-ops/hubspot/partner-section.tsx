import type { Route } from "next";
import Link from "next/link";
import { Fragment } from "react";

import {
  InlineNotice,
  StatusBadge,
  Table,
  buttonClassName,
} from "@clockwork/ui";

import type { Translator } from "@/src/i18n";

import { LocalTimestamp } from "../local-timestamp";
import {
  formatHubSpotAmount,
  formatHubSpotDate,
  handoffHref,
  hubspotErrorMessage,
  hubspotPickerPath,
  importStatusLabels,
  importStatusTone,
} from "./model";
import type { PartnerHubSpotView } from "./server";
import styles from "./hubspot.module.css";

/**
 * The HubSpot part of a partner page, beside the Commerce sections it never
 * replaces: what the partner is linked to, what HubSpot says now (read, never
 * written into Commerce fields), the deals associated with the company, and
 * every import. Association with a deal is not sourcing or credit.
 */
export function PartnerHubSpotSection({
  t,
  locale,
  partnerId,
  view,
  canEdit,
}: {
  t: Translator;
  locale: string;
  partnerId: string;
  view: PartnerHubSpotView | null;
  canEdit: boolean;
}) {
  if (!view || (!view.link && !view.imports.length))
    return canEdit && view ? (
      <section className={styles.card} aria-labelledby="partner-hubspot">
        <div className={styles.cardHeading}>
          <h2 id="partner-hubspot">{t("operations.hubspot.section.title")}</h2>
          <Link
            className={buttonClassName({ variant: "secondary" })}
            href={`${hubspotPickerPath}?partner=${partnerId}` as Route}
          >
            {t("operations.hubspot.section.link")}
          </Link>
        </div>
        <p className={styles.muted}>
          {t("operations.hubspot.section.notLinked")}
        </p>
      </section>
    ) : null;
  const { link, live, imports } = view;
  return (
    <section className={styles.card} aria-labelledby="partner-hubspot">
      <div className={styles.cardHeading}>
        <h2 id="partner-hubspot">{t("operations.hubspot.section.title")}</h2>
        <div className={styles.actions}>
          {live.kind === "ready" ? (
            <a
              className={buttonClassName({ variant: "quiet" })}
              href={live.companyUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              {t("operations.hubspot.openInHubSpot")}
            </a>
          ) : null}
          {link && canEdit && live.kind === "ready" ? (
            <Link
              className={buttonClassName({ variant: "secondary" })}
              href={handoffHref({
                company: link.companyId,
                partner: partnerId,
              })}
            >
              {t("operations.hubspot.reviewUpdates")}
            </Link>
          ) : null}
        </div>
      </div>
      {link ? (
        <dl className={styles.facts}>
          <dt>{t("operations.hubspot.section.company")}</dt>
          <dd>
            <span className={styles.source}>
              {live.kind === "ready" ? live.companyName : link.companyName}
            </span>
          </dd>
          <dt>{t("operations.hubspot.section.linkedBy")}</dt>
          <dd>
            {link.createdByName} ·{" "}
            <LocalTimestamp value={link.createdAt} locale={locale} />
          </dd>
          {live.kind === "ready" ? (
            <>
              <dt>{t("operations.hubspot.section.checked")}</dt>
              <dd>
                <LocalTimestamp value={live.checkedAt} locale={locale} />
                {live.stale ? (
                  <>
                    {" "}
                    <StatusBadge tone="warning">
                      {t("operations.hubspot.stale")}
                    </StatusBadge>
                  </>
                ) : null}
              </dd>
              <dt>{t("operations.hubspot.section.updated")}</dt>
              <dd>
                {live.updatedAt ? (
                  <LocalTimestamp value={live.updatedAt} locale={locale} />
                ) : (
                  t("operations.hubspot.notSet")
                )}
              </dd>
            </>
          ) : null}
        </dl>
      ) : null}
      {live.kind === "ready" && live.changedFields > 0 ? (
        <InlineNotice
          tone="info"
          title={t("operations.hubspot.section.changed", {
            count: live.changedFields,
          })}
          description={t("operations.hubspot.section.changedBody")}
          action={
            link && canEdit ? (
              <Link
                className={buttonClassName({ variant: "secondary" })}
                href={handoffHref({
                  company: link.companyId,
                  partner: partnerId,
                })}
              >
                {t("operations.hubspot.reviewUpdates")}
              </Link>
            ) : undefined
          }
        />
      ) : null}
      {live.kind === "archived" ? (
        <InlineNotice
          tone="warning"
          title={t("operations.hubspot.state.archivedTitle")}
          description={t("operations.hubspot.section.archivedBody")}
        />
      ) : null}
      {live.kind === "unavailable" ? (
        <InlineNotice
          tone="offline"
          title={t("operations.hubspot.section.liveUnavailable")}
          description={t(hubspotErrorMessage(live.code))}
        />
      ) : null}
      {live.kind === "ready" && live.values.length ? (
        <details>
          <summary>{t("operations.hubspot.section.current")}</summary>
          <dl className={styles.facts}>
            {live.values.map((value) => (
              <Fragment key={value.label}>
                <dt>{value.label}</dt>
                <dd>{value.value ?? t("operations.hubspot.notSet")}</dd>
              </Fragment>
            ))}
          </dl>
        </details>
      ) : null}
      {live.kind === "ready" ? (
        <div className={styles.card}>
          <h3>{t("operations.hubspot.section.dealsTitle")}</h3>
          <p className={styles.secondary}>
            {t("operations.hubspot.section.dealsDisclaimer")}
          </p>
          {live.deals.length ? (
            <Table
              caption={t("operations.hubspot.section.dealsTitle")}
              captionHidden
              density="compact"
              headers={[
                t("operations.hubspot.pipeline.deal"),
                t("operations.hubspot.deal.stage"),
                t("operations.hubspot.deal.amount"),
                t("operations.hubspot.deal.close"),
              ]}
              rowKeys={live.deals.map((deal) => deal.id)}
              numericColumns={[2]}
              rows={live.deals.map((deal) => [
                <a
                  key="name"
                  href={deal.url}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {deal.name}
                </a>,
                deal.stageLabel ?? t("operations.hubspot.notSet"),
                deal.amount && deal.currency
                  ? formatHubSpotAmount(deal.amount, deal.currency, locale)
                  : t("operations.hubspot.notSet"),
                formatHubSpotDate(deal.closeDate, locale) ??
                  t("operations.hubspot.notSet"),
              ])}
            />
          ) : (
            <p className={styles.muted}>
              {t("operations.hubspot.section.noDeals")}
            </p>
          )}
        </div>
      ) : null}
      <div className={styles.card}>
        <h3>{t("operations.hubspot.section.history")}</h3>
        {imports.length ? (
          <ul className={styles.list}>
            {imports.map((record) => (
              <li key={record.id}>
                <div className={styles.rowHeading}>
                  <Link
                    className={styles.rowLink}
                    href={
                      `/internal/partners/${partnerId}?handoff=${record.id}#hubspot-receipt` as Route
                    }
                  >
                    {t(
                      record.createdPartner
                        ? "operations.hubspot.section.importCreated"
                        : "operations.hubspot.section.importUpdated",
                      { name: record.snapshot.company.name },
                    )}
                  </Link>
                  <StatusBadge tone={importStatusTone[record.status]}>
                    {t(importStatusLabels[record.status])}
                  </StatusBadge>
                </div>
                <span className={styles.secondary}>
                  {record.createdByName} ·{" "}
                  <LocalTimestamp value={record.createdAt} locale={locale} />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.muted}>
            {t("operations.hubspot.section.noImports")}
          </p>
        )}
      </div>
    </section>
  );
}
