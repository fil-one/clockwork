"use client";

import { useActionState } from "react";
import type { DatabaseCatalogAdmin } from "@clockwork/db";
import { saveCatalogMapping } from "./actions";
import styles from "@/src/features/internal-ops/administration-safety/administration-safety.module.css";

type CatalogRow = Awaited<ReturnType<DatabaseCatalogAdmin["list"]>>[number];
export function CatalogMappingControls({ row }: { row: CatalogRow }) {
  const [message, action, pending] = useActionState(saveCatalogMapping, "");
  return (
    <form action={action} className={styles.panelBody}>
      <input type="hidden" name="rateCardId" value={row.rateCardId} />
      <input type="hidden" name="expectedRowVersion" value={row.rowVersion} />
      <fieldset disabled={pending}>
        <legend>Draft provider mapping</legend>
        <label className={styles.field}>
          Provider SKU
          <input
            name="providerSku"
            required
            maxLength={120}
            defaultValue={row.mapping?.providerSku ?? ""}
          />
        </label>
        <label className={styles.field}>
          Provider region
          <input
            name="providerRegion"
            required
            maxLength={120}
            defaultValue={row.mapping?.providerRegion ?? ""}
          />
        </label>
        <label className={styles.field}>
          Source meter identifier
          <input
            name="meterId"
            required
            maxLength={160}
            defaultValue={row.mapping?.meterId ?? ""}
          />
        </label>
        <label className={styles.field}>
          Source evidence reference
          <input
            name="sourceEvidence"
            required
            maxLength={1000}
            defaultValue={row.mapping?.sourceEvidence ?? ""}
          />
        </label>
        <label className={styles.field}>
          Reason for change
          <textarea name="reason" required minLength={8} maxLength={2000} />
        </label>
        <button className={styles.button} type="submit">
          {pending ? "Saving…" : "Save draft mapping"}
        </button>
      </fieldset>
      {message ? <p role="status">{message}</p> : null}
    </form>
  );
}
