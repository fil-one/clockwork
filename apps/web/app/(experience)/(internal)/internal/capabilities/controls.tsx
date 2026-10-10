"use client";

import { useActionState, useState } from "react";
import type { DatabaseSystemCapabilityAdmin } from "@clockwork/db";
import { SelfApprovalDialog } from "@/src/features/internal-ops/self-approval/self-approval-dialog";
import { sessionExpiredMessage } from "@/src/features/internal-ops/session-expiry-message";
import { approveOwnCapability } from "@/src/features/internal-ops/self-approval/actions";
import { changeCapability, type CapabilityActionResult } from "./actions";
import { formatSurfaceTimestamp } from "@/src/features/customer-partner/formatting";
import { useReaderTimeZone } from "@/src/features/internal-ops/local-timestamp";
import styles from "@/src/features/internal-ops/administration-safety/administration-safety.module.css";
import { useFormattingLocale, useTranslations } from "@/src/i18n/client";
import { SessionExpiredReload } from "@/src/features/internal-ops/session-expiry";

type Capability = Awaited<
  ReturnType<DatabaseSystemCapabilityAdmin["list"]>
>[number];

export function CapabilityControls({
  capability,
  canOperate,
  canApprove,
  viewerUserId,
  canApproveOwn = false,
  subject,
}: {
  capability: Capability;
  canOperate: boolean;
  canApprove: boolean;
  /** The reader, to tell their own request from someone else's. */
  viewerUserId?: string;
  /** The reader may approve their own request (`approval:self`). */
  canApproveOwn?: boolean;
  /** The switch's name, worded for the reader. */
  subject?: string;
}) {
  const t = useTranslations();
  const [selfApproved, setSelfApproved] = useState(false);
  const ownPending =
    capability.pending !== null &&
    viewerUserId !== undefined &&
    capability.pending.requestedBy === viewerUserId;
  const selfApprovable = canApprove && canApproveOwn && ownPending;
  const formattingLocale = useFormattingLocale();
  const readerTimeZone = useReaderTimeZone();
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
                { locale: formattingLocale, timeZone: readerTimeZone },
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
            {selfApprovable ? (
              <SelfApprovalDialog
                subject={subject ?? capability.capabilityKey}
                disabled={pending}
                onConfirm={async (reason) => {
                  const pendingRequest = capability.pending;
                  if (!pendingRequest)
                    return {
                      ok: false,
                      message: t("common.selfApproval.error.generic"),
                    };
                  const result = await approveOwnCapability({
                    capabilityKey: capability.capabilityKey,
                    expectedRowVersion: capability.rowVersion,
                    proposalId: pendingRequest.id,
                    reason,
                  });
                  if (!result.ok)
                    return {
                      ok: false,
                      message: t(result.message),
                      expired: result.message === sessionExpiredMessage,
                    };
                  setSelfApproved(true);
                  return { ok: true };
                }}
              />
            ) : (
              <button
                className={styles.button}
                name="action"
                value="approve"
                disabled={pending}
              >
                {t("adminGovernance.capabilities.approveActivation")}
              </button>
            )}
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
      {selfApprovable && !selfApproved ? (
        <p>{t("common.selfApproval.notice")}</p>
      ) : null}
      {selfApproved ? (
        <p role="status">{t("common.selfApproval.done")}</p>
      ) : null}
      {message ? <p role="status">{t(message)}</p> : null}
      {message === sessionExpiredMessage ? <SessionExpiredReload /> : null}
    </form>
  );
}
