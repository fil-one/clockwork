"use client";

import { useActionState } from "react";
import type { DatabaseCatalogAdmin } from "@clockwork/db";
import type { MessageId } from "@/src/i18n";
import { useTranslations } from "@/src/i18n/client";
import { saveCatalogMapping, type CatalogMappingResult } from "./actions";
import styles from "@/src/features/internal-ops/administration-safety/administration-safety.module.css";

type CatalogRow = Awaited<ReturnType<DatabaseCatalogAdmin["list"]>>[number];

const resultMessages: Readonly<
  Record<Exclude<CatalogMappingResult, "">, MessageId>
> = {
  forbidden: "adminPricing.catalog.result.forbidden",
  invalid: "adminPricing.catalog.result.invalid",
  saved: "adminPricing.catalog.result.saved",
  conflict: "adminPricing.catalog.result.conflict",
  frozen: "adminPricing.catalog.result.frozen",
  failed: "adminPricing.catalog.result.failed",
};

const initialResult: CatalogMappingResult = "";

export function CatalogMappingControls({ row }: { row: CatalogRow }) {
  const t = useTranslations();
  const [result, action, pending] = useActionState(
    saveCatalogMapping,
    initialResult,
  );
  return (
    <form action={action} className={styles.panelBody}>
      <input type="hidden" name="rateCardId" value={row.rateCardId} />
      <input type="hidden" name="expectedRowVersion" value={row.rowVersion} />
      <fieldset disabled={pending}>
        <legend>{t("adminPricing.catalog.form.legend")}</legend>
        <label className={styles.field}>
          {t("adminPricing.catalog.form.providerSku")}
          <input
            name="providerSku"
            required
            maxLength={120}
            defaultValue={row.mapping?.providerSku ?? ""}
          />
        </label>
        <label className={styles.field}>
          {t("adminPricing.catalog.form.providerRegion")}
          <input
            name="providerRegion"
            required
            maxLength={120}
            defaultValue={row.mapping?.providerRegion ?? ""}
          />
        </label>
        <label className={styles.field}>
          {t("adminPricing.catalog.form.meterId")}
          <input
            name="meterId"
            required
            maxLength={160}
            defaultValue={row.mapping?.meterId ?? ""}
          />
        </label>
        <label className={styles.field}>
          {t("adminPricing.catalog.form.sourceEvidence")}
          <input
            name="sourceEvidence"
            required
            maxLength={1000}
            defaultValue={row.mapping?.sourceEvidence ?? ""}
          />
        </label>
        <label className={styles.field}>
          {t("adminPricing.catalog.form.reason")}
          <textarea name="reason" required minLength={8} maxLength={2000} />
        </label>
        <button className={styles.button} type="submit">
          {pending ? t("common.saving") : t("adminPricing.catalog.form.submit")}
        </button>
      </fieldset>
      {result ? <p role="status">{t(resultMessages[result])}</p> : null}
    </form>
  );
}
