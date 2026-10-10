import type { Route } from "next";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";

import type {
  PartnerActivity,
  PartnerDealWithConflicts,
  PartnerOrganizationOption,
  PartnerRecord,
} from "@clockwork/contracts";
import {
  Breadcrumbs,
  InlineNotice,
  PageHeader,
  StateBanner,
  StatusBadge,
  Tag,
  buttonClassName,
} from "@clockwork/ui";

import { breadcrumbsLabel } from "@/src/features/shared/ui-kit-labels";
import type { MessageId, Translator } from "@/src/i18n";

import {
  contractStatusLabels,
  contractTypeLabels,
  formatContractDate,
} from "../contracts/copy";
import { LocalTimestamp } from "../local-timestamp";
import { mndaStateLabels } from "../mnda/labels";
import { DealForm } from "./deal-form";
import {
  partnerDealModelLabels,
  partnerDealStatusLabels,
  partnerDealStatusTone,
  partnerEditHref,
  partnerExclusivityLabels,
  partnerModelLabels,
  partnerStatusLabels,
  partnerStatusTone,
  partnersPath,
} from "./model";
import type { PartnerLinks } from "./server";
import styles from "./partners.module.css";

/** The field names a history entry lists, in the reader's words. */
const fieldLabels: Readonly<Record<string, MessageId>> = {
  name: "operations.partners.field.name",
  website: "operations.partners.field.website",
  region: "operations.partners.field.region",
  models: "operations.partners.field.models",
  status: "operations.partners.field.status",
  ownerId: "operations.partners.field.owner",
  ownerName: "operations.partners.field.owner",
  organizationId: "operations.partners.field.organization",
  contacts: "operations.partners.contacts.title",
  nextStep: "operations.partners.field.nextStep",
  nextStepDue: "operations.partners.field.nextStepDue",
  notes: "operations.partners.field.notes",
  commissionPct: "operations.partners.terms.commissionPct",
  commissionSchedule: "operations.partners.terms.commissionSchedule",
  commissionSteps: "operations.partners.terms.steps",
  marginPct: "operations.partners.terms.marginPct",
  territory: "operations.partners.terms.territory",
  exclusivity: "operations.partners.terms.exclusivity",
  exclusivityNote: "operations.partners.terms.exclusivityNote",
  currency: "operations.partners.terms.currency",
  nfrAllowance: "operations.partners.terms.nfrAllowance",
  trialPeriod: "operations.partners.terms.trialPeriod",
  trialTargets: "operations.partners.terms.trialTargets",
  termRows: "operations.partners.terms.rows",
  endClient: "operations.partners.deals.endClient",
  registeredOn: "operations.partners.deals.registeredOn",
  protectedUntil: "operations.partners.deals.protectedUntil",
  estimatedSize: "operations.partners.deals.estimatedSize",
  sizeUnit: "operations.partners.deals.sizeUnit",
  model: "operations.partners.deals.model",
};

function changedFields(entry: PartnerActivity, t: Translator): string {
  // The owner's id and name change together; name the field once.
  const names = [
    ...new Set(
      Object.keys(entry.changes).map((key) => {
        const label = fieldLabels[key];
        return label ? t(label) : key;
      }),
    ),
  ];
  return names.length
    ? names.join(", ")
    : t("operations.partners.history.nothing");
}

function historyLine(entry: PartnerActivity, t: Translator): string {
  const actor = entry.actorName;
  const client = entry.dealEndClient ?? "";
  switch (entry.eventType) {
    case "partner.created":
      return t("operations.partners.history.created", { actor });
    case "partner.updated":
      return t("operations.partners.history.updated", {
        actor,
        fields: changedFields(entry, t),
      });
    case "partner.deal_registered":
      return t("operations.partners.history.dealRegistered", { actor, client });
    case "partner.deal_updated":
      return t("operations.partners.history.dealUpdated", {
        actor,
        client,
        fields: changedFields(entry, t),
      });
    case "partner.deal_expired":
      return t("operations.partners.history.dealExpired", { client });
    default:
      return t("operations.partners.history.other", {
        actor,
        event: entry.eventType,
      });
  }
}

