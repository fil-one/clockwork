import { getTranslations } from "@/src/i18n/server";
import { use } from "react";
import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import {
  ApplicationStatePanel,
  Breadcrumbs,
  Timeline,
  buttonClassName,
} from "@clockwork/ui";

import styles from "./commercial.module.css";
import type { CommercialRecord } from "./model";
import { orderTimeline } from "./order-timeline";
import { PaymentHandoff } from "./payment-handoff";
import { validQuoteActions, type QuoteStatus } from "./workflow-model";
import { ArtifactDeliveryList } from "@/src/features/experience-server/artifact-delivery-list";
import { loadRecordArtifacts } from "@/src/features/experience-server/delivery";
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
  const summary = [
    { label: "Record", value: record.title },
    { label: "Authoritative status", value: record.statusLabel },
    { label: record.valueLabel, value: record.value },
    { label: "Owner", value: record.owner },
    { label: "Term / timing", value: record.term },
  ];
  if (!record.version) return summary;
  return [
    ...summary,
    {
      label:
        record.kind === "agreements"
          ? "Agreement version"
          : record.kind === "quotes"
            ? "Quote revision"
            : "Version",
      value: record.version,
    },
  ];
}

function artifactChain(record: CommercialRecord, recordKey: string) {
  const chain = [
    ["Customer reference", record.reference ?? recordKey],
    ["Source update", record.dateLabel],
    ["Next valid task", record.nextAction],
  ];
  return record.version
    ? [
        [
          record.kind === "agreements"
            ? "Agreement version"
            : record.kind === "quotes"
              ? "Quote revision"
              : "Version",
          record.version,
        ],
        ...chain,
      ]
    : chain;
}

/**
 * The forward step for a record.
 *
 * Four of these five destinations resolve a record out of a projection
 * channel, and every one of them selects on the projection's `recordKey`:
 * `/orders/accept?quote=` and `/quotes/new?revises=` against `quotes`,
 * `/quotes/new?poc=` against `pocs`, `/agreements/execute?agreement=` against
 * `agreements`, and `/account/offboarding?service=` against `services`. So the
 * reference each link carries is `recordKey`, taken from the route that
 * resolved this record rather than from the record body: a materialized
 * payload's `id` is the aggregate UUID -- the same value as `aggregateId` --
 * and neither of those selects anything at any of the four. Without a
 * reference the destination selects whatever it defaults to, and the record
 * the reader came from is lost.
 *
 * `/amendments` is the fifth and is not one of them. The customer collection
 * behind it reads only its own list controls -- `q`, `status`, `risk`,
 * `owner`, `sort`, `view`, `page`, `pageSize` -- so the `?order=` this link
 * used to carry named the order to nothing that could read it. It is a
 * collection link and is written as one; binding it needs a filter on that
 * collection, which does not exist yet.
 *
 * `Route` is declared, not asserted. Each destination below is a route in the
 * tree, optionally followed by a query string, which `Route` accepts only when
 * the path before the `?` is a route the tree actually contains. The `as Route`
 * casts these links used to carry suppressed exactly that check.
 */
function nextStep(
  record: CommercialRecord,
  recordKey: string,
): { href: Route; label: string } | null {
  const reference = encodeURIComponent(recordKey);
  if (record.kind === "quotes") {
    const actions = validQuoteActions(record.status as QuoteStatus);
    if (actions.includes("accept"))
      return {
        href: `/orders/accept?quote=${reference}`,
        label: "Review and accept order",
      };
    if (actions.includes("edit"))
      return {
        href: "/quotes/new",
        label: "Create a new quote",
      };
    return null;
  }
  if (record.kind === "pocs")
    return {
      href: `/quotes/new?poc=${reference}`,
      label: "Convert to a quote",
    };
  if (record.kind === "orders")
    return {
      href: "/amendments",
      label: "Request an amendment",
    };
  if (record.kind === "agreements")
    return record.allowedActions?.includes("execute_agreement")
      ? {
          href: `/agreements/execute?agreement=${reference}`,
          label: "Execute a new agreement",
        }
      : null;
  if (record.kind === "services")
    return {
      href: `/account/offboarding?service=${reference}`,
      label: "Request offboarding",
    };
  return null;
}

function DetailActions({
  record,
  recordKey,
  canMutate,
}: {
  record: CommercialRecord;
  recordKey: string;
  canMutate: boolean;
}) {
  const step = nextStep(record, recordKey);
  if (record.kind === "orders" && record.orderLifecycleStatus === "accepted")
    return null;
  if (!step) return null;
  if (!canMutate)
    return (
      <span className={styles.muted}>
        An owner or administrator can take the next action.
      </span>
    );
  return (
    <>
      <Link className={styles.primary} href={step.href}>
        {step.label}
      </Link>
      {record.kind === "quotes" && record.status === "open" ? (
        <Link
          className={styles.secondary}
          href={`/quotes/new?revises=${encodeURIComponent(recordKey)}`}
        >
          Create revised draft
        </Link>
      ) : null}
    </>
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
  const t = use(getTranslations());
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
  recordKey: string,
  accountId: string | undefined,
  canMutate: boolean,
  guidedDemo: boolean,
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
      guidedDemo={guidedDemo}
      invoiceId={record.aggregateId}
      recordKey={recordKey}
    />
  );
}

