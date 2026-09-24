import "server-only";
import Link from "next/link";
import { notFound } from "next/navigation";
import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";
import { configuredDemoStateStore } from "@/src/features/experience-server/demo-state-store";
import type { DemoOrderAcceptanceState } from "@/src/features/experience-server/demo-order-acceptance";
import { getRouteIdentity } from "@/src/features/shell/route-session";
import { loadPortalRecords } from "@/src/features/experience-server/portal-view-loader";
import { formatMoney } from "@/src/features/shared/format";
import { getFormattingLocale } from "@/src/i18n/server";

import styles from "./partner.module.css";

export async function PartnerOrders({ id }: { id?: string }) {
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
          <h1>{id ? "Supply order" : "Supply orders"}</h1>
          <p>
            Fil One supplies your partner account at the transfer price. Your
            end-client contract and billing stay with you.
          </p>
        </div>
        <Link href="/partner/quotes">Partner quotes</Link>
      </header>
      {selected.length ? (
        selected.map((order) => (
          <section className={styles.detailCard} key={order.id}>
            <h2>
              <Link href={`/partner/orders/${order.id}`}>{order.poNumber}</Link>
            </h2>
            <p>
              {order.provisioning
                ? "Provisioning · demo request submitted"
                : "Accepted · awaiting provisioning"}
            </p>
            <dl>
              <div>
                <dt>Transfer commitment</dt>
                <dd>
                  {formatMoney(
                    order.totalMinor,
                    order.currency,
                    formattingLocale,
                  )}
                </dd>
              </div>
              <div>
                <dt>Service term</dt>
                <dd>
                  {order.serviceStartsOn} – {order.serviceEndsOn}
                </dd>
              </div>
              <div>
                <dt>Accepted by</dt>
                <dd>
                  {order.signerName} · {order.authorityTitle}
                </dd>
              </div>
            </dl>
            <ul>
              {order.domainOrder?.lines.map((line) => (
                <li key={line.id}>
                  {line.quantity} TB · {line.region} · {line.termMonths} months
                </li>
              ))}
            </ul>
            <div className={styles.actions}>
              <a
                className={styles.buttonLink}
                href={`/api/experience/artifacts/order_form/${order.artifactRequestId}`}
              >
                Accepted supply order · PDF
              </a>
              <Link href={`/partner/quotes/${order.quoteRecordKey}`}>
                Source quote
              </Link>
            </div>
            <p>
              {order.provisioning
                ? "The demo provisioner received the saved entitlements. Activation awaits a provider completion result."
                : "Your order is in the internal provisioning handoff. It has not activated service."}
            </p>
          </section>
        ))
      ) : (
        <section className={styles.detailCard}>
          <h2>No supply orders yet</h2>
          <p>Open an issued partner quote to review its supply order.</p>
          <Link href="/partner/quotes">Review partner quotes</Link>
        </section>
      )}
    </main>
  );
}

async function ProjectedPartnerOrders({ id }: { id?: string }) {
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
          <h1>{id ? "Supply order" : "Supply orders"}</h1>
          <p>
            Your authorized partner order records and current fulfillment
            status.
          </p>
        </div>
        <Link href="/partner/quotes">Partner quotes</Link>
      </header>
      {projection.truncated ? (
        <p role="status">
          More orders are available. Narrow your search through your partner
          team.
        </p>
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
              {text(record.data, "statusLabel") ??
                text(record.data, "status") ??
                "Status not recorded"}
            </p>
            <p>{text(record.data, "description")}</p>
            <p>{text(record.data, "value")}</p>
            {record.stale ? (
              <p role="status">
                This record is past its refresh window. Verify its current
                status before acting.
              </p>
            ) : null}
          </section>
        ))
      ) : (
        <p>No supply orders have been recorded for this partner account.</p>
      )}
    </main>
  );
}
