"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { sendCoreCommand } from "@/src/features/contracts/commerce-client";
import type { PartnerRecord } from "./partner-data";
import styles from "./partner.module.css";
export function PartnerQuoteControls({
  command,
  canShare,
  canCancel,
}: {
  command: NonNullable<PartnerRecord["quoteCommand"]>;
  canShare: boolean;
  canCancel: boolean;
}) {
  const router = useRouter();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [path, setPath] = useState("");
  const [message, setMessage] = useState("");
  const [reason, setReason] = useState("");
  const attempt = useRef<
    { action: string; reason: string; key: string } | undefined
  >(undefined);
  async function act(action: "share" | "cancel") {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setMessage("");
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
        if (!value?.startsWith("/demo/quote/"))
          throw new Error("No review link returned. Retry to continue.");
        setPath(value);
      } else {
        setMessage("Quote withdrawn. Existing review links no longer work.");
        router.refresh();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Please retry.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <section
      className={styles.detailCard}
      aria-label="Quote sharing and withdrawal"
    >
      {canShare ? (
        <>
          <h2>Client review</h2>
          <p>
            Create a private demo review link showing only your resale price.
            The client can request an order, request changes, or decline.
            Responses appear on this quote.
          </p>
          <button
            className={styles.buttonLink}
            disabled={pending}
            onClick={() => void act("share")}
          >
            Create client review link
          </button>
          {path ? (
            <div>
              <a href={path} target="_blank" rel="noreferrer">
                Open client review
              </a>
              <p>
                <input
                  aria-label="Client review link"
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
                      () => setMessage("Review link copied."),
                      () =>
                        setMessage("Select and copy the review link above."),
                    );
                }}
              >
                Copy review link
              </button>
              <p>
                The demo password is required. This link expires with the quote
                and stops working when the quote is revised or withdrawn.
              </p>
            </div>
          ) : null}
        </>
      ) : null}
      {canCancel ? (
        <details>
          <summary>Withdraw quote</summary>
          <label>
            Reason for withdrawal
            <textarea
              value={reason}
              maxLength={2000}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <button
            className={styles.buttonLink}
            disabled={pending || reason.trim().length < 8}
            onClick={() => void act("cancel")}
          >
            Withdraw this quote
          </button>
        </details>
      ) : null}
      <p role="status">{message}</p>
    </section>
  );
}
