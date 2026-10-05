"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { Input } from "@clockwork/ui";

import { decideException } from "@/src/features/contracts/commerce-client";
import { useTranslations } from "@/src/i18n/client";

import { selfApprovalErrorMessage } from "./model";
import { SelfApprovalDialog } from "./self-approval-dialog";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * "Approve my own request" on an exception case the reader raised. The
 * approval carries the same evidence document an ordinary decision does; the
 * reason is also the decision's reason.
 */
export function OwnExceptionApproval({
  caseId,
  subject,
}: {
  caseId: string;
  subject: string;
}) {
  const t = useTranslations();
  const router = useRouter();
  const fieldId = `exception-self-evidence-${useId().replaceAll(":", "")}`;
  const [evidence, setEvidence] = useState("");
  const [done, setDone] = useState(false);
  const trimmed = evidence.trim();
  if (done) return <p role="status">{t("common.selfApproval.done")}</p>;
  return (
    <section aria-labelledby={`${fieldId}-title`}>
      <p id={`${fieldId}-title`}>{t("common.selfApproval.notice")}</p>
      <SelfApprovalDialog
        subject={subject}
        ready={uuidPattern.test(trimmed)}
        onConfirm={async (reason) => {
          try {
            await decideException({
              caseId,
              decision: "approved",
              reason,
              evidenceDocumentId: trimmed,
              selfApproval: true,
            });
            setDone(true);
            router.refresh();
            return { ok: true };
          } catch (failure) {
            return {
              ok: false,
              message: t(selfApprovalErrorMessage(failure)),
            };
          }
        }}
      >
        <Input
          id={fieldId}
          label={t("common.selfApproval.evidence.document")}
          help={t("common.selfApproval.evidence.documentHelp")}
          value={evidence}
          required
          maxLength={36}
          onChange={(event) => setEvidence(event.target.value)}
        />
      </SelfApprovalDialog>
    </section>
  );
}
