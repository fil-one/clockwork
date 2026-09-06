"use client";

import { useActionState } from "react";
import type { DatabaseSystemCapabilityAdmin } from "@clockwork/db";
import { changeCapability } from "./actions";
import styles from "@/src/features/internal-ops/administration-safety/administration-safety.module.css";

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
  const [message, action, pending] = useActionState(changeCapability, "");
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
              Pending{" "}
              {capability.pending.enableRecovery ? "recovery" : "new work"}{" "}
              activation
            </strong>
          </p>
          <p>
            Requested by {capability.pending.requestedBy} ·{" "}
            {capability.pending.requestedAt.toISOString()}
          </p>
          <p>{capability.pending.reason}</p>
          <p>Evidence: {capability.pending.evidenceReference}</p>
        </>
      ) : null}
      <label className={styles.field}>
        Control scope
        <select name="recovery" defaultValue="false">
          <option value="false">New work</option>
          <option value="true">Recovery work</option>
        </select>
      </label>
      <label className={styles.field}>
        Decision reason
        <textarea
          name="reason"
          required
          minLength={8}
          maxLength={2000}
          placeholder="Explain the operational reason and evidence for this change."
        />
      </label>
      {canOperate && !capability.pending ? (
        <label className={styles.field}>
          Activation evidence reference
          <input
            name="evidenceReference"
            maxLength={2000}
            placeholder="Approved launch or recovery evidence reference"
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
            Request activation
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
              Approve activation
            </button>
            <button
              className={styles.button}
              name="action"
              value="reject"
              disabled={pending}
            >
              Reject request
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
            Disable immediately
          </button>
        ) : null}
      </div>
      {message ? <p role="status">{message}</p> : null}
    </form>
  );
}
