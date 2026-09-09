"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { sendCoreCommand } from "@/src/features/contracts/commerce-client";
import { commercialArtifactRetainUntil } from "../commercial/artifact-retention";
import { preparedArtifactRequestId } from "../commercial/quote-issuance-client";
import type { PartnerRecord } from "./partner-data";
import styles from "./partner.module.css";

export function PartnerQuoteIssue({
  command,
}: {
  command: NonNullable<PartnerRecord["quoteCommand"]>;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const busy = useRef(false);
  const attempt = useRef<{
    issuedAt: string;
    keys: [string, string, string];
  } | null>(null);
  async function issue() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setMessage("");
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
            ? "Preparing the confidential transfer quote…"
            : "Preparing the end-client quotation…",
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
          throw new Error(
            "Document preparation did not return a reference. Retry to continue.",
          );
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
              throw new Error("The document does not match this quote.");
            documentId = artifact.documentId;
            break;
          }
          if (response.status !== 404)
            throw new Error("The document is unavailable. Retry to continue.");
          await new Promise((resolve) => window.setTimeout(resolve, 1000));
        }
        if (!documentId)
          throw new Error(
            "Documents are still being prepared. Retry to continue.",
          );
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
      setMessage(
        "Quote issued. Download the end-client quotation below to share with your client.",
      );
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Issuance failed. Retry to continue.",
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <div>
      <p>
        Issue two separate documents: confidential transfer pricing for your
        team, and your resale quotation for the end client. Issuance does not
        place an order or send an email.
      </p>
      <button
        className={styles.buttonLink}
        disabled={pending}
        onClick={() => void issue()}
      >
        {pending ? "Preparing documents…" : "Prepare documents and issue quote"}
      </button>
      <p role="status" aria-live="polite">
        {message}
      </p>
    </div>
  );
}
