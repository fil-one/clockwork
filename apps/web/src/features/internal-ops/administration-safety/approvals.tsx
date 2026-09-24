"use client";
import {
  useFormattingLocale,
  useLocale,
  useTranslations,
} from "@/src/i18n/client";
import type { MessageId, Translator } from "@/src/i18n";

import { useMemo, useState } from "react";

import {
  resolveDemoText,
  type ResolvedDemoText,
} from "@clockwork/testing/demo-localized-text";
import { Select } from "@clockwork/ui";

import { formatMoney } from "@/src/features/shared/format";

import { adminSafetyCopy } from "./copy";
import {
  approvalCases,
  type ApprovalCase,
  type ApprovalCaseKind,
  type SelectOption,
} from "./data";
import { buildReviewSummary, canDecide, type ReviewSummary } from "./policy";
import {
  AdministrationPage,
  HumanSelector,
  ReviewSummaryCard,
  StatusPill,
  TechnicalEvidence,
  styles,
} from "./ui";

/** Demo actors by role; names are data, the role label is a message. */
const actorNames: Readonly<Record<string, [string, MessageId]>> = {
  internal_operator: ["Morgan Ellis", "role.internalOperator"],
  finance_approver: ["Elena Torres", "role.financeApprover"],
  legal_approver: ["Priya Nair", "role.legalApprover"],
  destructive_action_approver: ["Sasha Reed", "role.destructiveActionApprover"],
};

const kindLabels: Readonly<Record<ApprovalCaseKind, MessageId>> = {
  approval: "adminGovernance.approvals.kind.approval",
  rejection: "adminGovernance.approvals.kind.rejection",
  offboarding: "adminGovernance.approvals.kind.offboarding",
  destructive: "adminGovernance.approvals.kind.destructive",
};

const kindReviewLabels: Readonly<Record<ApprovalCaseKind, MessageId>> = {
  approval: "adminGovernance.approvals.kindReview.approval",
  rejection: "adminGovernance.approvals.kindReview.rejection",
  offboarding: "adminGovernance.approvals.kindReview.offboarding",
  destructive: "adminGovernance.approvals.kindReview.destructive",
};

/** A case with its demo text resolved and its summary line formatted. */
type ApprovalCaseView = ResolvedDemoText<Omit<ApprovalCase, "summary">> &
  SelectOption & { description: string };

function presentCase(
  approvalCase: ApprovalCase,
  t: Translator,
  locale: string,
  formattingLocale: string,
): ApprovalCaseView {
  const { summary, ...rest } = approvalCase;
  const description =
    summary.kind === "priceException"
      ? t("adminGovernance.approvals.case.priceException", {
          percent: new Intl.NumberFormat(formattingLocale, {
            style: "percent",
            maximumFractionDigits: 1,
          }).format(summary.belowFloor),
          amount: formatMoney(
            summary.annualValueMinor,
            summary.currency,
            formattingLocale,
          ),
        })
      : resolveDemoText(summary.text, locale);
  return { ...resolveDemoText(rest, locale), description };
}

