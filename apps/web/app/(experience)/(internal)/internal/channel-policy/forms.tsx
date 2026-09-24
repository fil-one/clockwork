"use client";
import { useActionState, useId } from "react";
import type {
  ChannelPolicyRecord,
  ChannelPolicyTerms,
} from "@clockwork/domain/core";
import { Button } from "@clockwork/ui";
import { styles } from "@/src/features/internal-ops/administration-safety/ui";
import type { MessageId } from "@/src/i18n";
import { useTranslations } from "@/src/i18n/client";
import layout from "./channel-policy.module.css";
import { changeChannelPolicy, type ChannelPolicyResult } from "./actions";
const controls = [
  ["version", "adminGovernance.channelPolicy.field.version", 1, 1],
  [
    "selfServeThresholdTb",
    "adminGovernance.channelPolicy.field.handoffThreshold",
    0.001,
    "any",
  ],
  [
    "defaultProtectionDays",
    "adminGovernance.channelPolicy.field.defaultProtection",
    1,
    1,
  ],
  [
    "maximumProtectionDays",
    "adminGovernance.channelPolicy.field.maximumProtection",
    1,
    1,
  ],
  ["extensionDays", "adminGovernance.channelPolicy.field.extensionDays", 1, 1],
  [
    "maximumExtensions",
    "adminGovernance.channelPolicy.field.maximumExtensions",
    0,
    1,
  ],
] as const satisfies readonly (readonly [
  string,
  MessageId,
  number,
  number | "any",
])[];
export function ChannelTermsForm({
  current,
  nextVersion,
  today,
}: {
  current?: ChannelPolicyRecord;
  nextVersion: number;
  today: string;
}) {
  const t = useTranslations();
  const [message, action, pending] = useActionState<
    ChannelPolicyResult,
    FormData
  >(changeChannelPolicy, "");
  const prefix = useId();
  const terms: ChannelPolicyTerms = current?.terms ?? {
    version: nextVersion,
    effectiveFrom: today,
    selfServeThresholdTb: 100,
    defaultProtectionDays: 90,
    maximumProtectionDays: 90,
    extensionDays: 90,
    maximumExtensions: 1,
    sourceEvidence: "",
  };
  return (
    <form action={action} className={layout.form}>
      <input type="hidden" name="action" value={current ? "save" : "create"} />
      {current ? (
        <>
          <input type="hidden" name="id" value={current.id} />
          <input
            type="hidden"
            name="expectedRowVersion"
            value={current.rowVersion}
          />
        </>
      ) : null}
      <fieldset className={layout.fields} disabled={pending}>
        <legend>
          {t(
            current
              ? "adminGovernance.channelPolicy.form.editDraft"
              : "adminGovernance.channelPolicy.form.newDraft",
          )}
        </legend>
        {controls.map(([name, label, min, step]) => (
          <label
            className={styles.field}
            key={name}
            htmlFor={`${prefix}-${name}`}
          >
            {t(label)}
            <input
              id={`${prefix}-${name}`}
              name={name}
              type="number"
              required
              min={min}
              step={step}
              defaultValue={terms[name]}
            />
          </label>
        ))}
        <label className={styles.field} htmlFor={`${prefix}-effective`}>
          {t("adminGovernance.channelPolicy.field.effectiveDate")}
          <input
            id={`${prefix}-effective`}
            name="effectiveFrom"
            type="date"
            min={today}
            required
            defaultValue={terms.effectiveFrom}
          />
        </label>
        <label className={styles.field} htmlFor={`${prefix}-source`}>
          {t("adminGovernance.channelPolicy.field.source")}
          <textarea
            id={`${prefix}-source`}
            name="sourceEvidence"
            required
            minLength={8}
            maxLength={2000}
            defaultValue={terms.sourceEvidence}
          />
        </label>
      </fieldset>
      <Button type="submit" disabled={pending}>
        {pending
          ? t("common.saving")
          : t("adminGovernance.channelPolicy.form.saveDraft")}
      </Button>
      {message ? <p role="status">{t(message)}</p> : null}
    </form>
  );
}
export function ChannelDecisionForm({
  record,
  action: decision,
  allowed,
}: {
  record: ChannelPolicyRecord;
  action: "propose" | "approve" | "reject";
  allowed: boolean;
}) {
  const t = useTranslations();
  const [message, action, pending] = useActionState<
    ChannelPolicyResult,
    FormData
  >(changeChannelPolicy, "");
  const prefix = useId();
  return (
    <form action={action} className={layout.form}>
      <input type="hidden" name="action" value={decision} />
      <input type="hidden" name="id" value={record.id} />
      <input
        type="hidden"
        name="expectedRowVersion"
        value={record.rowVersion}
      />
      <fieldset className={layout.fields} disabled={pending || !allowed}>
        <legend>
          {t(
            decision === "propose"
              ? "adminGovernance.channelPolicy.decision.proposeLegend"
              : decision === "approve"
                ? "adminGovernance.channelPolicy.decision.approveLegend"
                : "adminGovernance.channelPolicy.decision.returnLegend",
          )}
        </legend>
        <label className={styles.field} htmlFor={`${prefix}-reason`}>
          {t("adminGovernance.decisionReason")}
          <textarea
            id={`${prefix}-reason`}
            name="reason"
            required
            minLength={8}
            maxLength={2000}
          />
        </label>
        {decision === "approve" ? (
          <label className={styles.field} htmlFor={`${prefix}-evidence`}>
            {t("adminGovernance.channelPolicy.decision.evidence")}
            <input
              id={`${prefix}-evidence`}
              name="approvalEvidence"
              required
              minLength={8}
              maxLength={2000}
            />
          </label>
        ) : null}
        {/* A wrapper, so the grid stretches it rather than the button. */}
        <div>
          <Button type="submit" disabled={pending || !allowed}>
            {t(
              pending
                ? "adminGovernance.channelPolicy.decision.recording"
                : decision === "propose"
                  ? "adminGovernance.channelPolicy.decision.propose"
                  : decision === "approve"
                    ? "adminGovernance.channelPolicy.decision.approve"
                    : "adminGovernance.channelPolicy.decision.return",
            )}
          </Button>
        </div>
      </fieldset>
      {!allowed ? (
        <p>{t("adminGovernance.channelPolicy.decision.otherApprover")}</p>
      ) : null}
      {message ? <p role="status">{t(message)}</p> : null}
    </form>
  );
}
