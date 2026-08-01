import type { Route } from "next";
import Link from "next/link";

import { TermBar } from "@clockwork/ui";

import { customerPartnerCopy } from "@/src/features/customer-partner/copy";
import { getRouteRoles } from "@/src/features/shell/route-session";

import { recordForSurface } from "./partner-data";
import { currentPartnerRole, validPartnerQuoteActions } from "./partner-rules";
import styles from "./partner.module.css";

function MissingRecord({ backHref }: { backHref: Route }) {
  return (
    <main className={styles.main} id="main-content">
      <section className={styles.detailCard}>
        <p className={styles.eyebrow}>Record unavailable</p>
        <h1>This partner record was not found</h1>
        <p className={styles.muted}>
          It may have moved or your role may no longer have access.
        </p>
        <Link className={styles.buttonLink} href={backHref}>
          Back to collection
        </Link>
      </section>
    </main>
  );
}

export function PartnerPortfolioDetail({ id }: { id: string }) {
  const record = recordForSurface("portfolio", id);
  if (!record) return <MissingRecord backHref="/partner/portfolio" />;
  const common = customerPartnerCopy.common;
  const commercial =
    id === "EC-0041"
      ? {
          action: "Review commission eligibility",
          due: "December 1, 2026",
          transfer: "Not applicable on referral route",
          resale: "Clockwork contracts directly with Solace",
          merchant: "Clockwork",
        }
      : id === "EC-0047"
        ? {
            action: "Complete POC qualification",
            due: "Today",
            transfer: "£6,900 proposed · private to channel",
            resale: "£8,400 proposed · not yet issued",
            merchant: "Authorized downstream reseller after conversion",
          }
        : {
            action: "Review renewal commitment",
            due: "September 2, 2026",
            transfer: "$91,200 annually · private to Meridian",
            resale: "$112,000 annually · shown to Halcyon",
            merchant: "Meridian Channel Group",
          };
  return (
    <main className={styles.main} id="main-content">
      <nav className={styles.breadcrumb} aria-label="Breadcrumb">
        <Link href="/partner">Partner desk</Link>
        <span>/</span>
        <Link href="/partner/portfolio">End-client portfolio</Link>
        <span>/</span>
        <span aria-current="page">{record.name}</span>
      </nav>
      <header className={styles.detailHeading}>
        <div>
          <p className={styles.eyebrow}>End-client commercial record</p>
          <h1>{record.name}</h1>
          <p className={styles.muted}>{record.context}</p>
        </div>
        <span className={styles.pill} data-tone={record.status}>
          {record.status}
        </span>
      </header>
      <section className={styles.term} aria-labelledby="client-term-title">
        <div className={styles.termHeader}>
          <div>
            <p className={styles.eyebrow}>{common.termState}</p>
            <h2 id="client-term-title">Service and commercial term</h2>
          </div>
          <strong>Next: {commercial.action}</strong>
        </div>
        <TermBar
          label={`${record.name} commercial clock`}
          start={new Date("2026-01-01T00:00:00Z")}
          noticeStart={new Date("2026-09-01T00:00:00Z")}
          end={new Date("2026-12-31T00:00:00Z")}
          now={new Date("2026-07-31T16:00:00Z")}
          renewalState="auto-renews"
        />
      </section>
      <div className={styles.detailsGrid}>
        <section className={styles.detailCard}>
          <h2>{common.nextAction}</h2>
          <dl>
            <div>
              <dt>Action</dt>
              <dd>{commercial.action}</dd>
            </div>
            <div>
              <dt>Owner</dt>
              <dd>{record.owner}</dd>
            </div>
            <div>
              <dt>Due</dt>
              <dd>{commercial.due}</dd>
            </div>
          </dl>
        </section>
        <section className={styles.detailCard}>
          <h2>{common.commercialSummary}</h2>
          <dl>
            <div>
              <dt>{customerPartnerCopy.partner.transferPrice}</dt>
              <dd>{commercial.transfer}</dd>
            </div>
            <div>
              <dt>{customerPartnerCopy.partner.partnerPrice}</dt>
              <dd>{commercial.resale}</dd>
            </div>
            <div>
              <dt>{customerPartnerCopy.partner.merchantOfRecord}</dt>
              <dd>{commercial.merchant}</dd>
            </div>
          </dl>
        </section>
        <section className={styles.detailCard}>
          <h2>{common.artifactChain}</h2>
          <dl>
            <div>
              <dt>Agreement</dt>
              <dd>Meridian Channel Partner Agreement · v4.1</dd>
            </div>
            <div>
              <dt>Quote</dt>
              <dd>Halcyon archive quote · accepted v2</dd>
            </div>
            <div>
              <dt>Order</dt>
              <dd>Halcyon primary archive · active</dd>
            </div>
            <div>
              <dt>Invoice</dt>
              <dd>
                July consolidated invoice · awaiting provider payment truth
              </dd>
            </div>
          </dl>
        </section>
        <section className={styles.detailCard}>
          <h2>{common.documents}</h2>
          <dl>
            <div>
              <dt>End-client artifact</dt>
              <dd>Partner-priced order form · v2</dd>
            </div>
            <div>
              <dt>Partner artifact</dt>
              <dd>Transfer-price schedule · v2 · partner private</dd>
            </div>
          </dl>
          <details className={styles.technical}>
            <summary>{common.technicalDetails}</summary>
            <p>
              End-client account ID:{" "}
              <code>33333333-3333-4333-8333-333333333333</code>
            </p>
            <p>
              Order ID: <code>cccccccc-cccc-4ccc-8ccc-cccccccccccc</code>
            </p>
            <p>
              Artifact hash: <code>bb0ac4a19c3f…</code>
            </p>
          </details>
        </section>
        <section className={styles.detailCard}>
          <h2>{common.auditEvidence}</h2>
          <dl>
            <div>
              <dt>Jul 31 · 3:42 PM</dt>
              <dd>Usage projection reconciled by system</dd>
            </div>
            <div>
              <dt>Jul 22 · 10:16 AM</dt>
              <dd>Partner-priced quote accepted by Halcyon authority</dd>
            </div>
            <div>
              <dt>Jul 22 · 10:17 AM</dt>
              <dd>Transfer-price artifact retained for Meridian</dd>
            </div>
          </dl>
        </section>
      </div>
    </main>
  );
}

