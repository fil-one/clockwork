import { ProjectionActionButtons } from "./projection-action-buttons";
import Link from "next/link";
import type { Route } from "next";
import { EvidenceUploadControl } from "./evidence-upload-control";
import { getRouteRoles } from "@/src/features/shell/route-session";
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

function scalarEntries(record: ProjectionRecord) {
  return Object.entries(record.data).filter(
    ([key, value]) =>
      key !== "allowedActions" &&
      ["string", "number", "boolean"].includes(typeof value),
  );
}

function text(record: ProjectionRecord, key: string): string | undefined {
  const value = record.data[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function humanLabel(value: string): string {
  const spaced = value.replaceAll(/([A-Z_])/g, " $1").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function isCommercialDecision(
  audience: ExperienceAudience,
  channel: ProjectionChannel,
): channel is "quotes" | "orders" {
  return (
    audience === "customer" && (channel === "quotes" || channel === "orders")
  );
}

function commercialFacts(
  record: ProjectionRecord,
  channel: "quotes" | "orders",
): readonly { label: string; value: string }[] {
  return [
    {
      label: text(record, "valueLabel") ?? "Commercial value",
      value: text(record, "value") ?? "Not supplied",
    },
    {
      label: channel === "quotes" ? "Quote term" : "Service term",
      value: text(record, "term") ?? "Not supplied",
    },
    {
      label: "Timing",
      value: text(record, "dateLabel") ?? "Not supplied",
    },
    {
      label: "Owner",
      value: text(record, "owner") ?? "Not assigned",
    },
  ];
}

function promiseChain(channel: "quotes" | "orders") {
  return channel === "quotes"
    ? [
        ["Required upstream", "Agreement and account authority"],
        ["Current decision", "Quote scope, price, and expiry"],
        ["Follows acceptance", "Order commitment"],
      ]
    : [
        ["Authoritative input", "Accepted quote"],
        ["Current decision", "Order commitment and service timing"],
        ["Authoritative result", "Provisioning and service state"],
      ];
}

function tone(record: ProjectionRecord): string {
  const value = text(record, "tone");
  return ["success", "warning", "danger"].includes(value ?? "")
    ? (value as string)
    : "neutral";
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
}: {
  audience: ExperienceAudience;
  channel: ProjectionChannel;
  title: string;
  description: string;
  recordKey?: string;
}) {
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
        <p className={styles.context}>
          {audience === "internal"
            ? "Operator"
            : audience === "partner"
              ? "Partner"
              : "Customer"}{" "}
          workspace
        </p>
        <h1>{title}</h1>
        <p className={styles.description}>{description}</p>
        <p
          className={`${styles.freshness} ${projection.stale ? styles.stale : ""}`}
          role={projection.stale ? "alert" : "status"}
        >
          {projection.stale
            ? "Source refresh is overdue"
            : "Source projection is current"}
          <time className="sr-only" dateTime={projection.generatedAt}>
            {projection.generatedAt}
          </time>
        </p>
      </header>

      {commercial ? (
        <ol
          aria-label="Commercial promise chain"
          className={styles.promiseChain}
        >
          {promiseChain(channel).map(([step, meaning], index) => (
            <li aria-current={index === 1 ? "step" : undefined} key={step}>
              <span>{step}</span>
              <strong>{meaning}</strong>
            </li>
          ))}
        </ol>
      ) : null}

      {visibleRecords.length === 0 ? (
        <section className={styles.emptyState} role="alert">
          <h2>{recordKey ? "Record unavailable" : "No records available"}</h2>
          <p>
            The record is missing or outside the authenticated account scope. No
            action was taken.
          </p>
        </section>
      ) : (
        <section
          aria-label={
            commercial ? `${humanLabel(channel)} decision ledger` : title
          }
          className={styles.recordLedger}
        >
          <header className={styles.ledgerHeader}>
            <div>
              <h2>
                {commercial
                  ? channel === "quotes"
                    ? "Choose the commercial record"
                    : "Review persisted commitments"
                  : "Authorized records"}
              </h2>
              <p>
                {visibleRecords.length}{" "}
                {visibleRecords.length === 1 ? "record" : "records"} · server
                projection
              </p>
            </div>
            {commercial ? (
              <p className={styles.ledgerBoundary}>
                Actions bind the displayed record and optimistic version.
              </p>
            ) : null}
          </header>

          <div className={styles.recordList}>
            {visibleRecords.map((record) => (
              <article className={styles.record} key={record.id}>
                <header className={styles.recordHeader}>
                  <div>
                    <p className={styles.recordReference}>
                      Reference {record.recordKey} · version {record.version}
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
                      {text(record, "statusLabel")}
                      {text(record, "risk")
                        ? ` · ${humanLabel(text(record, "risk") as string)} risk`
                        : ""}
                    </p>
                  ) : null}
                </header>

                <dl className={styles.factLedger}>
                  {(commercial
                    ? commercialFacts(record, channel)
                    : scalarEntries(record).map(([key, value]) => ({
                        label: humanLabel(key),
                        value: String(value),
                      }))
                  ).map((fact) => (
                    <div key={fact.label}>
                      <dt>{fact.label}</dt>
                      <dd>{fact.value}</dd>
                    </div>
                  ))}
                </dl>

                <div className={styles.recordDecision}>
                  <div>
                    <p>Next binding step</p>
                    <strong>
                      {text(record, "nextAction") ?? "Review record evidence"}
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
                        Sign this authorized agreement
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
                  <summary>Technical projection evidence</summary>
                  <p>
                    Aggregate {record.aggregateType} · {record.aggregateId}
                  </p>
                  <p>Source updated {record.sourceUpdatedAt}</p>
                </details>
              </article>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
