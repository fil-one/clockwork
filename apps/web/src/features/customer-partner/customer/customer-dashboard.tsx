import Link from "next/link";

import { StatTile, StatusBadge } from "@clockwork/ui";

import { customerPartnerCopy } from "../copy";
import styles from "./customer-pages.module.css";

const copy = customerPartnerCopy.customer;

const attention = [
  {
    type: "Invoice",
    title: "$15,400 due Aug 15",
    detail: "Invoice INV-2026-0781 is awaiting payment.",
    action: "Review invoice",
    href: "/billing" as const,
    tone: "warning" as const,
  },
  {
    type: "Notice and renewal",
    title: "Notice window opens Nov 1",
    detail: "Review the service plan 93 days before the account notice date.",
    action: "Review services",
    href: "/services" as const,
    tone: "warning" as const,
  },
  {
    type: "Quote",
    title: "Enterprise quote expires Aug 3",
    detail: "Three days remain to accept or let the open quote expire.",
    action: "Review quote",
    href: "/quotes/Q-2026-0184-v3" as const,
    tone: "warning" as const,
  },
  {
    type: "Provisioning",
    title: "Madrid replica is 78% ready",
    detail: "A customer validation step will be available after provisioning.",
    action: "Track order",
    href: "/orders/ORD-2026-0112" as const,
    tone: "neutral" as const,
  },
] as const;

export function CustomerDashboard({
  canCreateQuote = true,
}: {
  canCreateQuote?: boolean;
}) {
  return (
    <main className={styles.main} id="main-content">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Customer workspace</p>
          <h1>{copy.dashboardTitle}</h1>
          <p className={styles.description}>{copy.dashboardDescription}</p>
        </div>
        {canCreateQuote ? (
          <Link className={styles.primaryLink} href="/quotes/new">
            Create quote
          </Link>
        ) : (
          <p className={styles.permissionNote}>{copy.quotePermissionNote}</p>
        )}
      </header>

      <section className={styles.section} aria-labelledby="attention-title">
        <div className={styles.sectionHeading}>
          <div>
            <h2 id="attention-title">{copy.attentionTitle}</h2>
            <p>{copy.attentionDescription}</p>
          </div>
        </div>
        <div className={styles.attentionGrid}>
          {attention.map((item) => (
            <Link
              className={styles.attentionLink}
              href={item.href}
              key={item.type}
            >
              <div className={styles.attentionTop}>
                <span className={styles.attentionType}>{item.type}</span>
                <StatusBadge tone={item.tone}>
                  {item.type === "Provisioning" ? "In progress" : "Action due"}
                </StatusBadge>
              </div>
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
              <span className={styles.attentionAction}>{item.action} →</span>
            </Link>
          ))}
        </div>
      </section>

      <div className={styles.commercialGrid}>
        <section className={styles.termCard} aria-labelledby="term-title">
          <div className={styles.termTop}>
            <div>
              <p className={styles.eyebrow}>Account agreement</p>
              <h2 id="term-title">{copy.termTitle}</h2>
              <p className={styles.termRange}>Jan 1 – Dec 31, 2026</p>
            </div>
            <StatusBadge tone="success">Auto-renews</StatusBadge>
          </div>
          <div
            className={styles.termTrack}
            role="img"
            aria-label="58 percent of the current commercial term elapsed"
          >
            <div className={styles.termProgress} />
          </div>
          <dl className={styles.termMilestones}>
            <div>
              <dt>Notice window</dt>
              <dd>Opens Nov 1 · 93 days</dd>
            </div>
            <div>
              <dt>Renewal</dt>
              <dd>Jan 1, 2027</dd>
            </div>
            <div>
              <dt>Governing agreement</dt>
              <dd>Cloud Service Agreement v3.2</dd>
            </div>
          </dl>
        </section>

        <details className={styles.rollup}>
          <summary>
            <span>{copy.serviceRollup}</span>
            <span className={styles.rollupCount}>2 services</span>
          </summary>
          <ul className={styles.serviceList}>
            <li>
              <strong>Northstar primary archive</strong>
              <span>500 TB · active · follows account term</span>
            </li>
            <li>
              <strong>Madrid compliance replica</strong>
              <span>120 TB · provisioning · ends Dec 31, 2026</span>
            </li>
          </ul>
        </details>
      </div>

      <section className={styles.section} aria-labelledby="metrics-title">
        <div className={styles.sectionHeading}>
          <div>
            <h2 id="metrics-title">{copy.metricsTitle}</h2>
            <p>Ordered by the decisions most likely to require action.</p>
          </div>
        </div>
        <div className={styles.metricGrid}>
          <StatTile
            label="Invoice due"
            value="$15,400"
            detail="Due Aug 15"
            change="Payment action available"
            tone="attention"
          />
          <StatTile
            label="Committed capacity used"
            value="50.2%"
            detail="311 TB of 620 TB"
            change="6.5% more than prior 30 days"
            trend="up"
          />
          <StatTile
            label="Days to notice window"
            value="93"
            detail="Opens Nov 1"
            change="No renewal choice due today"
          />
          <StatTile
            label="Open quote exposure"
            value="$184,800"
            detail="One open · expires Aug 3"
            change="Acceptance would add 400 TB"
            tone="attention"
          />
        </div>
      </section>

      <div className={styles.dashboardLower}>
        <figure className={styles.chart} aria-labelledby="capacity-chart-title">
          <figcaption className={styles.chartHeader}>
            <div>
              <h2 id="capacity-chart-title">{copy.chartTitle}</h2>
              <p className={styles.freshness}>{copy.chartFreshness}</p>
            </div>
            <p className={styles.comparison}>
              +19 TB / +6.5%
              <br />
              {copy.chartComparison}
            </p>
          </figcaption>
          <div className={styles.bars}>
            <div className={styles.barRow}>
              <span>Committed</span>
              <div className={styles.barTrack} aria-hidden="true">
                <div className={styles.barFill} style={{ width: "100%" }} />
              </div>
              <strong>620 TB</strong>
            </div>
            <div className={styles.barRow}>
              <span>Current use</span>
              <div className={styles.barTrack} aria-hidden="true">
                <div className={styles.barFill} style={{ width: "50.2%" }} />
              </div>
              <strong>311 TB</strong>
            </div>
            <div className={styles.barRow}>
              <span>Prior 30 days</span>
              <div className={styles.barTrack} aria-hidden="true">
                <div
                  className={`${styles.barFill} ${styles.barFillPrevious}`}
                  style={{ width: "47.1%" }}
                />
              </div>
              <strong>292 TB</strong>
            </div>
          </div>
        </figure>

        <section className={styles.activity} aria-labelledby="activity-title">
          <h2 id="activity-title">{copy.activityTitle}</h2>
          <p className={styles.panelIntro}>Supporting context, newest first.</p>
          <ol className={styles.activityList}>
            <li>
              <strong>Marketplace fulfillment synchronized</strong>
              <span>AWS private offer · provider-reported</span>
              <time dateTime="2026-07-31T15:42:00Z">18 minutes ago</time>
            </li>
            <li>
              <strong>Provisioning advanced to 78%</strong>
              <span>Madrid compliance replica</span>
              <time dateTime="2026-07-31T13:12:00Z">3 hours ago</time>
            </li>
            <li>
              <strong>Quote v3 issued</strong>
              <span>Enterprise committed capacity</span>
              <time dateTime="2026-07-30T16:30:00Z">Yesterday</time>
            </li>
          </ol>
        </section>
      </div>
    </main>
  );
}
