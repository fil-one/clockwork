import "server-only";
import Link from "next/link";
import { notFound } from "next/navigation";
import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";
import { configuredDemoStateStore } from "@/src/features/experience-server/demo-state-store";
import type { DemoOrderAcceptanceState } from "@/src/features/experience-server/demo-order-acceptance";
import { getRouteIdentity } from "@/src/features/shell/route-session";
import { loadPortalRecords } from "@/src/features/experience-server/portal-view-loader";
import { formatMoney } from "@/src/features/shared/format";
import { getFormattingLocale, getTranslations } from "@/src/i18n/server";

import { partnerQuoteLineText } from "./partner-presentation";
import styles from "./partner.module.css";

/** "1 Aug 2026 – 31 Jul 2027" for two calendar dates, in the reader's locale. */
function serviceTerm(start: string, end: string, formatting: string): string {
  const from = new Date(`${start}T00:00:00Z`);
  const to = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(from.valueOf()) || Number.isNaN(to.valueOf()))
    return `${start} – ${end}`;
  return new Intl.DateTimeFormat(formatting, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).formatRange(from, to);
}

export async function PartnerOrders({ id }: { id?: string }) {
  const t = await getTranslations();
  const formattingLocale = await getFormattingLocale();
  const identity = await getRouteIdentity("partner");
  if (!demoDeployIdentityEnabled(process.env))
    return <ProjectedPartnerOrders {...(id ? { id } : {})} />;
  const orders = Object.values(
    ((await configuredDemoStateStore().read()) as DemoOrderAcceptanceState)
      .createdOrders ?? {},
  ).filter(
    (order) =>
      order.domainOrder?.partnerAccountId === identity.accountId &&
      order.audienceAccountId === identity.accountId,
  );
  const selected = id ? orders.filter((order) => order.id === id) : orders;
  if (id && !selected.length) notFound();
  return (
    <main id="main-content" className={styles.main}>
      <header className={styles.pageHeader}>
        <div>
          <h1>
            {t(id ? "partner.orders.supplyOrder" : "partner.orders.title")}
          </h1>
          <p>{t("partner.orders.demoDescription")}</p>
        </div>
        <Link href="/partner/quotes">{t("partner.orders.quotesLink")}</Link>
      </header>
      {selected.length ? (
        selected.map((order) => (
          <section className={styles.detailCard} key={order.id}>
            <h2>
              <Link href={`/partner/orders/${order.id}`}>{order.poNumber}</Link>
            </h2>
            <p>
              {t(
                order.provisioning
                  ? "partner.orders.state.provisioning"
                  : "partner.orders.state.accepted",
              )}
            </p>
            <dl>
              <div>
                <dt>{t("partner.orders.transferCommitment")}</dt>
                <dd>
                  {formatMoney(
                    order.totalMinor,
                    order.currency,
                    formattingLocale,
                  )}
                </dd>
              </div>
              <div>
                <dt>{t("partner.orders.serviceTerm")}</dt>
                <dd>
                  {serviceTerm(
                    order.serviceStartsOn,
                    order.serviceEndsOn,
                    formattingLocale,
                  )}
                </dd>
              </div>
              <div>
                <dt>{t("partner.orders.acceptedBy")}</dt>
                <dd>
                  {t("partner.orders.signer", {
                    name: order.signerName,
                    title: order.authorityTitle,
                  })}
                </dd>
              </div>
            </dl>
            <ul>
              {order.domainOrder?.lines.map((line) => (
                <li key={line.id}>
                  {partnerQuoteLineText(line, t, formattingLocale)}
                </li>
              ))}
            </ul>
            <div className={styles.actions}>
              <a
                className={styles.buttonLink}
                href={`/api/experience/artifacts/order_form/${order.artifactRequestId}`}
              >
                {t("partner.quote.document.link", {
                  document: t("partner.orders.acceptedDocument"),
                })}
              </a>
              <Link href={`/partner/quotes/${order.quoteRecordKey}`}>
                {t("partner.orders.sourceQuote")}
              </Link>
            </div>
            <p>
              {t(
                order.provisioning
                  ? "partner.orders.provisioningNote"
                  : "partner.orders.handoffNote",
              )}
            </p>
          </section>
        ))
      ) : (
        <section className={styles.detailCard}>
          <h2>{t("partner.orders.empty.title")}</h2>
          <p>{t("partner.orders.empty.description")}</p>
          <Link href="/partner/quotes">{t("partner.orders.empty.action")}</Link>
        </section>
      )}
    </main>
  );
}

async function ProjectedPartnerOrders({ id }: { id?: string }) {
  const t = await getTranslations();
  const projection = await loadPortalRecords("partner", "orders");
  const records = id
    ? projection.records.filter(
        (record) => record.aggregateId === id || record.recordKey === id,
      )
    : projection.records;
  if (id && !records.length) notFound();
  const text = (data: Readonly<Record<string, unknown>>, key: string) =>
    typeof data[key] === "string" ? data[key] : undefined;
  return (
    <main id="main-content" className={styles.main}>
      <header className={styles.pageHeader}>
        <div>
          <h1>
            {t(id ? "partner.orders.supplyOrder" : "partner.orders.title")}
          </h1>
          <p>{t("partner.orders.description")}</p>
        </div>
        <Link href="/partner/quotes">{t("partner.orders.quotesLink")}</Link>
      </header>
      {projection.truncated ? (
        <p role="status">{t("partner.orders.truncated")}</p>
      ) : null}
      {records.length ? (
        records.map((record) => (
          <section className={styles.detailCard} key={record.id}>
            <h2>
              <Link href={`/partner/orders/${record.aggregateId}`}>
                {text(record.data, "title") ??
                  text(record.data, "name") ??
                  record.recordKey}
              </Link>
            </h2>
            <p>
              {/* A production order record carries its own status label. */}
              {text(record.data, "statusLabel") ??
                text(record.data, "status") ??
                t("status.notRecorded")}
            </p>
            <p>{text(record.data, "description")}</p>
            <p>{text(record.data, "value")}</p>
            {record.stale ? (
              <p role="status">{t("partner.orders.stale")}</p>
            ) : null}
          </section>
        ))
      ) : (
        <p>{t("partner.orders.none")}</p>
      )}
    </main>
  );
}
