import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { Breadcrumbs } from "@clockwork/ui";

import { customerPartnerCopy } from "../copy";
import styles from "./commercial.module.css";
import type { CommercialRecord } from "./model";
import { PaymentHandoff } from "./payment-handoff";
import { validQuoteActions, type QuoteStatus } from "./workflow-model";
import { EvidenceUploadControl } from "@/src/features/experience-server/evidence-upload-control";

function detailLabel(record: CommercialRecord) {
  if (record.kind === "agreements") return "Agreement detail";
  if (record.kind === "quotes") return "Quote detail";
  if (record.kind === "orders") return "Order detail";
  if (record.kind === "pocs") return "Proof-of-concept detail";
  if (record.kind === "billing") return "Invoice detail";
  return "Service detail";
}

function commercialSummary(record: CommercialRecord) {
  return [
    { label: "Record", value: record.title },
    { label: "Authoritative status", value: record.statusLabel },
    { label: record.valueLabel, value: record.value },
    { label: "Owner", value: record.owner },
    { label: "Term / timing", value: record.term },
    { label: "Projection version", value: record.version ?? "Unavailable" },
  ];
}

function artifactChain(record: CommercialRecord) {
  return [
    ["Persisted record", record.id],
    ["Projection version", record.version ?? "Unavailable"],
    ["Source update", record.dateLabel],
    ["Next valid task", record.nextAction],
  ];
}

/**
 * The forward step for a record.
 *
 * Every link carries the originating record so the destination opens against
 * it. Without that reference these land on an unfiltered collection and the
 * record the reader came from is lost.
 */
function nextStep(
  record: CommercialRecord,
): { href: Route; label: string } | null {
  const reference = encodeURIComponent(record.aggregateId ?? record.id);
  if (record.kind === "quotes") {
    const actions = validQuoteActions(record.status as QuoteStatus);
    if (actions.includes("create_order"))
      return {
        href: `/orders/accept?quote=${reference}` as Route,
        label: "Review resulting order",
      };
    if (actions.includes("edit"))
      return {
        href: `/quotes/new?revises=${reference}` as Route,
        label: "Create revised draft",
      };
    return null;
  }
  if (record.kind === "pocs")
    return {
      href: `/quotes/new?poc=${reference}` as Route,
      label: "Convert to a quote",
    };
  if (record.kind === "orders")
    return {
      href: `/amendments?order=${reference}` as Route,
      label: "Request an amendment",
    };
  if (record.kind === "agreements")
    return {
      href: `/agreements/execute?agreement=${reference}` as Route,
      label: "Execute a new agreement",
    };
  if (record.kind === "services")
    return {
      href: `/account/offboarding?service=${reference}` as Route,
      label: "Request offboarding",
    };
  return null;
}

function DetailActions({
  record,
  canMutate,
}: {
  record: CommercialRecord;
  canMutate: boolean;
}) {
  const step = nextStep(record);
  if (!step) return null;
  if (!canMutate)
    return (
      <span className={styles.muted}>
        An owner or administrator can take the next action.
      </span>
    );
  return (
    <Link className={styles.primary} href={step.href}>
      {step.label}
    </Link>
  );
}

