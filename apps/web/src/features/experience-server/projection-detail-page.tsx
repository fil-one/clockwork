import { getFormattingLocale, getTranslations } from "@/src/i18n/server";
import type { MessageId, Translator } from "@/src/i18n";
import { richText } from "@/src/i18n/rich";
import { EmptyState } from "@clockwork/ui";

import { ProjectionActionButtons } from "./projection-action-buttons";
import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import { EvidenceUploadControl } from "./evidence-upload-control";
import { getRouteRoles } from "@/src/features/shell/route-session";
import { formatOperationalTimestamp } from "@/src/features/internal-ops/presentation";
import styles from "./projection-detail-page.module.css";
import {
  ArtifactDeliveryList,
  type ProjectedArtifact,
} from "./artifact-delivery-list";
import {
  artifactKinds,
  type ArtifactKind,
  type ExperienceAudience,
  type ProjectionChannel,
  type ProjectionRecord,
} from "./model";
import { loadPortalRecords } from "./portal-view-loader";

function label(record: ProjectionRecord): string {
  for (const key of ["title", "name", "label", "account"]) {
    const value = record.data[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return record.recordKey;
}

function allowedActions(record: ProjectionRecord): readonly string[] {
  return Array.isArray(record.data.allowedActions)
    ? record.data.allowedActions.filter(
        (item): item is string => typeof item === "string",
      )
    : [];
}

/**
 * Keys already shown elsewhere on the record card (header, status chip, next
 * step) or that exist only for sorting and styling. Every other scalar the
 * projection carries is listed in the fact ledger, so nothing the record holds
 * is hidden from an operator.
 */
const presentedElsewhere = new Set([
  "allowedActions",
  "id",
  "kind",
  "title",
  "name",
  "label",
  "account",
  "description",
  "status",
  "statusLabel",
  "tone",
  "risk",
  "nextAction",
  "nextActionHref",
  "href",
  "valueSort",
  "updatedLabel",
]);

/** Facts the product names, in reading order, with their labels. */
const namedFacts: readonly {
  key: string;
  label: (record: ProjectionRecord, t: Translator) => string;
}[] = [
  { key: "reference", label: (_, t) => t("common.referenceLabel") },
  { key: "owner", label: (_, t) => t("common.owner") },
  {
    key: "value",
    label: (record, t) =>
      text(record, "valueLabel") ?? t("experience.detail.fact.value"),
  },
  { key: "term", label: (_, t) => t("experience.detail.fact.term") },
  { key: "dateLabel", label: (_, t) => t("experience.detail.fact.timing") },
];

interface Fact {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  /** A projection field the product has no label for: its name is shown as the code it is. */
  readonly code?: true;
}

function contextFacts(record: ProjectionRecord): readonly Fact[] {
  if (!Array.isArray(record.data.context)) return [];
  return record.data.context.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const { label, value } = entry as Record<string, unknown>;
    return typeof label === "string" &&
      label.trim() &&
      typeof value === "string" &&
      value.trim()
      ? [{ key: `context:${index}`, label, value }]
      : [];
  });
}

/**
 * The generic ledger for records outside the commercial decision surfaces.
 * Named facts carry translated labels; context entries carry the labels their
 * source wrote; any remaining scalar is an unmodelled projection field and is
 * shown under its field name, marked as code, rather than dropped.
 */
function recordFacts(record: ProjectionRecord, t: Translator): readonly Fact[] {
  const named = namedFacts.flatMap(({ key, label }) => {
    const value = text(record, key);
    return value ? [{ key, label: label(record, t), value }] : [];
  });
  const handled = new Set([
    ...presentedElsewhere,
    "valueLabel",
    "context",
    ...namedFacts.map(({ key }) => key),
  ]);
  const unmodelled = Object.entries(record.data).flatMap(([key, value]) =>
    !handled.has(key) &&
    ["string", "number", "boolean"].includes(typeof value) &&
    String(value).trim()
      ? [{ key, label: key, value: String(value), code: true as const }]
      : [],
  );
  return [...named, ...contextFacts(record), ...unmodelled];
}

