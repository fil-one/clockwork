import type { Route } from "next";
import Link from "next/link";

import { customerPartnerCopy } from "../copy";
import styles from "./commercial.module.css";
import { recordById, type CommercialRecord } from "./model";
import { PaymentHandoff } from "./payment-handoff";
import { validQuoteActions, type QuoteStatus } from "./workflow-model";

function detailLabel(record: CommercialRecord) {
  if (record.kind === "agreements") return "Agreement detail";
  if (record.kind === "quotes") return "Quote detail";
  if (record.kind === "orders") return "Order detail";
  if (record.kind === "pocs") return "Proof-of-concept detail";
  if (record.kind === "billing") return "Invoice detail";
  return "Service detail";
}

function commercialSummary(record: CommercialRecord) {
  if (record.kind === "agreements")
    return [
      { label: "Agreement", value: record.title },
      {
        label: "Version",
        value: record.version ? `Version ${record.version}` : "Current",
      },
      { label: "Legal entity", value: "Northstar Archive Labs" },
      {
        label: "Authority evidence",
        value: "Maya Chen · Chief Operating Officer",
      },
    ];
  if (record.kind === "quotes")
    return [
      {
        label: customerPartnerCopy.commercial.estimatedSpend,
        value: record.value,
      },
      { label: "Offer", value: record.title },
      {
        label: "Capacity and region",
        value: record.description.split(" · ").slice(0, 2).join(" · "),
      },
      { label: "Commercial route", value: "Direct" },
    ];
  if (record.kind === "orders")
    return [
      { label: "Resulting commitment", value: record.value },
      {
        label: "Accepted quote",
        value: "Compliance replica renewal · version 2",
      },
      {
        label: "Governing agreement",
        value: "Cloud Service Agreement · version 3.2",
      },
      {
        label: "Purchase order",
        value: record.id === "ORD-2026-0098" ? "PO-NA-1048" : "PO-NA-1081",
      },
    ];
  if (record.kind === "billing")
    return [
      {
        label: customerPartnerCopy.commercial.invoiceTruth,
        value: record.value,
      },
      {
        label: customerPartnerCopy.commercial.estimatedSpend,
        value: "$15,400.00 monthly estimate",
      },
      {
        label: customerPartnerCopy.commercial.paymentTruth,
        value:
          record.status === "paid"
            ? "Paid · provider confirmed"
            : "Awaiting provider confirmation",
      },
      { label: "Purchase order", value: "PO-NA-1048" },
    ];
  if (record.kind === "pocs")
    return [
      {
        label: "Capacity safeguard",
        value: record.id.endsWith("31") ? "20 TB cap" : "12 TB cap",
      },
      { label: "Permitted data", value: "Confidential · isolated environment" },
      {
        label: "Success tests",
        value: record.status === "complete" ? "4 of 4 passed" : "3 of 4 passed",
      },
      { label: "Conversion", value: "Requires accepted paid quote and order" },
    ];
  return [
    { label: "Service", value: record.title },
    { label: "Usage", value: record.value },
    {
      label: "Region",
      value: record.description.includes("EU West")
        ? "EU West · Madrid"
        : "US East · Virginia",
    },
    { label: "Service owner", value: record.owner },
  ];
}

function artifactChain(record: CommercialRecord) {
  if (record.kind === "agreements")
    return [
      [
        "Counsel-approved template",
        `Cloud Service Agreement · version ${record.version ?? "current"}`,
      ],
      [
        "Execution evidence",
        "Authority attestation · exact text integrity verified",
      ],
      ["Governing record", record.id],
    ];
  if (record.kind === "quotes")
    return [
      ["Current price book", "USD 2026.3 · server-priced"],
      ["Rendered offer", `${record.title} · version ${record.version ?? "1"}`],
      ["Quote status", record.statusLabel],
    ];
  if (record.kind === "orders")
    return [
      ["Accepted quote", "Compliance replica renewal · version 2"],
      ["Governing agreement", "Cloud Service Agreement · version 3.2"],
      ["Resulting order", record.id],
      ["Service", record.title],
    ];
  if (record.kind === "billing")
    return [
      ["Order", "Northstar primary archive"],
      ["Invoice", record.id],
      [
        "Provider payment event",
        record.status === "paid" ? "Signed webhook confirmed" : "Not received",
      ],
    ];
  if (record.kind === "pocs")
    return [
      ["Approved evaluation scope", record.title],
      ["Isolated environment", "Capacity and expiry safeguards active"],
      [
        "Result evidence",
        record.status === "complete"
          ? "Final report ready"
          : "Final test pending",
      ],
    ];
  return [
    ["Accepted order", record.id.replace("SVC", "ORD")],
    ["Provisioning", record.statusLabel],
    ["Metering", record.dateLabel],
  ];
}

function DetailActions({
  record,
  canMutate,
}: {
  record: CommercialRecord;
  canMutate: boolean;
}) {
  if (record.kind !== "quotes") return null;
  if (!canMutate)
    return (
      <span className={styles.muted}>
        An owner or administrator can take the next action.
      </span>
    );
  const actions = validQuoteActions(record.status as QuoteStatus);
  if (actions.includes("create_order"))
    return (
      <Link className={styles.primary} href="/orders/accept">
        Review resulting order
      </Link>
    );
  if (actions.includes("edit"))
    return (
      <Link className={styles.primary} href="/quotes/new">
        Create revised draft
      </Link>
    );
  return null;
}

export function CommercialRecordDetail({
  id,
  canMutate = false,
}: {
  id: string;
  canMutate?: boolean;
}) {
  const record = recordById(id);
  if (!record) {
    return (
      <main className={styles.main} id="main-content">
        <section className={styles.state} role="alert">
          <h1>Record not found</h1>
          <p>
            The requested commercial record is unavailable or outside your
            account.
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
      <nav className={styles.breadcrumb} aria-label="Breadcrumb">
        <Link href={backHref}>
          {record.kind === "pocs"
            ? "POCs"
            : record.kind[0]?.toUpperCase() + record.kind.slice(1)}
        </Link>
        {" / "}
        <span aria-current="page">{record.title}</span>
      </nav>

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
                <span>Jul 25, 2026</span>
                <strong>Commercial artifact verified</strong>
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
                    <code>3</code>
                  </dd>
                </div>
                <div className={styles.spanTwo}>
                  <dt>Artifact SHA-256</dt>
                  <dd>
                    <code>73be9f02a87c3c7f6311a3210cb922e2</code>
                  </dd>
                </div>
              </dl>
            </details>
          </section>
        </div>
      </div>
    </main>
  );
}
