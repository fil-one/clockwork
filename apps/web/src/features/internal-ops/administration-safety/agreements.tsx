"use client";
import { useFormattingLocale, useTranslations } from "@/src/i18n/client";
import type { MessageId } from "@/src/i18n";

import { useMemo, useState, type ReactNode } from "react";

import { Table } from "@clockwork/ui";

import { formatSurfaceTimestamp } from "@/src/features/customer-partner/formatting";
import { formatDate } from "@/src/features/shared/format";

import {
  adminSafetyCopy,
  agreementExecutionLabels,
  agreementJurisdictionLabels,
  agreementStateLabels,
  agreementStateTones,
} from "./copy";
import type {
  AgreementJurisdiction,
  AgreementScan,
  AgreementVersionState,
  AgreementVersionView,
} from "./data";
import { buildReviewSummary, canDecide, type ReviewSummary } from "./policy";
import {
  AdministrationPage,
  HumanSelector,
  ReviewSummaryCard,
  StatusPill,
  TechnicalEvidence,
  styles,
} from "./ui";

const scanLabels: Readonly<Record<AgreementScan, MessageId>> = {
  hashMatch: "adminGovernance.agreements.scan.hashMatch",
  evidenceRequired: "adminGovernance.agreements.scan.evidenceRequired",
  futureActivation: "adminGovernance.agreements.scan.futureActivation",
};

const jurisdictions = Object.keys(
  agreementJurisdictionLabels,
) as AgreementJurisdiction[];
const states = Object.keys(agreementStateLabels) as AgreementVersionState[];