/**
 * Async because the Documents section is real.
 *
 * It used to be prose -- "Primary artifact", "Visible to authorized account
 * roles", "Downloads are shown only when a document provider supplies a safe,
 * authorized link" -- with no link behind any of it, on a page whose heading
 * told the reader documents were there. The documents exist and the route to
 * them exists, so the section reads them rather than describing them, and the
 * read has to be awaited.
 *
 * Every route that mounts this is a customer route, which is why the audience
 * below is not a parameter; `loadCommercialRecord`, which resolved the record
 * these routes pass in, hardcodes the same audience for the same reason. The
 * partner surfaces mount `PartnerPortfolioDetail`, not this.
 */
export async function CommercialRecordDetail({
  id,
  accountId,
  canMutate = false,
  guidedDemo = false,
  record,
  actions,
}: {
  /**
   * The requested reference: the projection `recordKey` the route resolved
   * this record by. It is what the forward step carries to its destination,
   * because that is the identifier every destination channel selects on.
   *
   * It is still never rendered as text, and never at all unless a record was
   * read: the unreadable-record state returns above any use of it, so that
   * state reads the same for a reference that does not exist and one that
   * belongs to another account.
   */
  id: string;
  /**
   * The account the route resolved for the reader. A payment session is opened
   * against an account and an invoice; only the route knows which account the
   * reader is acting for, so the surface is handed it rather than naming one.
   */
  accountId?: string;
  canMutate?: boolean;
  guidedDemo?: boolean;
  record: CommercialRecord | null;
  /**
   * Server-backed action for this record, supplied by the route so the panel
   * carries the route's own permission gate rather than a second guess at it.
   */
  actions?: ReactNode;
}) {
  const t = await getTranslations();
  if (!record) return <UnreadableRecord />;
  // Every `CollectionKind` is also the collection's own path segment, so this
  // is checked rather than asserted. The `services` special case this replaces
  // produced the identical string and only read as though something differed.
  const backHref: Route = `/${record.kind}`;
  const summary = commercialSummary(record);
  const chain = artifactChain(record, id);
  const artifacts = await loadRecordArtifacts("customer", record.kind, id);
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
          <DetailActions canMutate={canMutate} record={record} recordKey={id} />
          {record.kind === "agreements" &&
          record.aggregateId &&
          canMutate &&
          record.allowedActions?.includes("execute_agreement") ? (
            <Link
              className={styles.primary}
              href={`/signing/redirect?agreementId=${encodeURIComponent(record.aggregateId)}`}
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
        <p id="next-action-title">{t("common.nextAction")}</p>
        {record.nextActionHref ? (
          <Link href={record.nextActionHref as Route}>{record.nextAction}</Link>
        ) : (
          <strong>{record.nextAction}</strong>
        )}
      </section>

      <div className={styles.detailGrid}>
        <div className={styles.stack}>
          <section
            className={`${styles.panel} ${styles.section}`}
            aria-labelledby="commercial-summary-title"
          >
            <h2 id="commercial-summary-title">
              {t("common.commercialSummary")}
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
            <h2 id="term-title">{t("common.termState")}</h2>
            <p className={styles.description}>{record.term}</p>
          </section>
          {record.kind === "orders" ? (
            <section
              className={`${styles.panel} ${styles.section}`}
              aria-labelledby="order-progress-title"
            >
              <h2 id="order-progress-title">Order progress</h2>
              <Timeline
                className={styles.orderTimeline ?? ""}
                items={orderTimeline(record, artifacts)}
                label="Order lifecycle"
              />
            </section>
          ) : null}
          <section
            className={`${styles.panel} ${styles.section}`}
            aria-labelledby="artifact-title"
          >
            <h2 id="artifact-title">{t("common.artifactChain")}</h2>
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
            <h2 id="documents-title">{t("common.documents")}</h2>
            {/*
             * The list is the whole statement, and it is the same list every
             * other surface that shows generated paper renders. When documents
             * are attached it gives each one its own download link, having
             * first checked the stored bytes against the recorded hash, and
             * names the file and immutable version it verified. When none are
             * attached it says exactly that.
             *
             * Nothing here promises a download, because nothing here can know
             * of one the list does not have. What this replaced did: a
             * "Primary artifact" that was the record's own title, an
             * "Availability" that was a claim about roles, and a sentence
             * saying downloads appear "when a document provider supplies a
             * safe, authorized link" -- from a surface that asked no provider
             * anything and rendered no link under any condition.
             */}
            <ArtifactDeliveryList artifacts={artifacts} />
          </section>
        </div>

        <div className={styles.stack}>
          {actions}
          {payableInvoice(record, id, accountId, canMutate, guidedDemo)}
          <section
            className={`${styles.panel} ${styles.section}`}
            aria-labelledby="audit-title"
          >
            <h2 id="audit-title">{t("common.auditEvidence")}</h2>
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
              <summary>{t("common.technicalDetails")}</summary>
              <dl className={styles.definitionGrid}>
                <div>
                  <dt>Record identifier</dt>
                  <dd>
                    <code>{record.id}</code>
                  </dd>
                </div>
                <div>
                  <dt>Projection identifier</dt>
                  <dd>
                    <code>{record.projectionId ?? "Unavailable"}</code>
                  </dd>
                </div>
                <div>
                  <dt>Projection row version</dt>
                  <dd>
                    <code>{record.projectionVersion ?? "Unavailable"}</code>
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
