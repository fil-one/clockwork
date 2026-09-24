import type { Metadata } from "next";
import styles from "@/src/features/internal-ops/administration-safety/administration-safety.module.css";
import layout from "./channel-policy.module.css";
import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";
import {
  DemoCommercialPolicyRepository,
  localizeDemoChannelPolicy,
} from "@/src/features/internal-ops/commercial-policies/demo-policies";
import Link from "next/link";
import type { ReactNode } from "react";
import { DatabaseChannelPolicyRepository } from "@clockwork/db";
import {
  legacyChannelDefaults,
  type ChannelPolicyRecord,
  type ChannelPolicySnapshot,
} from "@clockwork/domain/core";
import { getCommerceSession } from "@/src/auth/session";
import { getOptionalServiceDatabase } from "@/src/db/service";
import {
  AdministrationPage,
  StatusPill,
} from "@/src/features/internal-ops/administration-safety/ui";
import type { StatusTone } from "@/src/features/internal-ops/administration-safety/copy";
import { formatDate } from "@/src/features/shared/format";
import type { MessageId, Translator } from "@/src/i18n";
import {
  getFormattingLocale,
  getLocale,
  getTranslations,
} from "@/src/i18n/server";
import { ChannelDecisionForm, ChannelTermsForm } from "./forms";
export const dynamic = "force-dynamic";

const statusLabels: Readonly<Record<ChannelPolicyRecord["status"], MessageId>> =
  {
    draft: "status.draft",
    proposed: "adminGovernance.channelPolicy.status.proposed",
    approved: "adminGovernance.channelPolicy.status.approved",
  };
const statusTones: Readonly<Record<ChannelPolicyRecord["status"], StatusTone>> =
  {
    draft: "warning",
    proposed: "warning",
    approved: "success",
  };

/** Capacity in the reader's format, with the unit set smaller than the value. */
function terabytes(value: number, locale: string): ReactNode {
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "terabyte",
    maximumFractionDigits: 3,
  })
    .formatToParts(value)
    .map((part, index) =>
      part.type === "unit" ? (
        <small key={index}>{part.value}</small>
      ) : (
        part.value
      ),
    );
}

/**
 * A day count as one message, with the number set larger than the words
 * around it. A form that says the number in words is shown as written.
 */
function days(count: number, t: Translator, locale: string): ReactNode {
  const text = t("adminGovernance.channelPolicy.days", { count });
  const number = new Intl.NumberFormat(locale).format(count);
  const at = text.indexOf(number);
  if (at < 0) return text;
  const before = text.slice(0, at);
  const after = text.slice(at + number.length);
  return (
    <>
      {before.trim() ? <small>{before}</small> : before}
      {number}
      {after.trim() ? <small>{after}</small> : after}
    </>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("adminGovernance.channelPolicy.title") };
}

