"use client";
import { useActionState } from "react";
import type { ProviderReferenceRow } from "@clockwork/db";
import { saveProviderReference, type ProviderReferenceResult } from "./actions";
import styles from "@/src/features/internal-ops/administration-safety/administration-safety.module.css";
import { useTranslations } from "@/src/i18n/client";

/** Format examples: identifiers and ISO syntax, the same in every language. */
const secretReferenceExample = "vault:commerce/provider/credential";
const rotationTimestampExample = "2026-09-06T12:00:00.000Z";

export function ProviderReferenceControls({
  row,
}: {
  row: ProviderReferenceRow;
}) {
  const t = useTranslations();
  const [message, action, pending] = useActionState<
    ProviderReferenceResult,
    FormData
  >(saveProviderReference, "");
  const current = row.configuration;
  return (
    <form action={action} className={styles.panelBody}>
      <input type="hidden" name="provider" value={row.provider} />
      <input type="hidden" name="expectedRowVersion" value={row.rowVersion} />
      <fieldset disabled={pending}>
        <legend>
          {t(
            current
              ? "adminGovernance.providers.form.update"
              : "adminGovernance.providers.form.add",
          )}
        </legend>
        <label className={styles.field}>
          {t("adminGovernance.providers.secretReference")}
          <input
            name="secretReference"
            required
            maxLength={1000}
            placeholder={secretReferenceExample}
            defaultValue={current?.secretReference ?? ""}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <p>{t("adminGovernance.providers.form.pathOnly")}</p>
        <label className={styles.field}>
          {t("adminGovernance.providers.secretVersion")}
          <input
            name="secretVersion"
            required
            maxLength={200}
            defaultValue={current?.secretVersion ?? ""}
            autoComplete="off"
          />
        </label>
        <label className={styles.field}>
          {t("adminGovernance.providers.form.rotatedAt")}
          <input
            name="rotatedAt"
            required
            placeholder={rotationTimestampExample}
            defaultValue={current?.rotatedAt ?? ""}
            spellCheck={false}
          />
        </label>
        <label className={styles.field}>
          {t("adminGovernance.providers.owner")}
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
          {t("adminGovernance.providers.form.reviewInterval")}
          <input
            name="reviewIntervalDays"
            type="number"
            min={1}
            max={730}
            required
            defaultValue={current?.reviewIntervalDays ?? 90}
          />
        </label>
        <p>{t("adminGovernance.providers.form.reviewIntervalHint")}</p>
        <label className={styles.field}>
          {t("adminGovernance.providers.form.rotationEvidence")}
          <input
            name="sourceEvidence"
            required
            maxLength={1000}
            defaultValue={current?.sourceEvidence ?? ""}
          />
        </label>
        <label className={styles.field}>
          {t("adminGovernance.providers.form.reason")}
          <textarea name="reason" minLength={8} maxLength={2000} required />
        </label>
        <button className={styles.button} type="submit">
          {pending ? t("common.saving") : t("adminGovernance.providers.save")}
        </button>
      </fieldset>
      {message ? <p role="status">{t(message)}</p> : null}
    </form>
  );
}