export function CommercialRecordDetail({
  id,
  canMutate = false,
  record,
  actions,
}: {
  id: string;
  canMutate?: boolean;
  record: CommercialRecord | null;
  /**
   * Server-backed action for this record, supplied by the route so the panel
   * carries the route's own permission gate rather than a second guess at it.
   */
  actions?: ReactNode;
}) {
  if (!record) {
    return (
      <main className={styles.main} id="main-content">
        <section className={styles.state} role="alert">
          <h1>Record not found</h1>
          <p>
            The requested commercial record is unavailable or outside your
            account. Requested reference: {id}.
          </p>
          <Link className={styles.secondary} href="/dashboard">
            Return to dashboard
          </Link>
        </section>
      </main>
    );
  }
  const backHref = (
    record.kind === "services" ? "/services" : `/${record.kind}`
  ) as Route;
  const summary = commercialSummary(record);
  const chain = artifactChain(record);
  return (
    <main className={styles.main} id="main-content">
      <Breadcrumbs
        items={[
          {
            label:
              record.kind === "pocs"
                ? "POCs"
                : record.kind[0]?.toUpperCase() + record.kind.slice(1),
            href: backHref,
          },
          { label: record.title },
        ]}
        renderLink={(href, label) => <Link href={href as Route}>{label}</Link>}
      />

      <header className={styles.detailHeader}>
        <div>
          <p className={styles.eyebrow}>{detailLabel(record)}</p>
          <h1>
            {record.title}
            {record.version ? ` · version ${record.version}` : ""}
          </h1>
          <p className={styles.description}>{record.description}</p>
        </div>
        <div className={styles.actionGroup}>
          <span className={`${styles.badge} ${styles[record.tone]}`}>
            {record.statusLabel}
          </span>
          <DetailActions canMutate={canMutate} record={record} />
          {record.kind === "agreements" && record.aggregateId ? (
            <Link
              className={styles.primary}
              href={
                `/signing/redirect?agreementId=${encodeURIComponent(record.aggregateId)}` as Route
              }
            >
              Sign this agreement
            </Link>
          ) : null}
        </div>
      </header>

      <section
        className={styles.nextAction}
        aria-labelledby="next-action-title"
      >
        <p id="next-action-title">{customerPartnerCopy.common.nextAction}</p>
        <strong>{record.nextAction}</strong>
      </section>

      <div className={styles.detailGrid}>
        <div className={styles.stack}>
          <section
            className={`${styles.panel} ${styles.section}`}
            aria-labelledby="commercial-summary-title"
          >
            <h2 id="commercial-summary-title">
              {customerPartnerCopy.common.commercialSummary}
            </h2>
            <dl className={styles.definitionGrid}>
              {summary.map((item) => (
                <div key={item.label}>
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section
            className={`${styles.panel} ${styles.section}`}
            aria-labelledby="term-title"
          >
            <h2 id="term-title">{customerPartnerCopy.common.termState}</h2>
            <p className={styles.description}>{record.term}</p>
          </section>
          <section
            className={`${styles.panel} ${styles.section}`}
            aria-labelledby="artifact-title"
          >
            <h2 id="artifact-title">
              {customerPartnerCopy.common.artifactChain}
            </h2>
            <ol className={styles.chain}>
              {chain.map(([label, value]) => (
                <li key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </li>
              ))}
            </ol>
          </section>
          <section
            className={`${styles.panel} ${styles.section}`}
            aria-labelledby="documents-title"
          >
            <h2 id="documents-title">{customerPartnerCopy.common.documents}</h2>
            <ul className={styles.reviewList}>
              <li>
                <span>Primary artifact</span>
                <strong>
                  {record.title}
                  {record.version ? ` · version ${record.version}` : ""}
                </strong>
              </li>
              <li>
                <span>Availability</span>
                <strong>Visible to authorized account roles</strong>
              </li>
            </ul>
            <p className={styles.muted}>
              Downloads are shown only when a document provider supplies a safe,
              authorized link.
            </p>
          </section>
        </div>

        <div className={styles.stack}>
          {actions}
          {record.kind === "billing" &&
          record.status === "open" &&
          canMutate ? (
            <PaymentHandoff />
          ) : record.kind === "billing" && record.status === "open" ? (
            <section className={`${styles.panel} ${styles.section}`}>
              <h2>Payment access</h2>
              <p className={styles.description}>
                An account owner or billing role can prepare the secure payment
                handoff.
              </p>
            </section>
          ) : null}
          <section
            className={`${styles.panel} ${styles.section}`}
            aria-labelledby="audit-title"
          >
            <h2 id="audit-title">{customerPartnerCopy.common.auditEvidence}</h2>
            <ol className={styles.audit}>
              <li>
                <span>{record.dateLabel}</span>
                <strong>Record state synchronized</strong>
              </li>
              <li>
                <span>Actor</span>
                <strong>{record.owner}</strong>
              </li>
            </ol>
            <details className={styles.technical}>
              <summary>{customerPartnerCopy.common.technicalDetails}</summary>
              <dl className={styles.definitionGrid}>
                <div>
                  <dt>Record identifier</dt>
                  <dd>
                    <code>{record.id}</code>
                  </dd>
                </div>
                <div>
                  <dt>Row version</dt>
                  <dd>
                    <code>{record.version ?? "Unavailable"}</code>
                  </dd>
                </div>
              </dl>
            </details>
          </section>
          {record.aggregateId && record.kind === "agreements" ? (
            <EvidenceUploadControl
              journey="customer_paper"
              targetId={record.aggregateId}
              kind="agreement"
              label="Attach customer agreement paper"
            />
          ) : null}
          {record.aggregateId && record.kind === "pocs" ? (
            <EvidenceUploadControl
              journey="poc"
              targetId={record.aggregateId}
              kind="acceptance"
              label="Attach POC acceptance or result evidence"
            />
          ) : null}
        </div>
      </div>
    </main>
  );
}
