import Link from "next/link";

import { TermBar } from "@clockwork/ui";

import { customerPartnerCopy } from "@/src/features/customer-partner/copy";

import { currentPartnerRole } from "./partner-rules";
import styles from "./partner.module.css";

const urgent = [
  {
    title: "Agreement authority review",
    detail: "Partner agreement notice window opens Sep 1",
    meta: "32 days",
    href: "/partner/renewals",
    adminOnly: true,
  },
  {
    title: "Halcyon renewal",
    detail: "Review transfer and resale economics before requesting action",
    meta: "Due Sep 2",
    href: "/partner/renewals",
    adminOnly: true,
  },
  {
    title: "Credit exposure",
    detail: "July consolidated invoice remains within policy",
    meta: "$12,600",
    href: "/partner/billing",
    adminOnly: true,
  },
  {
    title: "Atlas registration",
    detail: "Protection request needs commercial evidence",
    meta: "Due today",
    href: "/partner/registrations",
    adminOnly: false,
  },
  {
    title: "Orchid claim dispute",
    detail: "Competing registration response requires evidence",
    meta: "3 days",
    href: "/partner/disputes",
    adminOnly: false,
  },
  {
    title: "Atlas POC report",
    detail: "Three of four qualification tests are complete",
    meta: "Due today",
    href: "/partner/sandboxes",
    adminOnly: true,
  },
] as const;

const adminStats = [
  {
    label: "Renewals needing action",
    value: "4",
    detail: "Next 90 days",
  },
  { label: "Credit exposure", value: "$12.6k", detail: "Within policy" },
  { label: "Active end clients", value: "14", detail: "Plus 3 POCs" },
  {
    label: "Collected commission",
    value: "$18.4k",
    detail: "Q3 accrued net",
  },
] as const;

const sellerStats = [
  { label: "Active end clients", value: "14", detail: "Named portfolio" },
  { label: "Open quotes", value: "3", detail: "Across assigned clients" },
  { label: "Protected registrations", value: "2", detail: "One due today" },
  { label: "Open disputes", value: "1", detail: "Evidence due in 3 days" },
] as const;

export function PartnerDashboard({ roles }: { roles: readonly string[] }) {
  const copy = customerPartnerCopy.partner;
  const isAdmin = currentPartnerRole(roles) === "partner_admin";
  const visibleUrgent = urgent.filter((item) => isAdmin || !item.adminOnly);
  const stats = isAdmin ? adminStats : sellerStats;
  return (
    <main className={styles.main} id="main-content">
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Agreement clock first</p>
          <h1>{copy.deskTitle}</h1>
          <p>{copy.deskDescription}</p>
        </div>
        <Link className={styles.buttonLink} href="/partner/quotes/new">
          Create resale quote
        </Link>
      </header>

      <section className={styles.term} aria-labelledby="agreement-clock-title">
        <div className={styles.termHeader}>
          <div>
            <p className={styles.eyebrow}>Commercial authority</p>
            <h2 id="agreement-clock-title">{copy.agreementClock}</h2>
          </div>
          <span className={styles.pill} data-tone="active">
            Active
          </span>
        </div>
        <TermBar
          label="Meridian Channel Partner Agreement · v4.1"
          start={new Date("2026-01-01T00:00:00Z")}
          noticeStart={new Date("2026-09-01T00:00:00Z")}
          end={new Date("2026-12-31T00:00:00Z")}
          now={new Date("2026-07-31T16:00:00Z")}
          renewalState="auto-renews"
        />
        <div className={styles.clockMeta}>
          <div>
            <span>Next action</span>
            <strong>Review authority and notice position by Sep 1</strong>
          </div>
          <div>
            <span>Commercial route</span>
            <strong>Resale and two-tier distributor</strong>
          </div>
          <div>
            <span>Merchant boundary</span>
            <strong>Meridian is merchant of record to end clients</strong>
          </div>
        </div>
      </section>

      <section aria-labelledby="urgent-partner-title">
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.eyebrow}>Needs attention</p>
            <h2 id="urgent-partner-title">{copy.urgentTitle}</h2>
          </div>
          <p className={styles.count}>{visibleUrgent.length} actions</p>
        </div>
        <div className={styles.urgentGrid}>
          {visibleUrgent.map((item) => (
            <Link
              className={styles.urgentCard}
              href={item.href}
              key={item.title}
            >
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
              <span className={styles.urgentMeta}>
                <span>Open work</span>
                <strong>{item.meta}</strong>
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className={styles.stats} aria-label="Partner metrics">
        {stats.map((stat) => (
          <article className={styles.stat} key={stat.label}>
            <span>{stat.label}</span>
            <strong>{stat.value}</strong>
            <span>{stat.detail}</span>
          </article>
        ))}
      </section>

      <div className={styles.dashboardGrid}>
        <section
          className={`${styles.section} ${styles.chart}`}
          aria-labelledby="portfolio-chart-title"
        >
          <h2 id="portfolio-chart-title">Committed portfolio capacity</h2>
          <p>
            Current 620 TB compared with 548 TB in the previous 90-day period ·
            refreshed 18 minutes ago
          </p>
          <div
            className={styles.chartBars}
            role="img"
            aria-label="Monthly committed capacity, February through July"
          >
            <span style={{ height: "48%" }} />
            <span style={{ height: "55%" }} />
            <span style={{ height: "62%" }} />
            <span style={{ height: "70%" }} />
            <span style={{ height: "78%" }} />
            <span style={{ height: "88%" }} />
          </div>
        </section>
        <aside
          className={styles.summary}
          aria-labelledby="commercial-boundary-title"
        >
          <h2 id="commercial-boundary-title">Commercial boundary</h2>
          <ul className={styles.summaryList}>
            <li>
              <strong>{copy.transferPrice}:</strong> private to Meridian
            </li>
            <li>
              <strong>{copy.partnerPrice}:</strong> controlled by Meridian
            </li>
            <li>
              <strong>{copy.merchantOfRecord}:</strong> Meridian on resale
              routes
            </li>
          </ul>
          <p className={styles.muted}>{copy.boundary}</p>
        </aside>
      </div>
    </main>
  );
}