function text(record: ProjectionRecord, key: string): string | undefined {
  const value = record.data[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

const riskChips: Readonly<Record<string, MessageId>> = {
  low: "risk.chip.low",
  medium: "risk.chip.medium",
  high: "risk.chip.high",
};

function isCommercialDecision(
  audience: ExperienceAudience,
  channel: ProjectionChannel,
): channel is "quotes" | "orders" {
  return (
    audience === "customer" && (channel === "quotes" || channel === "orders")
  );
}

/** A fact the record does not carry is left out rather than shown as absent. */
function commercialFacts(
  record: ProjectionRecord,
  channel: "quotes" | "orders",
  t: Translator,
): readonly Fact[] {
  return [
    {
      key: "value",
      label: text(record, "valueLabel") ?? t("experience.detail.fact.value"),
      value: text(record, "value"),
    },
    {
      key: "term",
      label:
        channel === "quotes"
          ? t("experience.detail.fact.quoteTerm")
          : t("experience.detail.fact.serviceTerm"),
      value: text(record, "term"),
    },
    {
      key: "dateLabel",
      label: t("experience.detail.fact.timing"),
      value: text(record, "dateLabel"),
    },
    { key: "owner", label: t("common.owner"), value: text(record, "owner") },
  ].filter((fact): fact is Fact => fact.value !== undefined);
}

function promiseChain(
  channel: "quotes" | "orders",
): readonly (readonly [MessageId, MessageId])[] {
  return channel === "quotes"
    ? [
        [
          "experience.detail.chain.requiredUpstream",
          "experience.detail.chain.agreementAuthority",
        ],
        [
          "experience.detail.chain.currentDecision",
          "experience.detail.chain.quoteScope",
        ],
        [
          "experience.detail.chain.followsAcceptance",
          "experience.detail.chain.orderCommitment",
        ],
      ]
    : [
        [
          "experience.detail.chain.authoritativeInput",
          "experience.detail.chain.acceptedQuote",
        ],
        [
          "experience.detail.chain.currentDecision",
          "experience.detail.chain.orderTiming",
        ],
        [
          "experience.detail.chain.authoritativeResult",
          "experience.detail.chain.serviceState",
        ],
      ];
}

const workspaceLabels: Readonly<Record<ExperienceAudience, MessageId>> = {
  internal: "experience.workspace.internal",
  partner: "experience.workspace.partner",
  customer: "experience.workspace.customer",
};

function tone(record: ProjectionRecord): string {
  const value = text(record, "tone");
  return ["success", "warning", "danger"].includes(value ?? "")
    ? (value as string)
    : "neutral";
}

/** The status the source wrote, with the risk level from the closed set. */
function statusChip(record: ProjectionRecord, t: Translator): string {
  const status = text(record, "statusLabel") as string;
  const risk = riskChips[text(record, "risk") ?? ""];
  return risk
    ? t("common.join.labels", { first: status, second: t(risk) })
    : status;
}

function artifacts(record: ProjectionRecord): readonly ProjectedArtifact[] {
  if (!Array.isArray(record.data.artifacts)) return [];
  return record.data.artifacts.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const item = value as Record<string, unknown>;
    const kind = item.kind;
    const id = item.id;
    const state = item.state;
    const label = item.label;
    if (
      typeof kind !== "string" ||
      !artifactKinds.includes(kind as ArtifactKind) ||
      typeof id !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(id) ||
      typeof label !== "string" ||
      (state !== "stored" && state !== "pending" && state !== "missing")
    )
      return [];
    return [{ kind: kind as ArtifactKind, id, label, state }];
  });
}

