import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import type {
  OnboardingOrganizationDetail,
  OnboardingOrganizationSummary,
} from "@clockwork/db";
import {
  Breadcrumbs,
  EmptyState,
  InlineNotice,
  PageHeader,
  StateBanner,
  Table,
  buttonClassName,
} from "@clockwork/ui";

import { breadcrumbsLabel } from "@/src/features/shared/ui-kit-labels";
import type { MessageId } from "@/src/i18n";
import { getFormattingLocale, getTranslations } from "@/src/i18n/server";

import { formatContractDate } from "../contracts/copy";
import { handoffDay } from "../handoff/model";
import { OperationsPageState } from "../handoff/page-state";
import { countryName, memberRoleLabels, organizationSideLabels } from "./model";
import pageStyles from "../contracts/contracts.module.css";
import styles from "../handoff/handoff.module.css";

/** What the list could read, or why there is nothing to show. */
export type OrganizationListState =
  | { kind: "ready"; organizations: readonly OnboardingOrganizationSummary[] }
  | { kind: "demo" }
  | { kind: "unavailable" };

const organizationHref = (organization: OnboardingOrganizationSummary) =>
  `/internal/organizations/${organization.organizationId}` as Route;

/** The customer and partner organizations at /internal/organizations. */
export async function OrganizationList({
  state,
  canWrite,
}: {
  state: OrganizationListState;
  canWrite: boolean;
}) {
  const [t, locale] = await Promise.all([
    getTranslations(),
    getFormattingLocale(),
  ]);
  const signIn = (organization: OnboardingOrganizationSummary) =>
    organization.identityProviderLinked
      ? t("operations.organizations.signIn.ready")
      : t("operations.organizations.signIn.pending");
  const created = (organization: OnboardingOrganizationSummary) =>
    formatContractDate(handoffDay(organization.createdAt), locale);
  return (
    <main className={pageStyles.page} id="main-content">
      <PageHeader
        title={t("operations.organizations.title")}
        description={t("operations.organizations.description")}
        actions={
          // Creating one needs the store the list reads; hide it with the list.
          canWrite && state.kind === "ready" ? (
            <Link
              className={buttonClassName({ variant: "primary" })}
              href="/internal/organizations/new"
            >
              {t("operations.organizations.new")}
            </Link>
          ) : undefined
        }
      />
      {state.kind === "demo" ? (
        <InlineNotice
          tone="info"
          title={t("operations.organizations.demoTitle")}
          description={t("operations.organizations.demoBody")}
        />
      ) : state.kind === "unavailable" ? (
        <InlineNotice
          tone="danger"
          title={t("operations.organizations.unavailable")}
        />
      ) : state.organizations.length === 0 ? (
        <EmptyState
          title={t("operations.organizations.empty.title")}
          description={t("operations.organizations.empty.description")}
        />
      ) : (
        <>
          <div className={styles.desktopOnly}>
            <Table
              caption={t("operations.organizations.title")}
              captionHidden
              density="compact"
              headers={[
                t("operations.organizations.column.name"),
                t("operations.organizations.column.side"),
                t("operations.organizations.column.country"),
                t("operations.organizations.column.signIn"),
                t("operations.organizations.column.created"),
              ]}
              rowKeys={state.organizations.map((o) => o.organizationId)}
              rows={state.organizations.map((organization) => [
                <Link
                  key="name"
                  className={styles.rowLink}
                  href={organizationHref(organization)}
                >
                  {organization.legalName}
                </Link>,
                t(organizationSideLabels[organization.side]),
                countryName(organization.country),
                signIn(organization),
                created(organization),
              ])}
            />
          </div>
          <ul className={`${styles.mobileOnly} ${styles.mobileList}`}>
            {state.organizations.map((organization) => (
              <li
                className={styles.mobileCard}
                key={organization.organizationId}
              >
                <h2>
                  <Link href={organizationHref(organization)}>
                    {organization.legalName}
                  </Link>
                </h2>
                <dl>
                  <div>
                    <dt>{t("operations.organizations.column.side")}</dt>
                    <dd>{t(organizationSideLabels[organization.side])}</dd>
                  </div>
                  <div>
                    <dt>{t("operations.organizations.column.country")}</dt>
                    <dd>{countryName(organization.country)}</dd>
                  </div>
                  <div>
                    <dt>{t("operations.organizations.column.signIn")}</dt>
                    <dd>{signIn(organization)}</dd>
                  </div>
                  <div>
                    <dt>{t("operations.organizations.column.created")}</dt>
                    <dd>{created(organization)}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}

/** An organization page with nothing to show: off in the demo, or unreadable. */
export function OrganizationPageState({
  heading,
  state,
  unavailable,
}: {
  heading: MessageId;
  state: "demo" | "unavailable";
  unavailable: MessageId;
}) {
  return OperationsPageState({
    heading,
    parent: {
      label: "operations.organizations.title",
      href: "/internal/organizations",
    },
    state,
    demo: {
      title: "operations.organizations.demoTitle",
      body: "operations.organizations.demoBody",
    },
    unavailable,
    className: pageStyles.page,
  });
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
    <main className={pageStyles.page} id="main-content">
      <Breadcrumbs
        label={breadcrumbsLabel(t)}
        items={[
          {
            label: t("operations.organizations.title"),
            href: "/internal/organizations",
          },
          { label: organization.legalName },
        ]}
        renderLink={(href, label) => <Link href={href as Route}>{label}</Link>}
      />
      <PageHeader
        title={organization.legalName}
        metadata={
          <span className={styles.rowHeading}>
            <span>{t(organizationSideLabels[organization.side])}</span>
            <span>{countryName(organization.country)}</span>
            <span>
              {formatContractDate(handoffDay(organization.createdAt), locale)}
            </span>
          </span>
        }
      />
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
        {t("operations.handoff.detail.organization")}
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
