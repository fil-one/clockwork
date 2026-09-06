"use client";
import { useActionState, useId } from "react";
import type {
  ChannelPolicyRecord,
  ChannelPolicyTerms,
} from "@clockwork/domain/core";
import { Button } from "@clockwork/ui";
import { styles } from "@/src/features/internal-ops/administration-safety/ui";
import layout from "./channel-policy.module.css";
import { changeChannelPolicy } from "./actions";
const controls = [
  ["version", "Policy version", 1, 1],
  ["selfServeThresholdTb", "Sales handoff at capacity (TB)", 0.001, "any"],
  ["defaultProtectionDays", "Default requested protection (days)", 1, 1],
  [
    "maximumProtectionDays",
    "Maximum initial requested protection (days)",
    1,
    1,
  ],
  ["extensionDays", "Maximum days per extension", 1, 1],
  ["maximumExtensions", "Maximum extensions", 0, 1],
] as const;
export function ChannelTermsForm({
  current,
  nextVersion,
  today,
}: {
  current?: ChannelPolicyRecord;
  nextVersion: number;
  today: string;
}) {
  const [message, action, pending] = useActionState(changeChannelPolicy, "");
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
          {current ? "Edit draft controls" : "Draft a new policy"}
        </legend>
        {controls.map(([name, label, min, step]) => (
          <label
            className={styles.field}
            key={name}
            htmlFor={`${prefix}-${name}`}
          >
            {label}
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
          Effective date (UTC)
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
          Policy source or evidence reference
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
        {pending ? "Saving…" : "Save draft"}
      </Button>
      {message ? <p role="status">{message}</p> : null}
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
  const [message, action, pending] = useActionState(changeChannelPolicy, "");
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
          {decision === "propose"
            ? "Propose for approval"
            : decision === "approve"
              ? "Approve policy"
              : "Return for changes"}
        </legend>
        <label className={styles.field} htmlFor={`${prefix}-reason`}>
          Decision reason
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
            Approval evidence reference
            <input
              id={`${prefix}-evidence`}
              name="approvalEvidence"
              required
              minLength={8}
              maxLength={2000}
            />
          </label>
        ) : null}
        <Button type="submit" disabled={pending || !allowed}>
          {pending
            ? "Recording…"
            : decision === "propose"
              ? "Propose policy"
              : decision === "approve"
                ? "Approve policy"
                : "Return draft"}
        </Button>
      </fieldset>
      {!allowed ? (
        <p>A different finance approver must decide this version.</p>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
    </form>
  );
}
