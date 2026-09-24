"use client";
import { useTranslations } from "@/src/i18n/client";
import type { MessageId } from "@/src/i18n";

import { useState } from "react";

import { Select } from "@clockwork/ui";

import { startAssistedSession } from "@/src/auth/actions";

import { adminSafetyCopy } from "./copy";
import type { SelectOption } from "./data";
import {
  assistedCommercialActionReady,
  buildReviewSummary,
  canDecide,
  type ReviewSummary,
} from "./policy";
import {
  AdministrationPage,
  HumanSelector,
  ReviewSummaryCard,
  StatusPill,
  TechnicalEvidence,
  styles,
} from "./ui";

const assistedActions = {
  quote_adjustment: {
    label: "adminGovernance.assisted.action.quoteAdjustment.label",
    impact: "adminGovernance.assisted.action.quoteAdjustment.impact",
    policy: "adminGovernance.assisted.action.quoteAdjustment.policy",
    downstream: "adminGovernance.assisted.action.quoteAdjustment.downstream",
  },
  invoice_dispute: {
    label: "adminGovernance.assisted.action.invoiceDispute.label",
    impact: "adminGovernance.assisted.action.invoiceDispute.impact",
    policy: "adminGovernance.assisted.action.invoiceDispute.policy",
    downstream: "adminGovernance.assisted.action.invoiceDispute.downstream",
  },
  offboarding_request: {
    label: "adminGovernance.assisted.action.offboarding.label",
    impact: "adminGovernance.assisted.action.offboarding.impact",
    policy: "adminGovernance.assisted.action.offboarding.policy",
    downstream: "adminGovernance.assisted.action.offboarding.downstream",
  },
} as const satisfies Record<string, Record<string, MessageId>>;

type AssistedActionKey = keyof typeof assistedActions;

