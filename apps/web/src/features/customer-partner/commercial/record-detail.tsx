import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import {
  ApplicationStatePanel,
  Breadcrumbs,
  buttonClassName,
} from "@clockwork/ui";

import { customerPartnerCopy } from "../copy";
import styles from "./commercial.module.css";
import type { CommercialRecord } from "./model";
import { PaymentHandoff } from "./payment-handoff";
import { validQuoteActions, type QuoteStatus } from "./workflow-model";
import { EvidenceUploadControl } from "@/src/features/experience-server/evidence-upload-control";
import { t } from "@/src/i18n/en";

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

/**
 * One rendering for every unreadable record.
 *
 * `loadCommercialRecord` resolves to `null` for a record that does not exist
 * and for one that belongs to another account, because the projection query
 * and its row-level policy cannot tell those apart either. This panel is
 * therefore written to carry no information about which of the two happened:
 * no requested identifier, no status word, no channel. Anything that varied
 * between the two cases would let a reader enumerate another tenant's
 * references by watching this page.
 */
function UnreadableRecord() {
  return (
    <main className={styles.main} id="main-content">
      <div className={styles.state} data-state="record-not-found">
        <ApplicationStatePanel
          state="empty"
          title={t("state.notFound.title")}
          description={t("state.notFound.description")}
          action={
            <Link
              className={buttonClassName({ variant: "secondary" })}
              href="/dashboard"
            >
              {t("action.returnHome")}
            </Link>
          }
        />
      </div>
    </main>
  );
}

/**
 * The payment handoff for an open invoice, bound to the invoice on screen.
 *
 * The panel states an amount and a due date and then opens a payment session;
 * those three have to come from one record or the reader confirms one invoice
 * and pays another. So it renders only when this record supplies its own
 * persisted identity and the route supplies the acting account.
 *
 * The refused set is exactly: an open invoice the reader may pay whose
 * projection carries no `aggregateId`, or one opened by a route that passes no
 * `accountId`. Neither happens for an invoice loaded through
 * `loadCommercialRecord`, which copies a non-null `aggregateId` off every
 * projection row, from a route that resolves the reader's account. A reader
 * without payment rights still gets the existing explanation, and a paid or
 * non-billing record is unaffected.
 */
function payableInvoice(
  record: CommercialRecord,
  accountId: string | undefined,
  canMutate: boolean,
): ReactNode {
  if (record.kind !== "billing" || record.status !== "open") return null;
  if (!canMutate)
    return (
      <section className={`${styles.panel} ${styles.section}`}>
        <h2>Payment access</h2>
        <p className={styles.description}>
          An account owner or billing role can prepare the secure payment
          handoff.
        </p>
      </section>
    );
  if (!accountId || !record.aggregateId)
    return (
      <section className={`${styles.panel} ${styles.section}`} role="alert">
        <h2>Payment unavailable</h2>
        <p className={styles.description}>
          This invoice cannot be paid from here until its persisted identity and
          your acting account both resolve. Nothing was charged.
        </p>
      </section>
    );
  return (
    <PaymentHandoff
      accountId={accountId}
      amountLabel={record.value}
      dueLabel={record.dateLabel}
      invoiceId={record.aggregateId}
    />
  );
}

export function CommercialRecordDetail({
  accountId,
  canMutate = false,
  record,
  actions,
}: {
  /**
   * The requested reference. Retained for the route's own use; deliberately
   * not rendered, so the unreadable-record state reads the same for a
   * reference that does not exist and one that belongs elsewhere.
   */
  id: string;
  /**
   * The account the route resolved for the reader. A payment session is opened
   * against an account and an invoice; only the route knows which account the
   * reader is acting for, so the surface is handed it rather than naming one.
   */
  accountId?: string;
  canMutate?: boolean;
  record: CommercialRecord | null;
  /**
   * Server-backed action for this record, supplied by the route so the panel
   * carries the route's own permission gate rather than a second guess at it.
   */
  actions?: ReactNode;
}) {
  if (!record) return <UnreadableRecord />;
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
          {payableInvoice(record, accountId, canMutate)}
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