export function ApprovalWorkspace({ roles }: { roles: readonly string[] }) {
  const t = useTranslations();
  const locale = useLocale();
  const formattingLocale = useFormattingLocale();
  const cases = useMemo(
    () =>
      approvalCases.map((approvalCase) =>
        presentCase(approvalCase, t, locale, formattingLocale),
      ),
    [t, locale, formattingLocale],
  );
  const [caseId, setCaseId] = useState(cases[0]?.id ?? "");
  const [decision, setDecision] = useState<"approved" | "rejected">("approved");
  const [reason, setReason] = useState("");
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const selected =
    cases.find((approvalCase) => approvalCase.id === caseId) ?? cases[0];
  const actor = useMemo(() => {
    const known = roles.map((role) => actorNames[role]).find(Boolean);
    return known
      ? t("common.join.labels", { first: known[0], second: t(known[1]) })
      : t("adminGovernance.approvals.actorFallback");
  }, [roles, t]);

  if (!selected) return null;
  const permitted = canDecide(roles, selected.decision);
  const heading = adminSafetyCopy.approvals;
  const identifiers = selected.identifiers.map(({ label, value }) => ({
    label: t(label),
    value,
  }));

  const resetReview = () => {
    setSummary(null);
  };

  return (
    <AdministrationPage
      eyebrow={t(heading.eyebrow)}
      title={t(heading.title)}
      description={t(heading.description)}
    >
      <div className={styles.decisionGrid}>
        <section className={styles.panel} aria-labelledby="approval-work-title">
          <div className={styles.panelHeading}>
            <div>
              <h2 id="approval-work-title">
                {t("adminGovernance.approvals.casesHeading")}
              </h2>
              <p>
                {t("adminGovernance.approvals.casesCount", {
                  count: cases.length,
                })}
              </p>
            </div>
          </div>
          <div className={styles.caseList}>
            {cases.map((approvalCase) => (
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
                  {t("common.join.labels", {
                    first: t(kindLabels[approvalCase.kind]),
                    second: t("adminGovernance.approvals.ownerIs", {
                      owner: approvalCase.owner,
                    }),
                  })}
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
                {t("common.join.labels", {
                  first: t(kindReviewLabels[selected.kind]),
                  second: t("adminGovernance.approvals.ownerIs", {
                    owner: selected.owner,
                  }),
                })}
              </p>
            </div>
            <StatusPill
              state={t(
                permitted
                  ? "adminGovernance.approvals.authorizedRole"
                  : "adminGovernance.readOnly",
              )}
              tone={permitted ? "success" : "warning"}
            />
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
                      : t("common.join.sentences", {
                          first: t("adminGovernance.approvals.rejectImpact"),
                          second: selected.impact,
                        }),
                  evidence: selected.evidence,
                  policyBasis: selected.policyBasis,
                  downstreamEffect:
                    decision === "approved"
                      ? selected.downstreamEffect
                      : t("adminGovernance.approvals.rejectDownstream"),
                  reason,
                }),
              );
            }}
          >
            <HumanSelector
              label={t("adminGovernance.approvals.affectedCase")}
              name="caseId"
              options={cases}
              value={caseId}
              onChange={(nextId) => {
                setCaseId(nextId || caseId);
                setReason("");
                resetReview();
              }}
            />

            <dl className={styles.metaGrid}>
              <div>
                <dt>{t("adminGovernance.approvals.requestedBy")}</dt>
                <dd>{selected.requestedBy}</dd>
              </div>
              <div>
                <dt>{t("adminGovernance.approvals.authenticatedActor")}</dt>
                <dd>{actor}</dd>
              </div>
              <div>
                <dt>{t("adminGovernance.approvals.policyGates")}</dt>
                <dd>
                  <ul className={styles.gateList}>
                    {selected.gates.map((gate) => (
                      <li key={gate}>{gate}</li>
                    ))}
                  </ul>
                </dd>
              </div>
              <div>
                <dt>{t("adminGovernance.approvals.authority")}</dt>
                <dd>{t("adminGovernance.approvals.authorityDetail")}</dd>
              </div>
            </dl>

            <Select
              label={t("adminGovernance.approvals.decision")}
              name="decision"
              value={decision}
              onChange={(event) => {
                setDecision(
                  event.currentTarget.value as "approved" | "rejected",
                );
                resetReview();
              }}
              options={[
                {
                  value: "approved",
                  label: t("adminGovernance.approvals.approve"),
                },
                {
                  value: "rejected",
                  label: t("adminGovernance.approvals.reject"),
                },
              ]}
            />
            <label className={styles.field}>
              {t("adminGovernance.decisionReason")}
              <textarea
                name="reason"
                value={reason}
                minLength={8}
                required
                placeholder={t("adminGovernance.approvals.reasonPlaceholder")}
                onChange={(event) => {
                  setReason(event.currentTarget.value);
                  resetReview();
                }}
              />
              <span className={styles.fieldHint}>
                {t("adminGovernance.approvals.reasonHint")}
              </span>
            </label>
            {!permitted ? (
              <div className={styles.roleNotice} role="note">
                <strong>
                  {t("adminGovernance.approvals.roleCannotDecide")}
                </strong>
                {t("adminGovernance.approvals.roleCannotDecideDetail")}
              </div>
            ) : null}
            <TechnicalEvidence identifiers={identifiers} />
            <div className={styles.actions}>
              <button
                className={styles.button}
                type="submit"
                disabled={!permitted}
              >
                {t(
                  decision === "approved"
                    ? "adminGovernance.approvals.reviewApprove"
                    : "adminGovernance.approvals.reviewReject",
                )}
              </button>
            </div>
          </form>
        </section>
      </div>

      {summary ? (
        <>
          <ReviewSummaryCard
            summary={summary}
            identifiers={identifiers}
            title={t(
              decision === "approved"
                ? "adminGovernance.approvals.summaryApprove"
                : "adminGovernance.approvals.summaryReject",
            )}
          />
          <section className={styles.handoff} role="note">
            <strong>{t("adminGovernance.approvals.noDecisionRecorded")}</strong>
            <p>{t("adminGovernance.approvals.handoff")}</p>
          </section>
        </>
      ) : null}
    </AdministrationPage>
  );
}
