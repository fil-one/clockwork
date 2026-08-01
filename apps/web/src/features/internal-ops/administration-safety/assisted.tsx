"use client";

import { useMemo, useState } from "react";

import { internalOpsCopy } from "@/src/features/internal-ops/copy";

import { adminSafetyCopy } from "./copy";
import { accounts } from "./data";
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

const staffActors: Readonly<Record<string, string>> = {
  internal_operator: "Morgan Ellis · Internal operator",
  finance_approver: "Elena Torres · Finance approver",
  legal_approver: "Priya Nair · Legal approver",
  destructive_action_approver: "Sasha Reed · Destructive-action approver",
};

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

export function AssistedMode({ roles }: { roles: readonly string[] }) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [reason, setReason] = useState<string>(internalOpsCopy.assisted.reason);
  const [actionKey, setActionKey] =
    useState<AssistedActionKey>("quote_adjustment");
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const account = accounts.find((item) => item.id === accountId) ?? accounts[0];
  const action = assistedActions[actionKey];
  const actor = useMemo(
    () =>
      roles.map((role) => staffActors[role]).find(Boolean) ??
      "Authenticated staff actor",
    [roles],
  );
  const mayAssume = canDecide(roles, "assisted");
  const reviewed = Boolean(summary);
  const ready = assistedCommercialActionReady({
    roles,
    reviewed,
    reason,
    effectiveAccountId: accountId,
  });

  if (!account) return null;

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
          <label className={styles.field}>
            Assisted action
            <select
              name="action"
              value={actionKey}
              onChange={(event) => {
                setActionKey(event.currentTarget.value as AssistedActionKey);
                resetReview();
              }}
            >
              {Object.entries(assistedActions).map(([key, value]) => (
                <option key={key} value={key}>
                  {value.label}
                </option>
              ))}
            </select>
          </label>
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
              {ready
                ? "Assisted action not submitted"
                : "Assisted action remains blocked"}
            </strong>
            <p>
              Continue in the secure assisted workflow. The server preserves the
              staff actor and re-evaluates account, role, commercial, screening,
              credit, retention, and provider gates before any mutation.
            </p>
          </section>
        </>
      ) : null}
    </AdministrationPage>
  );
}
