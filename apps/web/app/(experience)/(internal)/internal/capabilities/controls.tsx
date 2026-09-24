"use client";

import { useActionState } from "react";
import type { DatabaseSystemCapabilityAdmin } from "@clockwork/db";
import { changeCapability, type CapabilityActionResult } from "./actions";
import { formatSurfaceTimestamp } from "@/src/features/customer-partner/formatting";
import styles from "@/src/features/internal-ops/administration-safety/administration-safety.module.css";
import { useFormattingLocale, useTranslations } from "@/src/i18n/client";

type Capability = Awaited<
  ReturnType<DatabaseSystemCapabilityAdmin["list"]>
>[number];

export function CapabilityControls({
  capability,
  canOperate,
  canApprove,
}: {
  capability: Capability;
  canOperate: boolean;
  canApprove: boolean;
}) {
  const t = useTranslations();
  const formattingLocale = useFormattingLocale();
  const [message, action, pending] = useActionState<
    CapabilityActionResult,
    FormData
  >(changeCapability, "");
  return (
    <form action={action} className={styles.panelBody}>
      <input
        type="hidden"
        name="capabilityKey"
        value={capability.capabilityKey}
      />
      <input
        type="hidden"
        name="expectedRowVersion"
        value={capability.rowVersion}
      />
      {capability.pending ? (
        <>
          <input
            type="hidden"
            name="proposalId"
            value={capability.pending.id}
          />
          <p>
            <strong>
              {t(
                capability.pending.enableRecovery
                  ? "adminGovernance.capabilities.pendingRecovery"
                  : "adminGovernance.capabilities.pendingNewWork",
              )}
            </strong>
          </p>
          <p>
            {t("adminGovernance.capabilities.requestedBy", {
              actor: capability.pending.requestedBy,
              time: formatSurfaceTimestamp(
                capability.pending.requestedAt.toISOString(),
                { locale: formattingLocale, timeZone: "UTC" },
              ),
            })}
          </p>
          <p>{capability.pending.reason}</p>
          <p>
            {t("adminGovernance.capabilities.evidence", {
              reference: capability.pending.evidenceReference,
            })}
          </p>
        </>
      ) : null}
      <label className={styles.field}>
        {t("adminGovernance.capabilities.controlScope")}
        <select name="recovery" defaultValue="false">
          <option value="false">
            {t("adminGovernance.capabilities.scope.newWork")}
          </option>
          <option value="true">
            {t("adminGovernance.capabilities.scope.recoveryWork")}
          </option>
        </select>
      </label>
      <label className={styles.field}>
        {t("adminGovernance.decisionReason")}
        <textarea
          name="reason"
          required
          minLength={8}
          maxLength={2000}
          placeholder={t("adminGovernance.capabilities.reasonPlaceholder")}
        />
      </label>
      {canOperate && !capability.pending ? (
        <label className={styles.field}>
          {t("adminGovernance.capabilities.evidenceReference")}
          <input
            name="evidenceReference"
            maxLength={2000}
            placeholder={t(
              "adminGovernance.capabilities.evidenceReferencePlaceholder",
            )}
          />
        </label>
      ) : null}
      <div className={styles.actions}>
        {canOperate && !capability.pending ? (
          <button
            className={styles.button}
            name="action"
            value="propose"
            disabled={pending}
          >
            {t("adminGovernance.capabilities.requestActivation")}
          </button>
        ) : null}
        {canApprove && capability.pending ? (
          <>
            <button
              className={styles.button}
              name="action"
              value="approve"
              disabled={pending}
            >
              {t("adminGovernance.capabilities.approveActivation")}
            </button>
            <button
              className={styles.button}
              name="action"
              value="reject"
              disabled={pending}
            >
              {t("adminGovernance.capabilities.rejectRequest")}
            </button>
          </>
        ) : null}
        {canOperate ? (
          <button
            className={styles.button}
            name="action"
            value="disable"
            disabled={pending}
          >
            {t("adminGovernance.capabilities.disableNow")}
          </button>
        ) : null}
      </div>
      {message ? <p role="status">{t(message)}</p> : null}
    </form>
  );
}
