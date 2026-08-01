"use client";

import { useMemo, useState } from "react";

import { adminSafetyCopy } from "./copy";
import { approvalCases } from "./data";
import { buildReviewSummary, canDecide, type ReviewSummary } from "./policy";
import {
  AdministrationPage,
  HumanSelector,
  ReviewSummaryCard,
  StatusPill,
  TechnicalEvidence,
  styles,
} from "./ui";

const actorNames: Readonly<Record<string, string>> = {
  internal_operator: "Morgan Ellis · Internal operator",
  finance_approver: "Elena Torres · Finance approver",
  legal_approver: "Priya Nair · Legal approver",
  destructive_action_approver: "Sasha Reed · Destructive-action approver",
};

export function ApprovalWorkspace({ roles }: { roles: readonly string[] }) {
  const [caseId, setCaseId] = useState(approvalCases[0]?.id ?? "");
  const [decision, setDecision] = useState<"approved" | "rejected">("approved");
  const [reason, setReason] = useState("");
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const selected =
    approvalCases.find((approvalCase) => approvalCase.id === caseId) ??
    approvalCases[0];
  const actor = useMemo(
    () =>
      roles.map((role) => actorNames[role]).find(Boolean) ??
      "Authenticated staff actor",
    [roles],
  );

  if (!selected) return null;
  const permitted = canDecide(roles, selected.decision);

  const resetReview = () => {
    setSummary(null);
  };

  return (
    <AdministrationPage {...adminSafetyCopy.approvals}>
      <div className={styles.decisionGrid}>
        <section className={styles.panel} aria-labelledby="approval-work-title">
          <div className={styles.panelHeading}>
            <div>
              <h2 id="approval-work-title">Decision work</h2>
              <p>
                {approvalCases.length} cases demonstrate segregated authority.
              </p>
            </div>
          </div>
          <div className={styles.caseList}>
            {approvalCases.map((approvalCase) => (
              <button
                className={styles.caseButton}
                type="button"
                key={approvalCase.id}
                aria-pressed={approvalCase.id === selected.id}
                onClick={() => {
                  setCaseId(approvalCase.id);
                  setDecision("approved");
                  setReason("");
                  resetReview();
                }}
              >
                <strong>{approvalCase.label}</strong>
                <span>
                  {approvalCase.kind} · Owner {approvalCase.owner}
                </span>
                <small>{approvalCase.description}</small>
              </button>
            ))}
          </div>
        </section>

        <section
          className={styles.panel}
          aria-labelledby="approval-detail-title"
        >
          <div className={styles.panelHeading}>
            <div>
              <h2 id="approval-detail-title">{selected.label}</h2>
              <p>
                {selected.kind} review · Owner {selected.owner}
              </p>
            </div>
            <StatusPill state={permitted ? "Authorized role" : "Read only"} />
          </div>
          <form
            className={styles.panelBody}
            onSubmit={(event) => {
              event.preventDefault();
              setSummary(
                buildReviewSummary({
                  entity: selected.label,
                  impact:
                    decision === "approved"
                      ? selected.impact
                      : `Rejects the requested operation. ${selected.impact}`,
                  evidence: selected.evidence,
                  policyBasis: selected.policyBasis,
                  downstreamEffect:
                    decision === "approved"
                      ? selected.downstreamEffect
                      : "The request remains blocked and returns to its owner with the recorded reason.",
                  reason,
                }),
              );
            }}
          >
            <HumanSelector
              label="Affected case"
              name="caseId"
              options={approvalCases}
              value={caseId}
              onChange={(nextId) => {
                setCaseId(nextId || caseId);
                setReason("");
                resetReview();
              }}
            />

            <dl className={styles.metaGrid}>
              <div>
                <dt>Requested by</dt>
                <dd>{selected.requestedBy}</dd>
              </div>
              <div>
                <dt>Authenticated actor</dt>
                <dd>{actor}</dd>
              </div>
              <div>
                <dt>Policy gates</dt>
                <dd>
                  <ul className={styles.gateList}>
                    {selected.gates.map((gate) => (
                      <li key={gate}>{gate}</li>
                    ))}
                  </ul>
                </dd>
              </div>
              <div>
                <dt>Authority</dt>
                <dd>
                  Server session role, requester separation, recent
                  authentication, and dual control are rechecked when the
                  decision is submitted.
                </dd>
              </div>
            </dl>

            <label className={styles.field}>
              Decision
              <select
                name="decision"
                value={decision}
                onChange={(event) => {
                  setDecision(
                    event.currentTarget.value as "approved" | "rejected",
                  );
                  resetReview();
                }}
              >
                <option value="approved">Approve</option>
                <option value="rejected">Reject</option>
              </select>
            </label>
            <label className={styles.field}>
              Decision reason
              <textarea
                name="reason"
                value={reason}
                minLength={8}
                required
                placeholder="State the evidence and policy rationale for this decision."
                onChange={(event) => {
                  setReason(event.currentTarget.value);
                  resetReview();
                }}
              />
              <span className={styles.fieldHint}>
                Required for approvals and rejections; retained with actor
                attribution.
              </span>
            </label>
            {!permitted ? (
              <div className={styles.roleNotice} role="note">
                <strong>This role cannot decide this case.</strong>
                You may inspect evidence, but the matching finance, legal, or
                destructive-action authority must record the decision.
              </div>
            ) : null}
            <TechnicalEvidence identifiers={selected.identifiers} />
            <div className={styles.actions}>
              <button
                className={styles.button}
                type="submit"
                disabled={!permitted}
              >
                Review {decision === "approved" ? "approval" : "rejection"}
              </button>
            </div>
          </form>
        </section>
      </div>

      {summary ? (
        <>
          <ReviewSummaryCard
            summary={summary}
            identifiers={selected.identifiers}
            title={`${decision === "approved" ? "Approval" : "Rejection"} review summary`}
          />
          <section className={styles.handoff} role="note">
            <strong>Secure decision submission required</strong>
            <p>
              This review has not recorded an approval or rejection. Continue in
              the authorized server workflow, where authority, actor separation,
              evidence, retention, and policy gates are revalidated.
            </p>
          </section>
        </>
      ) : null}
    </AdministrationPage>
  );
}