function Facts({ items }: { items: readonly [string, ReactNode][] }) {
  return (
    <dl className={styles.facts}>
      {/* Free-form rows may repeat a label, so position is the key. */}
      {items.map(([term, detail], index) => (
        <Fragment key={index}>
          <dt>{term}</dt>
          <dd>{detail}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

function Terms({ partner, t }: { partner: PartnerRecord; t: Translator }) {
  const { terms } = partner;
  const items: [string, ReactNode][] = [];
  const add = (label: MessageId, value: ReactNode) => {
    if (value !== null && value !== "" && value !== undefined)
      items.push([t(label), value]);
  };
  add(
    "operations.partners.terms.commissionPct",
    terms.commissionPct ? `${terms.commissionPct}%` : null,
  );
  add("operations.partners.terms.commissionSchedule", terms.commissionSchedule);
  add(
    "operations.partners.terms.steps",
    terms.commissionSteps.length ? (
      <ul className={styles.conflicts}>
        {terms.commissionSteps.map((step) => (
          <li key={step.fromMonth}>
            {t("operations.partners.terms.stepLine", {
              month: step.fromMonth,
              rate: step.ratePct,
            })}
          </li>
        ))}
      </ul>
    ) : null,
  );
  add(
    "operations.partners.terms.marginPct",
    terms.marginPct ? `${terms.marginPct}%` : null,
  );
  add("operations.partners.terms.currency", terms.currency);
  add("operations.partners.terms.territory", terms.territory);
  add(
    "operations.partners.terms.exclusivity",
    terms.exclusivity
      ? [t(partnerExclusivityLabels[terms.exclusivity]), terms.exclusivityNote]
          .filter(Boolean)
          .join(". ")
      : terms.exclusivityNote,
  );
  add("operations.partners.terms.nfrAllowance", terms.nfrAllowance);
  add("operations.partners.terms.trialPeriod", terms.trialPeriod);
  add("operations.partners.terms.trialTargets", terms.trialTargets);
  for (const row of terms.rows)
    items.push([
      row.label,
      row.notes ? `${row.value}\n${row.notes}` : row.value,
    ]);
  return (
    <section className={styles.card} aria-labelledby="partner-terms">
      <h2 id="partner-terms">{t("operations.partners.terms.title")}</h2>
      {items.length ? (
        <Facts items={items} />
      ) : (
        <p className={styles.muted}>{t("operations.partners.terms.empty")}</p>
      )}
    </section>
  );
}

function Deals({
  partner,
  deals,
  t,
  locale,
  today,
  canEdit,
  protectionDays,
  organizations,
}: {
  partner: PartnerRecord;
  deals: readonly PartnerDealWithConflicts[];
  t: Translator;
  locale: string;
  today: string;
  canEdit: boolean;
  protectionDays: number;
  organizations: readonly PartnerOrganizationOption[];
}) {
  return (
    <section className={styles.card} aria-labelledby="partner-deals">
      <h2 id="partner-deals">{t("operations.partners.deals.title")}</h2>
      <p className={styles.muted}>
        {t("operations.partners.deals.description")}
      </p>
      {canEdit ? (
        <DealForm
          partnerId={partner.id}
          deal={null}
          today={today}
          protectionDays={protectionDays}
          organizations={organizations}
        />
      ) : null}
      {deals.length === 0 ? (
        <p className={styles.muted}>{t("operations.partners.deals.empty")}</p>
      ) : (
        <ul className={styles.list}>
          {deals.map((deal) => (
            <li key={deal.id} data-deal={deal.id}>
              <div className={styles.rowHeading}>
                <h3>{deal.endClient}</h3>
                <StatusBadge tone={partnerDealStatusTone[deal.status]}>
                  {t(partnerDealStatusLabels[deal.status])}
                </StatusBadge>
                <Tag>{t(partnerDealModelLabels[deal.model])}</Tag>
                {deal.estimatedSize && deal.sizeUnit ? (
                  <Tag>
                    {t("operations.partners.deals.size", {
                      size: deal.estimatedSize,
                      unit: deal.sizeUnit,
                    })}
                  </Tag>
                ) : null}
              </div>
              <span className={styles.secondary}>
                {t("operations.partners.deals.protection", {
                  registered: formatContractDate(deal.registeredOn, locale),
                  until: formatContractDate(deal.protectedUntil, locale),
                })}
                {deal.organizationName ? ` · ${deal.organizationName}` : ""}
              </span>
              {deal.notes ? (
                <p className={`${styles.muted} ${styles.prose}`}>
                  {deal.notes}
                </p>
              ) : null}
              {deal.conflicts.length ? (
                <StateBanner
                  tone="warning"
                  title={t("operations.partners.deals.conflictTitle")}
                  description={
                    <ul className={styles.conflicts}>
                      {deal.conflicts.map((conflict) => (
                        <li key={conflict.dealId}>
                          <Link
                            href={
                              `/internal/partners/${conflict.partnerId}` as Route
                            }
                          >
                            {t("operations.partners.deals.conflictLine", {
                              partner: conflict.partnerName,
                              status: t(
                                partnerDealStatusLabels[conflict.status],
                              ),
                              registered: formatContractDate(
                                conflict.registeredOn,
                                locale,
                              ),
                              until: formatContractDate(
                                conflict.protectedUntil,
                                locale,
                              ),
                            })}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  }
                />
              ) : null}
              {canEdit ? (
                <DealForm
                  partnerId={partner.id}
                  deal={deal}
                  today={today}
                  protectionDays={protectionDays}
                  organizations={organizations}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Links({
  links,
  t,
  locale,
}: {
  links: PartnerLinks | null;
  t: Translator;
  locale: string;
}) {
  const empty = !links || (!links.mndas.length && !links.contracts.length);
  return (
    <section className={styles.card} aria-labelledby="partner-links">
      <h2 id="partner-links">{t("operations.partners.links.title")}</h2>
      <p className={styles.muted}>
        {t("operations.partners.links.description")}
      </p>
      {links === null ? (
        <p className={styles.muted}>
          {t("operations.partners.access.errorBody")}
        </p>
      ) : empty ? (
        <p className={styles.muted}>{t("operations.partners.links.empty")}</p>
      ) : (
        <ul className={styles.list}>
          {links.mndas.map((mnda) => (
            <li key={mnda.id}>
              <Link
                href={
                  `/internal/mndas?q=${encodeURIComponent(mnda.company)}` as Route
                }
              >
                {mnda.company}
              </Link>
              <span className={styles.secondary}>
                {t("operations.partners.links.mnda", {
                  status: t(mndaStateLabels[mnda.state]),
                  owner: mnda.ownerName,
                })}
                {" · "}
                {formatContractDate(
                  (mnda.completedAt ?? mnda.createdAt).slice(0, 10),
                  locale,
                )}
              </span>
            </li>
          ))}
          {links.contracts.map((contract) => (
            <li key={contract.id}>
              <Link href={`/internal/contracts/${contract.id}` as Route}>
                {contract.counterpartyName}
              </Link>
              <span className={styles.secondary}>
                {t("operations.partners.links.contract", {
                  type: t(contractTypeLabels[contract.contractType]),
                  status: t(contractStatusLabels[contract.status]),
                  owner: contract.ownerName,
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function History({
  activity,
  t,
  locale,
}: {
  activity: readonly PartnerActivity[];
  t: Translator;
  locale: string;
}) {
  return (
    <section className={styles.card} aria-labelledby="partner-history">
      <h2 id="partner-history">{t("operations.partners.history.title")}</h2>
      {activity.length === 0 ? (
        <p className={styles.muted}>{t("operations.partners.history.empty")}</p>
      ) : (
        <ul className={styles.list}>
          {activity.map((entry) => (
            <li key={entry.id}>
              <span>{historyLine(entry, t)}</span>
              <span className={styles.secondary}>
                <LocalTimestamp value={entry.occurredAt} locale={locale} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** One partner at /internal/partners/[id]. */
export function PartnerDetail({
  t,
  locale,
  partner,
  deals,
  activity,
  links,
  today,
  protectionDays,
  organizations,
  canEdit,
  demo,
}: {
  t: Translator;
  locale: string;
  partner: PartnerRecord;
  deals: readonly PartnerDealWithConflicts[];
  activity: readonly PartnerActivity[];
  links: PartnerLinks | null;
  today: string;
  protectionDays: number;
  organizations: readonly PartnerOrganizationOption[];
  canEdit: boolean;
  demo: boolean;
}) {
  const overdue = partner.nextStepDue !== null && partner.nextStepDue < today;
  const overview: [string, ReactNode][] = [
    [
      t("operations.partners.field.models"),
      partner.models.length ? (
        <span className={styles.tags}>
          {partner.models.map((model) => (
            <Tag key={model}>{t(partnerModelLabels[model])}</Tag>
          ))}
        </span>
      ) : (
        t("operations.partners.notSet")
      ),
    ],
    [
      t("operations.partners.field.owner"),
      partner.ownerName ?? t("operations.partners.unowned"),
    ],
    [
      t("operations.partners.field.region"),
      partner.region || t("operations.partners.notSet"),
    ],
    [
      t("operations.partners.field.website"),
      partner.website ? (
        /^https?:\/\//i.test(partner.website) ? (
          <a href={partner.website} target="_blank" rel="noreferrer noopener">
            {partner.website}
          </a>
        ) : (
          partner.website
        )
      ) : (
        t("operations.partners.notSet")
      ),
    ],
    [
      t("operations.partners.field.nextStep"),
      partner.nextStep || partner.nextStepDue ? (
        <span className={styles.cellStack}>
          {partner.nextStep ? <span>{partner.nextStep}</span> : null}
          {partner.nextStepDue ? (
            <span className={overdue ? styles.overdue : styles.secondary}>
              {t(
                overdue
                  ? "operations.partners.overdueOn"
                  : "operations.partners.dueOn",
                { date: formatContractDate(partner.nextStepDue, locale) },
              )}
            </span>
          ) : null}
        </span>
      ) : (
        t("operations.partners.none")
      ),
    ],
    [
      t("operations.partners.field.organization"),
      partner.organizationName ??
        t("operations.partners.field.organizationNone"),
    ],
    [t("operations.partners.field.createdBy"), partner.createdByName],
    [
      t("operations.partners.field.updated"),
      <LocalTimestamp
        key="updated"
        value={partner.updatedAt}
        locale={locale}
      />,
    ],
  ];
  return (
    <main className={styles.main} id="main-content">
      <Breadcrumbs
        label={breadcrumbsLabel(t)}
        items={[
          { label: t("operations.partners.title"), href: partnersPath },
          { label: partner.name },
        ]}
        renderLink={(href, label) => <Link href={href as Route}>{label}</Link>}
      />
      <PageHeader
        title={partner.name}
        metadata={
          <StatusBadge tone={partnerStatusTone[partner.status]}>
            {t(partnerStatusLabels[partner.status])}
          </StatusBadge>
        }
        actions={
          canEdit ? (
            <Link
              className={buttonClassName()}
              href={partnerEditHref(partner.id)}
            >
              {t("operations.partners.detail.edit")}
            </Link>
          ) : undefined
        }
      />
      {demo ? (
        <InlineNotice tone="info" title={t("operations.partners.demo")} />
      ) : null}
      <div className={styles.columns}>
        <div className={styles.column}>
          <section className={styles.card} aria-labelledby="partner-overview">
            <h2 id="partner-overview">
              {t("operations.partners.detail.summary")}
            </h2>
            <Facts items={overview} />
          </section>
          <Terms partner={partner} t={t} />
          <Deals
            partner={partner}
            deals={deals}
            t={t}
            locale={locale}
            today={today}
            canEdit={canEdit}
            protectionDays={protectionDays}
            organizations={organizations}
          />
        </div>
        <div className={styles.column}>
          <section className={styles.card} aria-labelledby="partner-contacts">
            <h2 id="partner-contacts">
              {t("operations.partners.contacts.title")}
            </h2>
            {partner.contacts.length ? (
              <ul className={styles.list}>
                {partner.contacts.map((contact, index) => (
                  <li key={`${contact.name}-${index}`}>
                    <strong>{contact.name}</strong>
                    {contact.role ? (
                      <span className={styles.secondary}>{contact.role}</span>
                    ) : null}
                    {contact.email ? (
                      <a href={`mailto:${contact.email}`}>{contact.email}</a>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.muted}>
                {t("operations.partners.contacts.empty")}
              </p>
            )}
          </section>
          {partner.notes ? (
            <section className={styles.card} aria-labelledby="partner-notes">
              <h2 id="partner-notes">{t("operations.partners.field.notes")}</h2>
              <p className={`${styles.muted} ${styles.prose}`}>
                {partner.notes}
              </p>
            </section>
          ) : null}
          <Links links={links} t={t} locale={locale} />
          <History activity={activity} t={t} locale={locale} />
        </div>
      </div>
    </main>
  );
}
