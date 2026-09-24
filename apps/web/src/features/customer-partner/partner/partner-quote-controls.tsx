"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { sendCoreCommand } from "@/src/features/contracts/commerce-client";
import type { MessageId } from "@/src/i18n";
import { useTranslations } from "@/src/i18n/client";
import { partnerCommandFailure } from "./partner-command-errors";
import type { PartnerRecord } from "./partner-data";
import styles from "./partner.module.css";

/** The server returned no review path; nothing a reader can act on changed. */
class MissingReviewLink extends Error {}

/** The shortest withdrawal reason the command accepts. */
const minimumReasonLength = 8;

export function PartnerQuoteControls({
  command,
  canShare,
  canCancel,
}: {
  command: NonNullable<PartnerRecord["quoteCommand"]>;
  canShare: boolean;
  canCancel: boolean;
}) {
  const t = useTranslations();
  const router = useRouter();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [path, setPath] = useState("");
  const [message, setMessage] = useState<MessageId | null>(null);
  const [reason, setReason] = useState("");
  const attempt = useRef<
    { action: string; reason: string; key: string } | undefined
  >(undefined);
  async function act(action: "share" | "cancel") {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setMessage(null);
    if (
      !attempt.current ||
      attempt.current.action !== action ||
      attempt.current.reason !== reason
    )
      attempt.current = { action, reason, key: crypto.randomUUID() };
    try {
      const result = await sendCoreCommand(
        {
          resource: "quotes",
          id: command.quoteId,
          accountId: command.accountId,
          expectedVersion: command.version,
          action,
          payload: action === "cancel" ? { reason } : {},
        },
        { idempotencyKey: attempt.current.key },
      );
      const response = result as {
        record?: { data?: { reviewPath?: string } };
      };
      if (action === "share") {
        const value = response.record?.data?.reviewPath;
        if (!value?.startsWith("/demo/quote/")) throw new MissingReviewLink();
        setPath(value);
      } else {
        setMessage("partner.quote.share.withdrawn");
        router.refresh();
      }
    } catch (error) {
      setMessage(
        error instanceof MissingReviewLink
          ? "partner.quote.share.noLink"
          : partnerCommandFailure(
              error,
              action === "share"
                ? "partner.quote.share.failed"
                : "partner.quote.withdraw.failed",
            ),
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  const reasonTooShort = reason.trim().length < minimumReasonLength;
  return (
    <section
      className={styles.detailCard}
      aria-label={t("partner.quote.share.regionLabel")}
    >
      {canShare ? (
        <>
          <h2>{t("partner.quote.share.title")}</h2>
          <p>{t("partner.quote.share.description")}</p>
          <button
            className={styles.buttonLink}
            disabled={pending}
            onClick={() => void act("share")}
          >
            {t("partner.quote.share.create")}
          </button>
          {path ? (
            <div>
              <a href={path} target="_blank" rel="noreferrer">
                {t("partner.quote.share.open")}
              </a>
              <p>
                <input
                  aria-label={t("partner.quote.share.linkLabel")}
                  readOnly
                  value={
                    typeof window !== "undefined"
                      ? new URL(path, window.location.origin).href
                      : path
                  }
                />
              </p>
              <button
                className={styles.buttonLink}
                onClick={() => {
                  void navigator.clipboard
                    .writeText(new URL(path, window.location.origin).href)
                    .then(
                      () => setMessage("partner.quote.share.copied"),
                      () => setMessage("partner.quote.share.copyManually"),
                    );
                }}
              >
                {t("partner.quote.share.copy")}
              </button>
              <p>{t("partner.quote.share.expiry")}</p>
            </div>
          ) : null}
        </>
      ) : null}
      {canCancel ? (
        <details>
          <summary>{t("partner.quote.withdraw.summary")}</summary>
          <label>
            {t("partner.quote.withdraw.reason")}
            <textarea
              value={reason}
              maxLength={2000}
              aria-describedby="withdraw-reason-hint"
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <p className={styles.muted} id="withdraw-reason-hint">
            {t("partner.quote.withdraw.reasonHint", {
              count: minimumReasonLength,
            })}
          </p>
          <button
            className={styles.buttonLink}
            disabled={pending || reasonTooShort}
            onClick={() => void act("cancel")}
          >
            {t("partner.quote.withdraw.submit")}
          </button>
        </details>
      ) : null}
      <p role="status">{message ? t(message) : null}</p>
    </section>
  );
}
