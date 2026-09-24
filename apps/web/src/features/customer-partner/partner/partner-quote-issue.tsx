"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { sendCoreCommand } from "@/src/features/contracts/commerce-client";
import { commercialArtifactRetainUntil } from "../commercial/artifact-retention";
import { preparedArtifactRequestId } from "../commercial/quote-issuance-client";
import type { MessageId } from "@/src/i18n";
import { useTranslations } from "@/src/i18n/client";
import { partnerCommandFailure } from "./partner-command-errors";
import type { PartnerRecord } from "./partner-data";
import styles from "./partner.module.css";

/** A failure this component detected itself, named by the message to show. */
class IssueProblem extends Error {
  public constructor(public readonly messageId: MessageId) {
    super(messageId);
  }
}

export function PartnerQuoteIssue({
  command,
}: {
  command: NonNullable<PartnerRecord["quoteCommand"]>;
}) {
  const t = useTranslations();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<MessageId | null>(null);
  const busy = useRef(false);
  const attempt = useRef<{
    issuedAt: string;
    keys: [string, string, string];
  } | null>(null);
  async function issue() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setMessage(null);
    attempt.current ??= {
      issuedAt: new Date().toISOString(),
      keys: [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()],
    };
    const saved = attempt.current;
    try {
      const ids: string[] = [];
      for (const [index, audience] of (
        ["partner", "end_client"] as const
      ).entries()) {
        setMessage(
          index === 0
            ? "partner.quote.issue.preparingTransfer"
            : "partner.quote.issue.preparingResale",
        );
        const prepared = await sendCoreCommand(
          {
            resource: "quotes",
            id: command.quoteId,
            accountId: command.accountId,
            expectedVersion: command.version,
            action: "prepare_artifact",
            payload: {
              audience,
              issuedAt: saved.issuedAt,
              retainUntil: commercialArtifactRetainUntil(saved.issuedAt),
            },
          },
          { idempotencyKey: saved.keys[index === 0 ? 0 : 1] },
        );
        const requestId = preparedArtifactRequestId(prepared);
        if (!requestId)
          throw new IssueProblem("partner.quote.issue.noReference");
        const kind =
          audience === "partner"
            ? "partner_transfer_quote"
            : "partner_resale_quote";
        let documentId: string | undefined;
        for (let poll = 0; poll < 15; poll++) {
          const response = await fetch(
            `/api/experience/artifacts/${kind}/${requestId}?representation=json`,
            { cache: "no-store" },
          );
          if (response.ok) {
            const artifact = (await response.json()) as {
              id?: string;
              kind?: string;
              subjectId?: string;
              documentId?: string;
            };
            if (
              artifact.id !== requestId ||
              artifact.kind !== kind ||
              artifact.subjectId !== command.quoteId ||
              !artifact.documentId
            )
              throw new IssueProblem("partner.quote.issue.mismatch");
            documentId = artifact.documentId;
            break;
          }
          if (response.status !== 404)
            throw new IssueProblem("partner.quote.issue.unavailable");
          await new Promise((resolve) => window.setTimeout(resolve, 1000));
        }
        if (!documentId)
          throw new IssueProblem("partner.quote.issue.stillPreparing");
        ids.push(documentId);
      }
      await sendCoreCommand(
        {
          resource: "quotes",
          id: command.quoteId,
          accountId: command.accountId,
          expectedVersion: command.version,
          action: "issue",
          payload: {
            artifactIssuedAt: saved.issuedAt,
            renderedDocumentId: ids[0],
            partnerDocumentId: ids[1],
          },
        },
        { idempotencyKey: saved.keys[2] },
      );
      setMessage("partner.quote.issue.issued");
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof IssueProblem
          ? error.messageId
          : partnerCommandFailure(error, "partner.quote.issue.failed"),
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <div>
      <p>{t("partner.quote.issue.description")}</p>
      <button
        className={styles.buttonLink}
        disabled={pending}
        onClick={() => void issue()}
      >
        {t(
          pending
            ? "partner.quote.issue.working"
            : "partner.quote.issue.action",
        )}
      </button>
      <p role="status" aria-live="polite">
        {message ? t(message) : null}
      </p>
    </div>
  );
}