export async function PartnerQuoteDetail({ id }: { id: string }) {
  const record = recordForSurface("quotes", id);
  if (!record) return <MissingRecord backHref="/partner/quotes" />;
  const roles = await getRouteRoles("partner");
  const role = currentPartnerRole(roles) ?? "partner_seller";
  const actions = validPartnerQuoteActions(record.status, role);
  const common = customerPartnerCopy.common;
  return (
    <main className={styles.main} id="main-content">
      <nav className={styles.breadcrumb} aria-label="Breadcrumb">
        <Link href="/partner">Partner desk</Link>
        <span>/</span>
        <Link href="/partner/quotes">Partner quotes</Link>
        <span>/</span>
        <span aria-current="page">{record.name}</span>
      </nav>
      <header className={styles.detailHeading}>
        <div>
          <p className={styles.eyebrow}>Partner resale quote</p>
          <h1>{record.name}</h1>
          <p className={styles.muted}>Revision 3 · {record.context}</p>
        </div>
        <span className={styles.pill} data-tone={record.status}>
          {record.status}
        </span>
      </header>
      <section className={styles.boundary} aria-label="Quote price boundary">
        <div>
          <h2>{customerPartnerCopy.partner.transferPrice}</h2>
          <p>$184,800 · private partner artifact</p>
        </div>
        <div>
          <h2>{customerPartnerCopy.partner.partnerPrice}</h2>
          <p>$218,400 · end-client artifact</p>
        </div>
        <div>
          <h2>{customerPartnerCopy.partner.merchantOfRecord}</h2>
          <p>Meridian Channel Group</p>
        </div>
      </section>
      <section className={styles.summary} aria-labelledby="valid-actions-title">
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.eyebrow}>{common.nextAction}</p>
            <h2 id="valid-actions-title">
              Valid actions for this {record.status} quote
            </h2>
          </div>
        </div>
        <div className={styles.actions}>
          {actions.includes("edit") ? (
            <Link className={styles.buttonLink} href="/partner/quotes/new">
              Edit draft
            </Link>
          ) : null}
          {actions.includes("revise") ? (
            <Link className={styles.buttonLink} href="/partner/quotes/new">
              Create revision
            </Link>
          ) : null}
        </div>
        {actions.includes("issue") ? (
          <p className={styles.gate}>
            <strong>Issue is gated:</strong> Clockwork must first prepare and
            bind separate end-client and partner artifacts. The action appears
            after both artifacts are ready, then opens review and confirmation.
          </p>
        ) : null}
        {actions.includes("cancel") ? (
          <p className={styles.gate}>
            <strong>Cancellation is unavailable here:</strong> the current
            commerce contract has no partner quote-cancel command. Contact
            channel operations; no dead primary action is presented.
          </p>
        ) : null}
        {actions.includes("download") ? (
          <p className={styles.gate}>
            <strong>Download is provider-gated:</strong> the immutable artifact
            link appears only when the document service returns a retained
            partner-visible document.
          </p>
        ) : null}
      </section>
      <div className={styles.detailsGrid}>
        <section className={styles.detailCard}>
          <h2>{common.commercialSummary}</h2>
          <dl>
            <div>
              <dt>Offer</dt>
              <dd>US committed archive · USD 2026.3</dd>
            </div>
            <div>
              <dt>Capacity and term</dt>
              <dd>400 TB · 12 months</dd>
            </div>
            <div>
              <dt>Expiry</dt>
              <dd>August 6, 2026 at 5:00 PM ET</dd>
            </div>
          </dl>
        </section>
        <section className={styles.detailCard}>
          <h2>{common.termState}</h2>
          <dl>
            <div>
              <dt>Quote clock</dt>
              <dd>Open · 6 days remaining</dd>
            </div>
            <div>
              <dt>Service term</dt>
              <dd>12 months after accepted order start</dd>
            </div>
            <div>
              <dt>Renewal</dt>
              <dd>No renewal commitment exists until order acceptance</dd>
            </div>
          </dl>
        </section>
        <section className={styles.detailCard}>
          <h2>{common.artifactChain}</h2>
          <dl>
            <div>
              <dt>Registration</dt>
              <dd>Halcyon expansion · protected</dd>
            </div>
            <div>
              <dt>Agreement</dt>
              <dd>Meridian Channel Partner Agreement · v4.1</dd>
            </div>
            <div>
              <dt>Quote</dt>
              <dd>Halcyon archive expansion · revision 3</dd>
            </div>
          </dl>
        </section>
        <section className={styles.detailCard}>
          <h2>{common.documents}</h2>
          <dl>
            <div>
              <dt>End-client quote</dt>
              <dd>Meridian resale price · prepared</dd>
            </div>
            <div>
              <dt>Partner schedule</dt>
              <dd>Clockwork transfer price · partner private · prepared</dd>
            </div>
          </dl>
          <details className={styles.technical}>
            <summary>{common.technicalDetails}</summary>
            <p>
              Quote ID: <code>88888888-8888-4888-8888-888888888888</code>
            </p>
            <p>
              Series ID: <code>27f63a6f-54bc-4eaa-8a0b-31e296c64b7d</code>
            </p>
            <p>
              Source hash: <code>884e3c937be1…</code>
            </p>
          </details>
        </section>
        <section className={styles.detailCard}>
          <h2>{common.auditEvidence}</h2>
          <dl>
            <div>
              <dt>Jul 31 · 3:42 PM</dt>
              <dd>Revision 3 created by Juno Okafor</dd>
            </div>
            <div>
              <dt>Jul 31 · 3:42 PM</dt>
              <dd>Server pricing passed transfer margin policy</dd>
            </div>
            <div>
              <dt>Jul 31 · 3:43 PM</dt>
              <dd>Partner and end-client artifacts prepared separately</dd>
            </div>
          </dl>
        </section>
      </div>
    </main>
  );
}
