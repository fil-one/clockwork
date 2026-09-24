"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "@/src/i18n/client";
import { sendCoreCommand } from "@/src/features/contracts/commerce-client";
import { commercialArtifactRetainUntil } from "./artifact-retention";
import { CommercialStop, commercialFailureText } from "./failure-message";
import {
  preparedArtifactRequestId,
  readPreparedQuoteArtifact,
  readBuyQuoteProjection,
} from "./quote-issuance-client";
import styles from "./commercial.module.css";

/** Continue the saved quote; never create a replacement draft on retry. */
export function QuoteIssue({
  accountId,
  quoteId,
  recordKey,
  pollAttempts = 15,
  pollIntervalMs = 1000,
}: {
  accountId: string;
  quoteId: string;
  recordKey: string;
  pollAttempts?: number;
  pollIntervalMs?: number;
}) {
  const t = useTranslations();
  const router = useRouter();
  const [phase, setPhase] = useState<"idle" | "working" | "ready" | "error">(
    "idle",
  );
  const [message, setMessage] = useState("");
  const busy = useRef(false);
  const attempt = useRef<{
    version: number;
    issuedAt: string;
    prepareKey: string;
    issueKey: string;
  } | null>(null);
  const pause = () =>
    new Promise<void>((resolve) => window.setTimeout(resolve, pollIntervalMs));

  async function run() {
    if (busy.current) return;
    busy.current = true;
    setPhase("working");
    setMessage("");
    try {
      const current = await readBuyQuoteProjection({ quoteId, accountId });
      if (current.status !== "found")
        throw new CommercialStop("customer.commercial.issue.refresh");
      if (current.quoteStatus !== "issued") {
        if (current.quoteStatus !== "draft")
          throw new CommercialStop("customer.commercial.issue.refresh");
        if (
          current.marginResult === "exception_required" ||
          current.marginResult === "rejected"
        )
          throw new CommercialStop("customer.commercial.issue.pricingReview");
        attempt.current ??= {
          version: current.rowVersion,
          issuedAt: new Date().toISOString(),
          prepareKey: crypto.randomUUID(),
          issueKey: crypto.randomUUID(),
        };
        const saved = attempt.current;
        if (current.rowVersion !== saved.version)
          throw new CommercialStop("customer.commercial.issue.refresh");
        const prepared = await sendCoreCommand(
          {
            resource: "quotes",
            id: quoteId,
            accountId,
            action: "prepare_artifact",
            expectedVersion: saved.version,
            payload: {
              audience: "end_client",
              issuedAt: saved.issuedAt,
              retainUntil: commercialArtifactRetainUntil(saved.issuedAt),
            },
          },
          { idempotencyKey: saved.prepareKey },
        );
        const artifactRequestId = preparedArtifactRequestId(prepared);
        if (!artifactRequestId)
          throw new CommercialStop(
            "customer.commercial.issue.documentUnavailable",
          );
        let documentId: string | undefined;
        for (let i = 0; i < pollAttempts; i += 1) {
          const artifact = await readPreparedQuoteArtifact({
            quoteId,
            accountId,
            artifactRequestId,
          });
          if (artifact.status === "stored") {
            documentId = artifact.documentId;
            break;
          }
          if (artifact.status !== "pending")
            throw new CommercialStop(
              "customer.commercial.issue.documentUnavailable",
            );
          if (i + 1 < pollAttempts) await pause();
        }
        if (!documentId)
          throw new CommercialStop("customer.commercial.issue.rendering");
        await sendCoreCommand(
          {
            resource: "quotes",
            id: quoteId,
            accountId,
            action: "issue",
            expectedVersion: saved.version,
            payload: {
              artifactIssuedAt: saved.issuedAt,
              renderedDocumentId: documentId,
            },
          },
          { idempotencyKey: saved.issueKey },
        );
        let confirmed = false;
        for (let i = 0; i < pollAttempts; i += 1) {
          const projection = await readBuyQuoteProjection({
            quoteId,
            accountId,
          });
          if (
            projection.status === "found" &&
            projection.quoteStatus === "issued"
          ) {
            confirmed = true;
            break;
          }
          if (
            projection.status === "forbidden" ||
            projection.status === "unavailable"
          )
            throw new CommercialStop("customer.commercial.issue.refresh");
          if (i + 1 < pollAttempts) await pause();
        }
        if (!confirmed)
          throw new CommercialStop("customer.commercial.issue.synchronizing");
      }
      setPhase("ready");
      router.refresh();
    } catch (error) {
      setPhase("error");
      setMessage(
        commercialFailureText(error, t, "customer.commercial.issue.refresh"),
      );
    } finally {
      busy.current = false;
    }
  }

  return (
    <section
      className={`${styles.panel} ${styles.section}`}
      aria-labelledby="issue-quote-title"
    >
      <h2 id="issue-quote-title">{t("customer.commercial.issue.title")}</h2>
      <p className={styles.description}>
        {t("customer.commercial.issue.description")}
      </p>
      {phase === "ready" ? (
        <p role="status">
          <Link
            className={styles.primary}
            href={`/orders/accept?quote=${encodeURIComponent(recordKey)}`}
          >
            {t("customer.commercial.detail.step.acceptOrder")}
          </Link>
        </p>
      ) : (
        <button
          className={styles.primary}
          disabled={phase === "working"}
          onClick={() => {
            void run();
          }}
          type="button"
        >
          {t(
            phase === "working"
              ? "customer.commercial.issue.working"
              : phase === "error"
                ? "customer.commercial.issue.retry"
                : "customer.commercial.issue.action",
          )}
        </button>
      )}
      {message ? (
        <p className={styles.errorMessage} role="alert">
          {message}
        </p>
      ) : null}
    </section>
  );
}