export function AssistedMode({
  roles,
  accounts,
  actor,
  sessionActive = false,
  guidedDemo = false,
}: {
  roles: readonly string[];
  accounts: readonly SelectOption[];
  actor: string;
  sessionActive?: boolean;
  guidedDemo?: boolean;
}) {
  const t = useTranslations();
  const heading = adminSafetyCopy.assisted;
  const headingText = {
    eyebrow: t(heading.eyebrow),
    title: t(heading.title),
    description: t(heading.description),
  };
  const accountIdentifiers = (id: string) => [
    { label: t("adminGovernance.identifier.effectiveAccount"), value: id },
  ];
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [reason, setReason] = useState("");
  const [actionKey, setActionKey] =
    useState<AssistedActionKey>("quote_adjustment");
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const account = accounts.find((item) => item.id === accountId) ?? accounts[0];
  const action = assistedActions[actionKey];
  const mayAssume = canDecide(roles, "assisted");
  const reviewed = Boolean(summary);
  const ready = assistedCommercialActionReady({
    roles,
    reviewed,
    reason,
    effectiveAccountId: accountId,
  });

  if (!account)
    return (
      <AdministrationPage {...headingText}>
        <section className={styles.roleNotice} role="note">
          <strong>{t("adminGovernance.assisted.authorityRequired")}</strong>
          {t("adminGovernance.assisted.noAccountsDetail")}
        </section>
      </AdministrationPage>
    );

  if (sessionActive)
    return (
      <AdministrationPage {...headingText}>
        <section className={styles.notice} role="note">
          <strong>{t("adminGovernance.assisted.sessionActive")}</strong>
          {t("adminGovernance.assisted.sessionActiveDetail", {
            account: account.label,
          })}
        </section>
      </AdministrationPage>
    );

  if (guidedDemo)
    return (
      <AdministrationPage {...headingText}>
        <section className={styles.panel} aria-labelledby="assisted-demo-title">
          <div className={styles.panelHeading}>
            <div>
              <h2 id="assisted-demo-title">
                {t("adminGovernance.assisted.demo.heading")}
              </h2>
              <p>{t("adminGovernance.assisted.demo.intro")}</p>
            </div>
            <StatusPill state={t("adminGovernance.readOnly")} tone="warning" />
          </div>
          <div className={styles.panelBody}>
            <dl className={styles.metaGrid}>
              <div>
                <dt>{t("adminGovernance.assisted.demo.accountExample")}</dt>
                <dd>{account.label}</dd>
              </div>
              <div>
                <dt>{t("adminGovernance.assisted.authenticatedActor")}</dt>
                <dd>{actor}</dd>
              </div>
              <div>
                <dt>{t("adminGovernance.assisted.demo.sessionRequirement")}</dt>
                <dd>
                  {t("adminGovernance.assisted.demo.sessionRequirementDetail")}
                </dd>
              </div>
              <div>
                <dt>{t("adminGovernance.assisted.demo.auditBoundary")}</dt>
                <dd>
                  {t("adminGovernance.assisted.demo.auditBoundaryDetail")}
                </dd>
              </div>
            </dl>
            <TechnicalEvidence identifiers={accountIdentifiers(account.id)} />
            <div className={styles.roleNotice} role="note">
              <strong>{t("adminGovernance.assisted.demo.noSession")}</strong>
              {t("adminGovernance.assisted.demo.noSessionDetail")}
            </div>
          </div>
        </section>
      </AdministrationPage>
    );

  const resetReview = () => {
    setSummary(null);
  };

  return (
    <AdministrationPage {...headingText}>
      <section className={styles.notice} role="note">
        <strong>{t("adminGovernance.assisted.actorFixed")}</strong>
        {t("adminGovernance.assisted.actorFixedDetail")}
      </section>

      <section className={styles.panel} aria-labelledby="assisted-action-title">
        <div className={styles.panelHeading}>
          <div>
            <h2 id="assisted-action-title">
              {t("adminGovernance.assisted.actionHeading")}
            </h2>
            <p>{t("adminGovernance.assisted.actionIntro")}</p>
          </div>
          <StatusPill
            state={t(
              mayAssume
                ? "adminGovernance.assisted.mayAct"
                : "adminGovernance.readOnly",
            )}
            tone="warning"
          />
        </div>
        <form
          className={styles.panelBody}
          onSubmit={(event) => {
            event.preventDefault();
            setSummary(
              buildReviewSummary({
                entity: t("adminGovernance.assisted.review.entity", {
                  account: account.label,
                }),
                impact: t(action.impact),
                evidence: [
                  t("adminGovernance.assisted.review.actor", { actor }),
                  t("adminGovernance.assisted.review.reasonCaptured"),
                  t("adminGovernance.assisted.review.gatesShown"),
                ],
                policyBasis: t(action.policy),
                downstreamEffect: t(action.downstream),
                reason,
              }),
            );
          }}
        >
          <HumanSelector
            label={t("adminGovernance.assisted.effectiveAccount")}
            name="effectiveAccountId"
            options={accounts}
            value={accountId}
            onChange={(id) => {
              if (id) setAccountId(id);
              resetReview();
            }}
          />
          <Select
            label={t("adminGovernance.assisted.actionLabel")}
            name="action"
            value={actionKey}
            onChange={(event) => {
              setActionKey(event.currentTarget.value as AssistedActionKey);
              resetReview();
            }}
            options={Object.entries(assistedActions).map(([key, value]) => ({
              value: key,
              label: t(value.label),
            }))}
          />
          <label className={styles.field}>
            {t("adminGovernance.assisted.reason")}
            <textarea
              name="reason"
              value={reason}
              required
              minLength={8}
              placeholder={t("adminGovernance.assisted.reasonPlaceholder")}
              onChange={(event) => {
                setReason(event.currentTarget.value);
                resetReview();
              }}
            />
            <span className={styles.fieldHint}>
              {t("adminGovernance.assisted.reasonHint")}
            </span>
          </label>
          <dl className={styles.metaGrid}>
            <div>
              <dt>{t("adminGovernance.assisted.effectiveAccount")}</dt>
              <dd>{account.label}</dd>
            </div>
            <div>
              <dt>{t("adminGovernance.assisted.staffActor")}</dt>
              <dd>{actor}</dd>
            </div>
            <div>
              <dt>{t("adminGovernance.assisted.commercialGates")}</dt>
              <dd>{t("adminGovernance.assisted.commercialGatesDetail")}</dd>
            </div>
            <div>
              <dt>{t("adminGovernance.assisted.operationalGates")}</dt>
              <dd>{t("adminGovernance.assisted.operationalGatesDetail")}</dd>
            </div>
          </dl>
          <TechnicalEvidence identifiers={accountIdentifiers(account.id)} />
          {!mayAssume ? (
            <div className={styles.roleNotice} role="note">
              <strong>{t("adminGovernance.assisted.authorityRequired")}</strong>
              {t("adminGovernance.assisted.roleCannotActDetail")}
            </div>
          ) : null}
          <div className={styles.actions}>
            <button
              className={styles.button}
              type="submit"
              disabled={!mayAssume}
            >
              {t("adminGovernance.assisted.reviewAction")}
            </button>
          </div>
        </form>
      </section>

      {summary ? (
        <>
          <ReviewSummaryCard
            summary={summary}
            title={t("adminGovernance.assisted.summaryTitle")}
            identifiers={accountIdentifiers(account.id)}
          />
          <section className={styles.handoff} role="note">
            <strong>
              {t(
                ready && guidedDemo
                  ? "adminGovernance.assisted.handoff.reviewComplete"
                  : ready
                    ? "adminGovernance.assisted.handoff.notSubmitted"
                    : "adminGovernance.assisted.handoff.blocked",
              )}
            </strong>
            <p>
              {t(
                guidedDemo
                  ? "adminGovernance.assisted.handoff.demoDetail"
                  : "adminGovernance.assisted.handoff.startDetail",
              )}
            </p>
            {ready && !guidedDemo ? (
              <form action={startAssistedSession}>
                <input
                  type="hidden"
                  name="targetAccountId"
                  value={account.id}
                />
                <input type="hidden" name="reason" value={reason} />
                <button className={styles.button} type="submit">
                  {t("adminGovernance.assisted.startSession")}
                </button>
              </form>
            ) : null}
          </section>
        </>
      ) : null}
    </AdministrationPage>
  );
}
