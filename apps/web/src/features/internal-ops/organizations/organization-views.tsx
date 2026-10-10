import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import type {
  OnboardingOrganizationDetail,
  OnboardingOrganizationSummary,
} from "@clockwork/db";
import {
  EmptyState,
  StateBanner,
  StatusBadge,
  buttonClassName,
} from "@clockwork/ui";

import { getFormattingLocale, getTranslations } from "@/src/i18n/server";

import { formatContractDate } from "../contracts/copy";
import { handoffDay } from "../handoff/model";
import { memberRoleLabels, organizationSideLabels } from "./model";
import styles from "../handoff/handoff.module.css";

/** The customer and partner organizations at /internal/organizations. */
export async function OrganizationList({
  organizations,
  canWrite,
}: {
  /** Null when the list could not be read. */
  organizations: readonly OnboardingOrganizationSummary[] | null;
  canWrite: boolean;
}) {
  const [t, locale] = await Promise.all([
    getTranslations(),
    getFormattingLocale(),
  ]);
  return (
    <main className={styles.main} id="main-content">
      <header className={styles.header}>
        <h1>{t("operations.organizations.title")}</h1>
        <p>{t("operations.organizations.description")}</p>
      </header>
      {canWrite ? (
        <div className={styles.actions}>
          <Link
            className={buttonClassName({ variant: "primary" })}
            href="/internal/organizations/new"
          >
            {t("operations.organizations.new")}
          </Link>
        </div>
      ) : null}
      {organizations === null ? (
        <StateBanner
          tone="danger"
          title={t("operations.organizations.unavailable")}
        />
      ) : organizations.length === 0 ? (
        <EmptyState
          title={t("operations.organizations.empty.title")}
          description={t("operations.organizations.empty.description")}
        />
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{t("operations.organizations.column.name")}</th>
                <th scope="col">{t("operations.organizations.column.side")}</th>
                <th scope="col">
                  {t("operations.organizations.column.country")}
                </th>
                <th scope="col">
                  {t("operations.organizations.column.signIn")}
                </th>
                <th scope="col">
                  {t("operations.organizations.column.created")}
                </th>
              </tr>
            </thead>
            <tbody>
              {organizations.map((organization) => (
                <tr key={organization.organizationId}>
                  <td>
                    <Link
                      href={
                        `/internal/organizations/${organization.organizationId}` as Route
                      }
                    >
                      {organization.legalName}
                    </Link>
                  </td>
                  <td>{t(organizationSideLabels[organization.side])}</td>
                  <td>{organization.country}</td>
                  <td>
                    {organization.identityProviderLinked
                      ? t("operations.organizations.signIn.ready")
                      : t("operations.organizations.signIn.pending")}
                  </td>
                  <td>
                    {formatContractDate(
                      handoffDay(organization.createdAt),
                      locale,
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

/** One organization: its account, people and where it came from. */
export async function OrganizationDetail({
  organization,
  created,
  children,
}: {
  organization: OnboardingOrganizationDetail;
  /** The reader just created it. */
  created: boolean;
  /** Further sections, such as invitations. */
  children?: ReactNode;
}) {
  const [t, locale] = await Promise.all([
    getTranslations(),
    getFormattingLocale(),
  ]);
  const roleLabel = (role: string) => {
    const label = memberRoleLabels[role];
    return label ? t(label) : role;
  };
  return (
    <main className={styles.main} id="main-content">
      <header className={styles.header}>
        <Link href="/internal/organizations">
          {t("operations.organizations.detail.back")}
        </Link>
        <h1>{organization.legalName}</h1>
        <p className={styles.rowHeading}>
          <StatusBadge>
            {t(organizationSideLabels[organization.side])}
          </StatusBadge>
          <span>{organization.country}</span>
          <span>
            {formatContractDate(handoffDay(organization.createdAt), locale)}
          </span>
        </p>
      </header>
      {created ? (
        <StateBanner
          tone="success"
          title={t("operations.organizations.detail.created")}
        />
      ) : null}
      <section className={styles.card} aria-labelledby="organization-account">
        <h2 id="organization-account">
          {t("operations.organizations.detail.account")}
        </h2>
        <dl className={styles.facts}>
          <dt>{t("operations.organizations.detail.domain")}</dt>
          <dd>{organization.domain}</dd>
          <dt>{t("operations.organizations.detail.currency")}</dt>
          <dd>{organization.currency}</dd>
          <dt>{t("operations.organizations.detail.billing")}</dt>
          <dd>
            {[
              organization.billingContact.name,
              organization.billingContact.email,
            ]
              .filter(Boolean)
              .join(", ")}
          </dd>
          <dt>{t("operations.organizations.detail.screening")}</dt>
          <dd>{organization.screeningStatus}</dd>
          {organization.partnerAgreementType ? (
            <>
              <dt>{t("operations.organizations.detail.agreementType")}</dt>
              <dd>{organization.partnerAgreementType}</dd>
            </>
          ) : null}
          <dt>{t("operations.organizations.detail.signIn")}</dt>
          <dd>
            {organization.identityProviderLinked
              ? t("operations.organizations.signIn.ready")
              : t("operations.organizations.signIn.pending")}
          </dd>
          {organization.handoffRequestIds.length > 0 ? (
            <>
              <dt>{t("operations.organizations.detail.handoffs")}</dt>
              <dd>
                {organization.handoffRequestIds.map((id) => (
                  <Link key={id} href={`/internal/handoffs/${id}` as Route}>
                    {t("operations.handoff.detail.title")}
                  </Link>
                ))}
              </dd>
            </>
          ) : null}
        </dl>
      </section>
      <section className={styles.card} aria-labelledby="organization-people">
        <h2 id="organization-people">
          {t("operations.organizations.detail.members")}
        </h2>
        {organization.members.length === 0 ? (
          <p className={styles.muted}>
            {t("operations.organizations.detail.noMembers")}
          </p>
        ) : (
          <ul className={styles.list}>
            {organization.members.map((member) => (
              <li key={member.userId}>
                <strong>{member.name}</strong>
                <span className={styles.muted}>
                  {member.email}, {roleLabel(member.role)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {children}
    </main>
  );
}

/** The organization step on a handoff operations is working. */
export async function HandoffOrganizationStep({
  handoffId,
  organizationId,
  status,
  canWork,
}: {
  handoffId: string;
  organizationId: string | null;
  status: string;
  canWork: boolean;
}) {
  const t = await getTranslations();
  if (organizationId)
    return (
      <div className={styles.actions}>
        <Link
          className={buttonClassName({ variant: "secondary" })}
          href={`/internal/organizations/${organizationId}` as Route}
        >
          {t("operations.organizations.handoff.open")}
        </Link>
      </div>
    );
  if (!canWork || status !== "in_progress") return null;
  return (
    <section className={styles.card} aria-labelledby="handoff-organization">
      <h2 id="handoff-organization">
        {t("operations.organizations.handoff.setUp")}
      </h2>
      <p className={styles.muted}>
        {t("operations.organizations.handoff.next")}
      </p>
      <div className={styles.actions}>
        <Link
          className={buttonClassName({ variant: "primary" })}
          href={`/internal/organizations/new?handoff=${handoffId}` as Route}
        >
          {t("operations.organizations.handoff.setUp")}
        </Link>
      </div>
    </section>
  );
}
