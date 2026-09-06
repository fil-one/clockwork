"use client";
import { useActionState } from "react";
import type { ProviderReferenceRow } from "@clockwork/db";
import { saveProviderReference } from "./actions";
import styles from "@/src/features/internal-ops/administration-safety/administration-safety.module.css";

export function ProviderReferenceControls({
  row,
}: {
  row: ProviderReferenceRow;
}) {
  const [message, action, pending] = useActionState(saveProviderReference, "");
  const current = row.configuration;
  return (
    <form action={action} className={styles.panelBody}>
      <input type="hidden" name="provider" value={row.provider} />
      <input type="hidden" name="expectedRowVersion" value={row.rowVersion} />
      <fieldset disabled={pending}>
        <legend>
          {current ? "Update operating reference" : "Add operating reference"}
        </legend>
        <label className={styles.field}>
          Secret-manager reference
          <input
            name="secretReference"
            required
            maxLength={1000}
            placeholder="vault:commerce/provider/credential"
            defaultValue={current?.secretReference ?? ""}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <p>
          Enter the path only. Never paste a token, password, private key, or
          connection URL.
        </p>
        <label className={styles.field}>
          Secret version
          <input
            name="secretVersion"
            required
            maxLength={200}
            defaultValue={current?.secretVersion ?? ""}
            autoComplete="off"
          />
        </label>
        <label className={styles.field}>
          Actual rotation timestamp (UTC)
          <input
            name="rotatedAt"
            required
            placeholder="2026-09-06T12:00:00.000Z"
            defaultValue={current?.rotatedAt ?? ""}
            spellCheck={false}
          />
        </label>
        <label className={styles.field}>
          Operating owner
          <input
            name="owner"
            required
            maxLength={200}
            defaultValue={
              row.source === "bootstrap" ? "" : (current?.owner ?? "")
            }
          />
        </label>
        <label className={styles.field}>
          Rotation review interval (days)
          <input
            name="reviewIntervalDays"
            type="number"
            min={1}
            max={730}
            required
            defaultValue={current?.reviewIntervalDays ?? 90}
          />
        </label>
        <p>
          This sets the review due date shown here. It does not rotate
          credentials or send a reminder.
        </p>
        <label className={styles.field}>
          Rotation evidence reference
          <input
            name="sourceEvidence"
            required
            maxLength={1000}
            defaultValue={current?.sourceEvidence ?? ""}
          />
        </label>
        <label className={styles.field}>
          Reason for change
          <textarea name="reason" minLength={8} maxLength={2000} required />
        </label>
        <button className={styles.button} type="submit">
          {pending ? "Saving…" : "Save provider reference"}
        </button>
      </fieldset>
      {message ? <p role="status">{message}</p> : null}
    </form>
  );
}