export async function ProjectionDetailPage({
  audience,
  channel,
  title,
  description,
  recordKey,
  actions,
  supporting,
}: {
  audience: ExperienceAudience;
  channel: ProjectionChannel;
  title: string;
  description: string;
  recordKey?: string;
  /**
   * Server-backed action for this surface, supplied by the route so the panel
   * carries the route's own permission gate rather than a second guess at it.
   */
  actions?: ReactNode;
  /** Read-only evidence the route adds beneath the records, such as a derivation. */
  supporting?: ReactNode;
}) {
  const t = await getTranslations();
  const formattingLocale = await getFormattingLocale();
  const [projection, roles] = await Promise.all([
    loadPortalRecords(audience, channel),
    getRouteRoles(audience),
  ]);
  const records = recordKey
    ? projection.records.filter((record) => record.recordKey === recordKey)
    : projection.records;
  const commercial = isCommercialDecision(audience, channel);
  const visibleRecords = commercial
    ? [...records].sort(
        (left, right) =>
          Number(allowedActions(right).length > 0) -
          Number(allowedActions(left).length > 0),
      )
    : records;
  return (
    <main className={styles.main} id="main-content">
      <header className={styles.pageHeader}>
        <p className={styles.context}>{t(workspaceLabels[audience])}</p>
        <h1>{title}</h1>
        <p className={styles.description}>{description}</p>
        <p
          className={`${styles.freshness} ${projection.stale ? styles.stale : ""}`}
          role={projection.stale ? "alert" : "status"}
        >
          {projection.stale
            ? t("experience.detail.freshness.stale")
            : t("experience.detail.freshness.current")}
          <span className="sr-only">
            {" "}
            {richText(t, "common.asOf", {
              time: (
                <time dateTime={projection.generatedAt}>
                  {formatOperationalTimestamp(
                    projection.generatedAt,
                    formattingLocale,
                  )}
                </time>
              ),
            })}
          </span>
        </p>
      </header>

      {commercial ? (
        <ol
          aria-label={t("experience.detail.chain.label")}
          className={styles.promiseChain}
        >
          {promiseChain(channel).map(([step, meaning], index) => (
            <li aria-current={index === 1 ? "step" : undefined} key={step}>
              <span>{t(step)}</span>
              <strong>{t(meaning)}</strong>
            </li>
          ))}
        </ol>
      ) : null}

      {actions}

      {visibleRecords.length === 0 ? (
        <EmptyState
          title={
            recordKey
              ? t("experience.detail.empty.missing.title")
              : t("experience.detail.empty.none.title")
          }
          description={
            recordKey
              ? t("experience.detail.empty.missing.description")
              : t("experience.detail.empty.none.description")
          }
        />
      ) : (
        <section
          aria-label={
            commercial
              ? t(
                  channel === "quotes"
                    ? "experience.detail.ledger.quotes"
                    : "experience.detail.ledger.orders",
                )
              : title
          }
          className={styles.recordLedger}
        >
          <header className={styles.ledgerHeader}>
            <div>
              <h2>
                {commercial
                  ? channel === "quotes"
                    ? t("experience.detail.heading.quotes")
                    : t("experience.detail.heading.orders")
                  : t("experience.detail.heading.records")}
              </h2>
              <p>
                {t("experience.detail.count", {
                  count: visibleRecords.length,
                })}
              </p>
            </div>
            {commercial ? (
              <p className={styles.ledgerBoundary}>
                {t("experience.detail.boundary")}
              </p>
            ) : null}
          </header>

          <div className={styles.recordList}>
            {visibleRecords.map((record) => (
              <article className={styles.record} key={record.id}>
                <header className={styles.recordHeader}>
                  <div>
                    <p className={styles.recordReference}>
                      {t("experience.detail.referenceVersion", {
                        reference: record.recordKey,
                        version: record.version,
                      })}
                    </p>
                    <h3>{label(record)}</h3>
                    {text(record, "description") ? (
                      <p className={styles.recordDescription}>
                        {text(record, "description")}
                      </p>
                    ) : null}
                  </div>
                  {text(record, "statusLabel") ? (
                    <p
                      className={`${styles.recordStatus} ${styles[tone(record)]}`}
                    >
                      {statusChip(record, t)}
                    </p>
                  ) : null}
                </header>

                <dl className={styles.factLedger}>
                  {(commercial
                    ? commercialFacts(record, channel, t)
                    : recordFacts(record, t)
                  ).map((fact) => (
                    <div key={fact.key}>
                      <dt>
                        {fact.code ? <code>{fact.label}</code> : fact.label}
                      </dt>
                      <dd>{fact.value}</dd>
                    </div>
                  ))}
                </dl>

                <div className={styles.recordDecision}>
                  <div>
                    <p>{t("experience.detail.nextStep")}</p>
                    <strong>
                      {text(record, "nextAction") ??
                        t("experience.detail.nextStep.fallback")}
                    </strong>
                  </div>
                  <div className={styles.recordActions}>
                    <ProjectionActionButtons
                      audience={audience}
                      channel={channel}
                      recordKey={record.recordKey}
                      projectionId={record.id}
                      version={record.version}
                      actions={allowedActions(record)}
                      roles={roles}
                    />
                  </div>
                </div>

                <div className={styles.recordEvidence}>
                  <ArtifactDeliveryList artifacts={artifacts(record)} />
                  {audience === "customer" && channel === "agreements" ? (
                    <>
                      <Link
                        href={
                          `/signing/redirect?agreementId=${encodeURIComponent(record.aggregateId)}` as Route
                        }
                      >
                        {t("experience.detail.sign")}
                      </Link>
                      <EvidenceUploadControl
                        journey="customer_paper"
                        targetId={record.aggregateId}
                        kind="agreement"
                      />
                    </>
                  ) : audience === "customer" && channel === "pocs" ? (
                    <EvidenceUploadControl
                      journey="poc"
                      targetId={record.aggregateId}
                      kind="acceptance"
                    />
                  ) : audience === "customer" && channel === "procurement" ? (
                    <EvidenceUploadControl
                      journey="procurement"
                      targetId={record.aggregateId}
                      kind="approval"
                    />
                  ) : audience === "internal" && channel === "approvals" ? (
                    <EvidenceUploadControl
                      journey="approval"
                      targetId={record.aggregateId}
                      kind="approval"
                    />
                  ) : audience === "internal" && channel === "queues" ? (
                    <EvidenceUploadControl
                      journey="exception"
                      targetId={record.aggregateId}
                      kind="screening"
                    />
                  ) : null}
                </div>

                <details className={styles.technical}>
                  <summary>{t("common.auditEvidence")}</summary>
                  <p>
                    {t("experience.detail.systemRecord", {
                      reference: record.recordKey,
                    })}
                  </p>
                  <p>
                    {richText(t, "common.updatedAt", {
                      time: (
                        <time dateTime={record.sourceUpdatedAt}>
                          {formatOperationalTimestamp(
                            record.sourceUpdatedAt,
                            formattingLocale,
                          )}
                        </time>
                      ),
                    })}
                  </p>
                </details>
              </article>
            ))}
          </div>
        </section>
      )}

      {supporting}
    </main>
  );
}
