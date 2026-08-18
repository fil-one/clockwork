"use client";

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
    label: "Prepare commercial quote adjustment",
    impact: "Stages a commercial adjustment for the effective account.",
    policy: "Assisted action policy AS-3 and commercial approval policy CP-4.",
    downstream:
      "Creates a reviewed draft only. Pricing floors and finance approval remain server-enforced.",
  },
  invoice_dispute: {
    label: "Review invoice dispute",
    impact: "Stages an invoice-dispute note for finance review.",
    policy: "Assisted action policy AS-3 and collections policy CL-5.",
    downstream:
      "No credit, refund, or invoice mutation occurs until finance authority validates the request.",
  },
  offboarding_request: {
    label: "Request controlled offboarding",
    impact:
      "Stages a retention-aware offboarding request for the effective account.",
    policy:
      "Assisted action policy AS-3 and retention and teardown policy RT-9.",
    downstream:
      "Starts no teardown. Retrieval, credit, retention, recent-authentication, and dual-control gates remain required.",
  },
} as const;

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
      <AdministrationPage {...adminSafetyCopy.assisted}>
        <section className={styles.roleNotice} role="note">
          <strong>Assisted authority is required.</strong>
          This session cannot load or select customer accounts for assisted
          action.
        </section>
      </AdministrationPage>
    );

  if (sessionActive)
    return (
      <AdministrationPage {...adminSafetyCopy.assisted}>
        <section className={styles.notice} role="note">
          <strong>An assisted session is already active.</strong>
          The effective account remains locked to {account.label}. Use the
          active-session banner to exit before starting a different assisted
          session.
        </section>
      </AdministrationPage>
    );

  if (guidedDemo)
    return (
      <AdministrationPage {...adminSafetyCopy.assisted}>
        <section className={styles.panel} aria-labelledby="assisted-demo-title">
          <div className={styles.panelHeading}>
            <div>
              <h2 id="assisted-demo-title">Assisted identity boundary</h2>
              <p>
                Review the actor and effective-account separation used by the
                production workflow.
              </p>
            </div>
            <StatusPill state="Read only" />
          </div>
          <div className={styles.panelBody}>
            <dl className={styles.metaGrid}>
              <div>
                <dt>Effective account example</dt>
                <dd>{account.label}</dd>
              </div>
              <div>
                <dt>Authenticated staff actor</dt>
                <dd>{actor}</dd>
              </div>
              <div>
                <dt>Session requirement</dt>
                <dd>Provider-backed identity and service database</dd>
              </div>
              <div>
                <dt>Audit boundary</dt>
                <dd>Immutable actor, effective account, reason, and expiry</dd>
              </div>
            </dl>
            <TechnicalEvidence
              identifiers={[
                { label: "Effective account ID", value: account.id },
              ]}
            />
            <div className={styles.roleNotice} role="note">
              <strong>No assisted session is created in this demo.</strong>
              The production action is unavailable until the identity provider
              can bind the staff actor to a time-limited server session.
            </div>
          </div>
        </section>
      </AdministrationPage>
    );

  const resetReview = () => {
    setSummary(null);
  };

  return (
    <AdministrationPage {...adminSafetyCopy.assisted}>
      <section className={styles.notice} role="note">
        <strong>The staff actor never changes.</strong>
        The effective account scopes the customer record. The authenticated
        staff actor, role, and authorization come from the server session and
        cannot be edited here.
      </section>

      <section className={styles.panel} aria-labelledby="assisted-action-title">
        <div className={styles.panelHeading}>
          <div>
            <h2 id="assisted-action-title">Assisted commercial action</h2>
            <p>
              Review is mandatory before any secure submission is available.
            </p>
          </div>
          <StatusPill state={mayAssume ? "Assume authority" : "Read only"} />
        </div>
        <form
          className={styles.panelBody}
          onSubmit={(event) => {
            event.preventDefault();
            setSummary(
              buildReviewSummary({
                entity: `${account.label} · effective assisted account`,
                impact: action.impact,
                evidence: [
                  `Authenticated staff actor: ${actor}`,
                  "Assisted-mode reason captured",
                  "Screening, credit, provider, and role gates shown for review",
                ],
                policyBasis: action.policy,
                downstreamEffect: action.downstream,
                reason,
              }),
            );
          }}
        >
          <HumanSelector
            label="Effective account"
            name="effectiveAccountId"
            options={accounts}
            value={accountId}
            onChange={(id) => {
              if (id) setAccountId(id);
              resetReview();
            }}
          />
          <Select
            label="Assisted action"
            name="action"
            value={actionKey}
            onChange={(event) => {
              setActionKey(event.currentTarget.value as AssistedActionKey);
              resetReview();
            }}
            options={Object.entries(assistedActions).map(([key, value]) => ({
              value: key,
              label: value.label,
            }))}
          />
          <label className={styles.field}>
            Assisted-mode reason
            <textarea
              name="reason"
              value={reason}
              required
              minLength={8}
              placeholder="State who requested help and why staff access is necessary."
              onChange={(event) => {
                setReason(event.currentTarget.value);
                resetReview();
              }}
            />
            <span className={styles.fieldHint}>
              Required, attributed to the staff actor, and retained with the
              action.
            </span>
          </label>
          <dl className={styles.metaGrid}>
            <div>
              <dt>Effective account</dt>
              <dd>{account.label}</dd>
            </div>
            <div>
              <dt>Staff actor</dt>
              <dd>{actor}</dd>
            </div>
            <div>
              <dt>Commercial gates</dt>
              <dd>
                Pricing floors · finance approval · credit state · screening
                state
              </dd>
            </div>
            <div>
              <dt>Operational gates</dt>
              <dd>
                Provider readiness · retention · dual control · actor
                attribution
              </dd>
            </div>
          </dl>
          <TechnicalEvidence
            identifiers={[{ label: "Effective account ID", value: account.id }]}
          />
          {!mayAssume ? (
            <div className={styles.roleNotice} role="note">
              <strong>Assisted authority is required.</strong>
              This role may inspect the review model but cannot act for an
              effective account.
            </div>
          ) : null}
          <div className={styles.actions}>
            <button
              className={styles.button}
              type="submit"
              disabled={!mayAssume}
            >
              Review assisted action
            </button>
          </div>
        </form>
      </section>

      {summary ? (
        <>
          <ReviewSummaryCard
            summary={summary}
            title="Assisted action review"
            identifiers={[{ label: "Effective account ID", value: account.id }]}
          />
          <section className={styles.handoff} role="note">
            <strong>
              {ready && guidedDemo
                ? "Assisted review complete"
                : ready
                  ? "Assisted action not submitted"
                  : "Assisted action remains blocked"}
            </strong>
            <p>
              {guidedDemo
                ? "The guided demo records no effective-account session. A provider-backed identity and service database are required before staff can act for a customer."
                : "Start the time-limited server session to preserve the staff actor and re-evaluate account, role, commercial, screening, credit, retention, and provider gates before every mutation."}
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
                  Start 15-minute assisted session
                </button>
              </form>
            ) : null}
          </section>
        </>
      ) : null}
    </AdministrationPage>
  );
}
