"use client";

import type { ContractApprovalState, MndaState } from "@clockwork/contracts";
import { useTranslations } from "@/src/i18n/client";
import styles from "./signing-progress.module.css";

type StepId =
  "prepared" | "approved" | "sent" | "counterparty" | "countersigned" | "saved";
type StepStatus = "done" | "current" | "pending" | "unconfirmed" | "rejected";
interface Evidence {
  state: MndaState;
  prepared: boolean;
  sent?: boolean;
  counterpartySigns?: boolean;
  approval?: ContractApprovalState;
}

/** Uses stored evidence only. A held/closed state cannot prove earlier signatures. */
export function signingProgress(
  evidence: Evidence,
): { id: StepId; status: StepStatus }[] {
  const completed = evidence.state === "completed";
  const awaiting = evidence.state === "awaiting_countersignature";
  const sent =
    evidence.sent ||
    ["sent", "viewed", "awaiting_countersignature", "completed"].includes(
      evidence.state,
    );
  const uncertain =
    evidence.approval === "rejected" ||
    ["attention", "declined", "expired", "canceled"].includes(evidence.state);
  const checkpoints: { id: StepId; done: boolean }[] = [
    { id: "prepared", done: evidence.prepared || completed },
    ...(evidence.approval
      ? [
          {
            id: "approved" as const,
            done:
              evidence.approval === "approved" ||
              evidence.approval === "not_required",
          },
        ]
      : []),
    { id: "sent", done: Boolean(sent) },
    ...(evidence.counterpartySigns === false
      ? []
      : [{ id: "counterparty" as const, done: awaiting || completed }]),
    { id: "countersigned", done: completed },
    // The workflow persists completion and the executed PDF together.
    { id: "saved", done: completed },
  ];
  let currentAssigned = false;
  return checkpoints.map(({ id, done }) => {
    if (done) return { id, status: "done" };
    if (id === "approved" && evidence.approval === "rejected")
      return { id, status: "rejected" };
    if (uncertain) return { id, status: "unconfirmed" };
    if (!currentAssigned) {
      currentAssigned = true;
      return { id, status: "current" };
    }
    return { id, status: "pending" };
  });
}

export function SigningProgress({
  subject,
  ...evidence
}: Evidence & { subject: string }) {
  const t = useTranslations();
  return (
    <details className={styles.progress}>
      <summary aria-label={t("operations.signingProgress.for", { subject })}>
        {t("operations.signingProgress.view")}
      </summary>
      <ol aria-label={t("operations.signingProgress.title")}>
        {signingProgress(evidence).map(({ id, status }) => (
          <li key={id} aria-current={status === "current" ? "step" : undefined}>
            <span>{t(`operations.signingProgress.step.${id}`)}</span>
            <strong data-status={status}>
              {status === "done" ? <span aria-hidden="true">✓ </span> : null}
              {t(`operations.signingProgress.status.${status}`)}
            </strong>
          </li>
        ))}
      </ol>
    </details>
  );
}