export function AgreementAdministration({
  roles,
  versions,
  scannedAt,
  publishAction,
  readOnly = false,
}: {
  roles: readonly string[];
  /** Template versions with their demo text resolved for this reader. */
  versions: readonly AgreementVersionView[];
  /** ISO timestamp of the version scan these rows come from. */
  scannedAt: string;
  readOnly?: boolean;
  /**
   * The authorized template publication workflow this review hands off to,
   * supplied by the route so it carries the route's own permission gate.
   */
  publishAction?: ReactNode;
}) {
  const t = useTranslations();
  const formattingLocale = useFormattingLocale();
  const [query, setQuery] = useState("");
  const [jurisdiction, setJurisdiction] = useState<
    AgreementJurisdiction | "all"
  >("all");
  const [state, setState] = useState<AgreementVersionState | "all">("all");
  const [selectedId, setSelectedId] = useState(
    versions.find((version) => version.state === "draft")?.id ??
      versions[0]?.id ??
      "",
  );
  const [reason, setReason] = useState("");
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const permitted = canDecide(roles, "legal");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return versions.filter(
      (version) =>
        (jurisdiction === "all" || version.jurisdiction === jurisdiction) &&
        (state === "all" || version.state === state) &&
        (!needle ||
          [
            version.label,
            version.type,
            version.version,
            t(agreementJurisdictionLabels[version.jurisdiction]),
            t(agreementExecutionLabels[version.execution]),
            t(scanLabels[version.scan]),
          ].some((value) => value.toLowerCase().includes(needle))),
    );
  }, [jurisdiction, query, state, t, versions]);
  const selected =
    versions.find((version) => version.id === selectedId) ?? versions[0];

  if (!selected) return null;

  const heading = adminSafetyCopy.agreements;
  const templateName = (version: AgreementVersionView) =>
    `${version.label} v${version.version}`;
  const technicalIdentifiers = [
    {
      label: t("adminGovernance.identifier.template"),
      value: selected.id,
    },
    {
      label: t("adminGovernance.identifier.textHash"),
      value: selected.textHash,
    },
  ];

  return (
    <AdministrationPage
      eyebrow={t(heading.eyebrow)}
      title={t(heading.title)}
      description={t(heading.description)}
    >
      <section
        className={styles.panel}
        aria-labelledby="agreement-versions-title"
      >
        <div className={styles.panelHeading}>
          <div>
            <h2 id="agreement-versions-title">
              {t("adminGovernance.agreements.scanHeading")}
            </h2>
            <p>
              {t("adminGovernance.agreements.scanMeta", {
                time: formatSurfaceTimestamp(scannedAt, {
                  locale: formattingLocale,
                  timeZone: "America/New_York",
                }),
              })}
            </p>
          </div>
          <StatusPill state={t("adminGovernance.upToDate")} tone="warning" />
        </div>
        <div
          className={styles.toolbar}
          role="search"
          aria-label={t("adminGovernance.agreements.filtersLabel")}
        >
          <label className={styles.field}>
            {t("adminGovernance.agreements.search")}
            <input
              type="search"
              value={query}
              placeholder={t("adminGovernance.agreements.searchPlaceholder")}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </label>
          <label className={styles.field}>
            {t("adminGovernance.agreements.jurisdiction")}
            <select
              value={jurisdiction}
              onChange={(event) =>
                setJurisdiction(
                  event.currentTarget.value as AgreementJurisdiction | "all",
                )
              }
            >
              <option value="all">{t("common.all")}</option>
              {jurisdictions.map((key) => (
                <option key={key} value={key}>
                  {t(agreementJurisdictionLabels[key])}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            {t("common.status")}
            <select
              value={state}
              onChange={(event) =>
                setState(
                  event.currentTarget.value as AgreementVersionState | "all",
                )
              }
            >
              <option value="all">{t("common.all")}</option>
              {states.map((key) => (
                <option key={key} value={key}>
                  {t(agreementStateLabels[key])}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className={styles.resultMeta} aria-live="polite">
          {t("common.join.labels", {
            first: t("adminGovernance.agreements.resultCount", {
              shown: filtered.length,
              count: versions.length,
            }),
            second: t("adminGovernance.agreements.sortedByEffective"),
          })}
        </p>
        <Table
          className={styles.scanTable ?? ""}
          caption={t("adminGovernance.agreements.tableCaption")}
          captionHidden
          density="compact"
          headers={[
            t("adminGovernance.agreements.column.template"),
            t("adminGovernance.agreements.version"),
            t("adminGovernance.agreements.jurisdiction"),
            t("adminGovernance.agreements.execution"),
            t("adminGovernance.agreements.effective"),
            t("common.status"),
            t("adminGovernance.agreements.column.scan"),
          ]}
          rowKeys={filtered.map((version) => version.id)}
          rows={filtered.map((version) => [
            <span className={styles.stackCell}>
              <strong>{version.label}</strong>
              <small>{version.type}</small>
            </span>,
            version.version,
            t(agreementJurisdictionLabels[version.jurisdiction]),
            t(agreementExecutionLabels[version.execution]),
            formatDate(version.effectiveOn, formattingLocale),
            <StatusPill
              state={t(agreementStateLabels[version.state])}
              tone={agreementStateTones[version.state]}
            />,
            <span className={styles.stackCell}>
              <strong>{t(scanLabels[version.scan])}</strong>
              <small>{t("adminGovernance.agreements.exactTextRetained")}</small>
            </span>,
          ])}
          emptyState={t("adminGovernance.agreements.noMatches")}
        />
      </section>

      <section
        className={styles.panel}
        aria-labelledby="agreement-review-title"
      >
        <div className={styles.panelHeading}>
          <div>
            <h2 id="agreement-review-title">
              {t("adminGovernance.agreements.reviewHeading")}
            </h2>
            <p>{t("adminGovernance.agreements.reviewIntro")}</p>
          </div>
          <StatusPill
            state={t(
              permitted
                ? "adminGovernance.agreements.legalAuthority"
                : "adminGovernance.readOnly",
            )}
            tone="warning"
          />
        </div>
        <form
          className={styles.panelBody}
          onSubmit={(event) => {
            event.preventDefault();
            setSummary(
              buildReviewSummary({
                entity: t("common.join.labels", {
                  first: templateName(selected),
                  second: t(agreementJurisdictionLabels[selected.jurisdiction]),
                }),
                impact: t("adminGovernance.agreements.review.impact"),
                evidence: [
                  t(scanLabels[selected.scan]),
                  t("adminGovernance.agreements.review.textHash", {
                    hash: selected.textHash,
                  }),
                  t("adminGovernance.agreements.review.executionMode", {
                    mode: t(agreementExecutionLabels[selected.execution]),
                  }),
                ],
                policyBasis: t("adminGovernance.agreements.review.policy"),
                downstreamEffect: t(
                  "adminGovernance.agreements.review.downstream",
                ),
                reason,
              }),
            );
          }}
        >
          <HumanSelector
            label={t("adminGovernance.agreements.templateSelector")}
            name="agreementTemplateId"
            options={versions.map((version) => ({
              id: version.id,
              label: templateName(version),
              description: t("common.join.labels", {
                first: t(agreementJurisdictionLabels[version.jurisdiction]),
                second: t(agreementStateLabels[version.state]),
              }),
            }))}
            value={selectedId}
            onChange={(id) => {
              if (id) setSelectedId(id);
              setReason("");
              setSummary(null);
            }}
          />
          <dl className={styles.metaGrid}>
            <div>
              <dt>{t("adminGovernance.agreements.version")}</dt>
              <dd>
                {t("common.join.labels", {
                  first: selected.version,
                  second: t(agreementStateLabels[selected.state]),
                })}
              </dd>
            </div>
            <div>
              <dt>{t("adminGovernance.agreements.effective")}</dt>
              <dd>{formatDate(selected.effectiveOn, formattingLocale)}</dd>
            </div>
            <div>
              <dt>{t("adminGovernance.agreements.approvalScan")}</dt>
              <dd>{t(scanLabels[selected.scan])}</dd>
            </div>
            <div>
              <dt>{t("adminGovernance.agreements.execution")}</dt>
              <dd>{t(agreementExecutionLabels[selected.execution])}</dd>
            </div>
          </dl>
          {!readOnly ? (
            <label className={styles.field}>
              {t("adminGovernance.agreements.counselReason")}
              <textarea
                value={reason}
                required
                minLength={8}
                placeholder={t(
                  "adminGovernance.agreements.counselReasonPlaceholder",
                )}
                onChange={(event) => {
                  setReason(event.currentTarget.value);
                  setSummary(null);
                }}
              />
            </label>
          ) : null}
          <TechnicalEvidence identifiers={technicalIdentifiers} />
          {readOnly ? (
            <div className={styles.roleNotice} role="note">
              <strong>{t("adminGovernance.agreements.demoReadOnly")}</strong>
              {t("adminGovernance.agreements.demoReadOnlyDetail")}
            </div>
          ) : !permitted ? (
            <div className={styles.roleNotice} role="note">
              <strong>
                {t("adminGovernance.agreements.legalAuthorityRequired")}
              </strong>
              {t("adminGovernance.agreements.legalAuthorityRequiredDetail")}
            </div>
          ) : null}
          {!readOnly ? (
            <div className={styles.actions}>
              <button
                className={styles.button}
                type="submit"
                disabled={!permitted}
              >
                {t("adminGovernance.agreements.reviewAction")}
              </button>
            </div>
          ) : null}
        </form>
      </section>

      {summary && !readOnly ? (
        <>
          <ReviewSummaryCard
            summary={summary}
            title={t("adminGovernance.agreements.summaryTitle")}
            identifiers={technicalIdentifiers}
          />
          <section className={styles.handoff} role="note">
            <strong>{t("adminGovernance.agreements.notPublished")}</strong>
            <p>{t("adminGovernance.agreements.handoff")}</p>
          </section>
        </>
      ) : null}

      {publishAction}
    </AdministrationPage>
  );
}
