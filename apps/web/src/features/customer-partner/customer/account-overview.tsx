import Link from "next/link";

import { StatusBadge } from "@clockwork/ui";

import { customerPartnerCopy } from "../copy";
import styles from "./customer-pages.module.css";

const copy = customerPartnerCopy.customer;

const accountAreas = [
  {
    title: "Users and access",
    description:
      "Review roles, approval authority, MFA state, and pending invitations.",
    meta: "4 active · 1 invitation pending",
    href: "/account/users" as const,
  },
  {
    title: "Procurement",
    description:
      "Maintain invoice delivery, supplier onboarding, purchase orders, and tax evidence.",
    meta: "1 requirement needs attention",
    href: "/account/procurement" as const,
  },
  {
    title: "Offboarding",
    description:
      "Review retrieval, final billing, retention exclusions, and teardown authority.",
    meta: "Confirmation required for every request",
    href: "/account/offboarding" as const,
  },
] as const;

export function AccountOverview({
  canManageAccount = true,
}: {
  canManageAccount?: boolean;
}) {
  return (
    <main className={styles.main} id="main-content">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Customer workspace</p>
          <h1>{copy.accountTitle}</h1>
          <p className={styles.description}>{copy.accountDescription}</p>
        </div>
      </header>

      <section className={styles.panel} aria-labelledby="organization-title">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>Organization</p>
            <h2 id="organization-title">Northstar Archive Labs</h2>
            <p>Direct customer · commercial account in good standing</p>
          </div>
          <StatusBadge tone="success">Verified</StatusBadge>
        </div>
        <dl className={styles.accountFacts}>
          <div>
            <dt>Account owner</dt>
            <dd>Maya Chen</dd>
          </div>
          <div>
            <dt>Billing contact</dt>
            <dd>Elias Romero</dd>
          </div>
          <div>
            <dt>Primary region</dt>
            <dd>US East</dd>
          </div>
          <div>
            <dt>Account currency</dt>
            <dd>USD</dd>
          </div>
        </dl>
      </section>

      <section className={styles.section} aria-labelledby="account-areas-title">
        <div className={styles.sectionHeading}>
          <div>
            <h2 id="account-areas-title">Account controls</h2>
            <p>Choose a task area to review its current state.</p>
          </div>
        </div>
        {canManageAccount ? (
          <div className={styles.accountGrid}>
            {accountAreas.map((area) => (
              <Link
                className={styles.accountCard}
                href={area.href}
                key={area.title}
              >
                <h2>{area.title}</h2>
                <p>{area.description}</p>
                <span>{area.meta} →</span>
              </Link>
            ))}
          </div>
        ) : (
          <p className={styles.permissionNote}>{copy.accountPermissionNote}</p>
        )}
      </section>
    </main>
  );
}
