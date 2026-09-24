import { getTranslations } from "@/src/i18n/server";
import { use } from "react";
import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";

import { StatusBadge } from "@clockwork/ui";

import type { Translator } from "@/src/i18n";

import styles from "./customer-pages.module.css";

export interface AccountOverviewProjection {
  accountName: string;
  organizationName: string;
  roleLabel: string;
  facts: readonly { label: string; value: string }[];
  areaMeta: { users: string; procurement: string };
}

function accountAreas(
  meta: AccountOverviewProjection["areaMeta"],
  t: Translator,
) {
  return [
    {
      key: "users",
      title: t("customer.collection.users.title"),
      description: t("customer.account.areas.users.description"),
      meta: meta.users,
      href: "/account/users" as Route,
    },
    {
      key: "procurement",
      title: t("customer.collection.procurement.title"),
      description: t("customer.account.areas.procurement.description"),
      meta: meta.procurement,
      href: "/account/procurement" as Route,
    },
    {
      key: "offboarding",
      title: t("customer.account.areas.offboarding.title"),
      description: t("customer.account.areas.offboarding.description"),
      meta: t("customer.account.areas.offboarding.meta"),
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
  return (
    <main className={styles.main} id="main-content">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{t("customer.account.eyebrow")}</p>
          <h1>{t("customer.account.title")}</h1>
          <p className={styles.description}>
            {t("customer.account.description")}
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
            <h2 id="account-areas-title">
              {t("customer.account.controls.title")}
            </h2>
            <p>{t("customer.account.controls.description")}</p>
          </div>
        </div>
        {canManageAccount ? (
          <div className={styles.accountGrid}>
            {accountAreas(projection.areaMeta, t).map((area) => (
              <Link
                className={styles.accountCard}
                href={area.href}
                key={area.key}
              >
                <h2>{area.title}</h2>
                <p>{area.description}</p>
                <span>
                  {area.meta}{" "}
                  <span aria-hidden="true">{t("customer.link.arrow")}</span>
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <p className={styles.permissionNote}>
            {t("customer.account.permissionNote")}
          </p>
        )}
      </section>

      {actions}
    </main>
  );
}
