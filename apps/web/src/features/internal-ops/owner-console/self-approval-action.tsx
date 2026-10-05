"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { Input } from "@clockwork/ui";

import {
  approveOwnCapability,
  approveOwnChannelPolicy,
} from "../self-approval/actions";
import {
  approveOwnPaygOffer,
  decideException,
  sendCoreCommand,
} from "@/src/features/contracts/commerce-client";
import type { MessageId } from "@/src/i18n";
import { useTranslations } from "@/src/i18n/client";

import {
  selfApprovalErrorMessage,
  type SelfApprovalOutcome,
} from "../self-approval/model";
import { SelfApprovalDialog } from "../self-approval/self-approval-dialog";
import type { ApprovalItemView, ConsoleSelfApprovalTarget } from "./model";
import styles from "./owner-console.module.css";

/** The evidence each control's approval needs besides the reason. */
const evidenceFields: Partial<
  Record<
    ApprovalItemView["control"],
    { label: MessageId; help: MessageId; minimum: number; uuid?: boolean }
  >
> = {
  channel_policy: {
    label: "common.selfApproval.evidence.policy",
    help: "common.selfApproval.evidence.policyHelp",
    minimum: 8,
  },
  payg_offer: {
    label: "common.selfApproval.evidence.offer",
    help: "common.selfApproval.evidence.offerHelp",
    minimum: 1,
  },
  exception_case: {
    label: "common.selfApproval.evidence.document",
    help: "common.selfApproval.evidence.documentHelp",
    minimum: 36,
    uuid: true,
  },
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * Sends the control's own approval command with the self-approval flag. The
 * server checks the reader's session and stored authority again and records
 * the reason, the audit event and the notices.
 */
async function approveOwn(
  control: ApprovalItemView["control"],
  item: ApprovalItemView,
  target: ConsoleSelfApprovalTarget,
  reason: string,
  evidence: string,
): Promise<{ ok: true } | { ok: false; message?: MessageId }> {
  switch (control) {
    case "price_book_activation":
      await sendCoreCommand({
        resource: "price_books",
        id: target.id,
        action: target.priceBookAction ?? "activate",
        ...(target.version === null ? {} : { expectedVersion: target.version }),
        payload: { reason, selfApproval: true },
      });
      return { ok: true };
    case "capability_activation":
      return approveOwnCapability({
        capabilityKey: item.name ?? "",
        expectedRowVersion: target.version ?? 0,
        proposalId: target.id,
        reason,
      });
    case "channel_policy":
      return approveOwnChannelPolicy({
        id: target.id,
        expectedRowVersion: target.version ?? 0,
        reason,
        approvalEvidence: evidence,
      });
    case "payg_offer":
      await approveOwnPaygOffer({
        id: target.id,
        expectedRowVersion: target.version ?? 0,
        reason,
        approvalEvidenceId: evidence,
      });
      return { ok: true };
    case "exception_case":
      await decideException({
        caseId: target.id,
        decision: "approved",
        reason,
        evidenceDocumentId: evidence,
        selfApproval: true,
      });
      return { ok: true };
    case "tax_rule_book_activation":
    case "termination":
      return { ok: false };
  }
}

/**
 * "Approve my own request" on the console, for a request the reader raised
 * on a control that is decided in the portal.
 */
export function SelfApprovalAction({
  item,
  target,
  subject,
  editable,
}: {
  item: ApprovalItemView;
  target: ConsoleSelfApprovalTarget;
  subject: string;
  editable: boolean;
}) {
  const t = useTranslations();
  const router = useRouter();
  const fieldId = `self-evidence-${useId().replaceAll(":", "")}`;
  const [evidence, setEvidence] = useState("");
  const [done, setDone] = useState(false);
  const field = evidenceFields[item.control];
  const trimmed = evidence.trim();
  const ready =
    !field ||
    (trimmed.length >= field.minimum &&
      (!field.uuid || uuidPattern.test(trimmed)));

  async function confirm(reason: string): Promise<SelfApprovalOutcome> {
    try {
      const result = await approveOwn(
        item.control,
        item,
        target,
        reason,
        trimmed,
      );
      if (!result.ok)
        return {
          ok: false,
          message: t(result.message ?? "common.selfApproval.error.generic"),
        };
      setDone(true);
      router.refresh();
      return { ok: true };
    } catch (failure) {
      return { ok: false, message: t(selfApprovalErrorMessage(failure)) };
    }
  }

  if (done)
    return (
      <p className={styles.muted} role="status">
        {t("common.selfApproval.done")}
      </p>
    );
  return (
    <SelfApprovalDialog
      subject={subject}
      disabled={!editable}
      ready={ready}
      onConfirm={confirm}
    >
      {field ? (
        <Input
          id={fieldId}
          fieldClassName={styles.dialogField ?? ""}
          label={t(field.label)}
          help={t(field.help)}
          value={evidence}
          required
          maxLength={field.uuid ? 36 : 255}
          onChange={(event) => setEvidence(event.target.value)}
        />
      ) : null}
    </SelfApprovalDialog>
  );
}
