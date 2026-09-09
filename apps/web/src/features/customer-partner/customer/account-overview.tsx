import { localizeCopy } from "@/src/i18n/copy";
import { getTranslations } from "@/src/i18n/server";
import { use } from "react";
import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";

import { StatusBadge } from "@clockwork/ui";

import { t as englishTranslator } from "@/src/i18n/en";

import { customerPartnerCopy } from "../copy";
import styles from "./customer-pages.module.css";

const copy = customerPartnerCopy.customer;

export interface AccountOverviewProjection {
  accountName: string;
  organizationName: string;
  roleLabel: string;
  facts: readonly { label: string; value: string }[];
  areaMeta: { users: string; procurement: string };
}

function accountAreas(
  meta: AccountOverviewProjection["areaMeta"],
  t = englishTranslator,
) {
  return [
    {
      title: "Users and access",
      description:
        "Review roles, approval authority, MFA state, and pending invitations.",
      meta: meta.users,
      href: "/account/users" as Route,
    },
    {
      title: "Procurement",
      description:
        "Maintain invoice delivery, supplier onboarding, purchase orders, and tax evidence.",
      meta: meta.procurement,
      href: "/account/procurement" as Route,
    },
    {
      title: "Offboarding",
      description:
        "Review retrieval, final billing, retention exclusions, and teardown authority.",
      meta: t("account.areas.offboarding.meta"),
      href: "/account/offboarding" as Route,
    },
  ];
}

export function AccountOverview({
  projection,
  canManageAccount = true,
  actions,
}: {
  projection: AccountOverviewProjection;
  canManageAccount?: boolean;
  /**
   * Server-backed account action, supplied by the route so the panel carries
   * the route's own permission gate rather than a second guess at it.
   */
  actions?: ReactNode;
}) {
  const t = use(getTranslations());
  const localizedcopy = localizeCopy(copy, t);
  return (
    <main className={styles.main} id="main-content">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{t("ui.103")}</p>
          <h1>{localizedcopy.accountTitle}</h1>
          <p className={styles.description}>
            {localizedcopy.accountDescription}
          </p>
        </div>
      </header>

      <section className={styles.panel} aria-labelledby="organization-title">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>{t("nav.group.organization")}</p>
            <h2 id="organization-title">{projection.accountName}</h2>
            <p>{projection.organizationName}</p>
          </div>
          <StatusBadge tone="neutral">{projection.roleLabel}</StatusBadge>
        </div>
        <dl className={styles.accountFacts}>
          {projection.facts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
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
            {accountAreas(projection.areaMeta, t).map((area) => (
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
          <p className={styles.permissionNote}>
            {localizedcopy.accountPermissionNote}
          </p>
        )}
      </section>

      {actions}
    </main>
  );
}