export default async function Page() {
  const session = await getCommerceSession();
  if (!session.isInternalStaff)
    // i18n-exempt: thrown to the route's error boundary, which shows its own copy
    throw new Error("Internal staff authority is required");
  const [t, locale, formattingLocale] = await Promise.all([
    getTranslations(),
    getLocale(),
    getFormattingLocale(),
  ]);
  let records: ChannelPolicyRecord[] = [];
  let active: ChannelPolicySnapshot = legacyChannelDefaults;
  let available = false;
  const database = getOptionalServiceDatabase();
  const demo = demoDeployIdentityEnabled(process.env);
  if (demo && session.roles.includes("finance_approver")) {
    const repo = new DemoCommercialPolicyRepository();
    const [demoRecords, demoActive] = await Promise.all([
      repo.listChannel(),
      repo.active(),
    ]);
    // Demo read boundary: the fixture's decision reason and source evidence
    // stand in for text a finance user would type, so they are shown in the
    // reader's language while they still hold the fixture's words. A policy
    // someone edited keeps their text.
    records = demoRecords.map((record) =>
      localizeDemoChannelPolicy(record, locale),
    );
    active = demoActive;
    available = true;
  }
  if (
    !demo &&
    database &&
    session.providerBacked &&
    session.roles.includes("finance_approver")
  )
    try {
      const repo = new DatabaseChannelPolicyRepository(database);
      [records, active] = await Promise.all([repo.list(), repo.active()]);
      available = true;
    } catch {
      /* No fixture substitutes for an authoritative policy read. */
    }
  const today = new Date().toISOString().slice(0, 10);
  const duration = (count: number) =>
    t("adminGovernance.channelPolicy.days", { count });
  return (
    <AdministrationPage
      eyebrow={t("adminGovernance.channelPolicy.eyebrow")}
      title={t("adminGovernance.channelPolicy.title")}
      description={t("adminGovernance.channelPolicy.description")}
      actions={
        <Link className={styles.buttonSecondary} href="/internal/price-books">
          {t("adminGovernance.channelPolicy.priceBooksLink")}
        </Link>
      }
    >
      <div className={layout.workspace}>
        {demo ? (
          <p className={styles.notice}>
            {t("adminGovernance.channelPolicy.demoNotice")}
          </p>
        ) : null}
        {!available ? (
          <section className={styles.panel}>
            <div className={styles.panelBody}>
              <h2>{t("adminGovernance.channelPolicy.unavailable")}</h2>
              <p>{t("adminGovernance.channelPolicy.unavailableDetail")}</p>
            </div>
          </section>
        ) : (
          <>
            <section className={styles.panel}>
              <div className={styles.panelBody}>
                <div className={layout.cardHeading}>
                  <h2>{t("adminGovernance.channelPolicy.currentControls")}</h2>
                  <StatusPill
                    state={
                      active.source === "approved_policy"
                        ? t("adminGovernance.channelPolicy.approvedVersion", {
                            version: active.version,
                          })
                        : t("adminGovernance.channelPolicy.legacyDefaults")
                    }
                    tone={
                      active.source === "approved_policy"
                        ? "success"
                        : "warning"
                    }
                  />
                </div>
                <div className={layout.metrics}>
                  <div>
                    <span>
                      {t("adminGovernance.channelPolicy.salesHandoff")}
                    </span>
                    <strong>
                      {terabytes(active.selfServeThresholdTb, formattingLocale)}
                    </strong>
                    <p>
                      {t("adminGovernance.channelPolicy.salesHandoffDetail")}
                    </p>
                  </div>
                  <div>
                    <span>
                      {t("adminGovernance.channelPolicy.requestedProtection")}
                    </span>
                    <strong>
                      {days(active.defaultProtectionDays, t, formattingLocale)}
                    </strong>
                    <p>
                      {t(
                        "adminGovernance.channelPolicy.requestedProtectionDetail",
                      )}
                    </p>
                  </div>
                </div>
                <p>
                  {t("common.join.sentences", {
                    first:
                      active.source === "approved_policy"
                        ? t("adminGovernance.channelPolicy.fromApproved", {
                            version: active.version,
                          })
                        : t("adminGovernance.channelPolicy.fromLegacy"),
                    second: t("adminGovernance.channelPolicy.scopeNote"),
                  })}
                </p>
              </div>
            </section>
            {records.map((record) => (
              <section
                className={styles.panel}
                key={`${record.id}:${record.rowVersion}`}
              >
                <div className={styles.panelBody}>
                  <div className={layout.cardHeading}>
                    <h2>
                      {t("adminGovernance.channelPolicy.policyVersion", {
                        version: record.terms.version,
                      })}
                    </h2>
                    <StatusPill
                      state={t(statusLabels[record.status])}
                      tone={statusTones[record.status]}
                    />
                  </div>
                  <p>
                    {t("adminGovernance.channelPolicy.effectiveFrom", {
                      date: formatDate(
                        record.terms.effectiveFrom,
                        formattingLocale,
                      ),
                    })}
                  </p>
                  <dl className={layout.facts}>
                    <dt>{t("adminGovernance.channelPolicy.salesHandoff")}</dt>
                    <dd>
                      {new Intl.NumberFormat(formattingLocale, {
                        style: "unit",
                        unit: "terabyte",
                        maximumFractionDigits: 3,
                      }).format(record.terms.selfServeThresholdTb)}
                    </dd>
                    <dt>
                      {t("adminGovernance.channelPolicy.requestedProtection")}
                    </dt>
                    <dd>
                      {t("adminGovernance.channelPolicy.protectionTerms", {
                        default: duration(record.terms.defaultProtectionDays),
                        maximum: duration(record.terms.maximumProtectionDays),
                      })}
                    </dd>
                    <dt>{t("adminGovernance.channelPolicy.extensions")}</dt>
                    <dd>
                      {record.terms.maximumExtensions === 0
                        ? t("adminGovernance.channelPolicy.noExtensions")
                        : t("adminGovernance.channelPolicy.extensionTerms", {
                            count: record.terms.maximumExtensions,
                            duration: duration(record.terms.extensionDays),
                          })}
                    </dd>
                    <dt>{t("adminGovernance.channelPolicy.source")}</dt>
                    <dd>{record.terms.sourceEvidence}</dd>
                  </dl>
                  {record.decisionReason ? (
                    <p className={layout.decisionNote}>
                      <strong>
                        {t("adminGovernance.channelPolicy.decisionNote")}
                      </strong>{" "}
                      {record.decisionReason}
                    </p>
                  ) : null}
                  {record.status === "draft" ? (
                    <>
                      <details className={layout.disclosure}>
                        <summary>
                          {t("adminGovernance.channelPolicy.editDraft")}
                        </summary>
                        <ChannelTermsForm
                          current={record}
                          nextVersion={record.terms.version}
                          today={today}
                        />
                      </details>
                      <ChannelDecisionForm
                        record={record}
                        action="propose"
                        allowed
                      />
                    </>
                  ) : record.status === "proposed" ? (
                    <div className={layout.decisions}>
                      <ChannelDecisionForm
                        record={record}
                        action="approve"
                        allowed={
                          ![
                            record.createdBy,
                            record.lastEditedBy,
                            record.proposedBy,
                          ].includes(session.userId)
                        }
                      />
                      <ChannelDecisionForm
                        record={record}
                        action="reject"
                        allowed={
                          ![
                            record.createdBy,
                            record.lastEditedBy,
                            record.proposedBy,
                          ].includes(session.userId)
                        }
                      />
                    </div>
                  ) : (
                    <p>{t("adminGovernance.channelPolicy.immutable")}</p>
                  )}
                </div>
              </section>
            ))}
            <section className={styles.panel}>
              <div className={styles.panelBody}>
                <ChannelTermsForm
                  nextVersion={
                    Math.max(
                      0,
                      ...records.map((record) => record.terms.version),
                    ) + 1
                  }
                  today={today}
                />
              </div>
            </section>
          </>
        )}
      </div>
    </AdministrationPage>
  );
}
