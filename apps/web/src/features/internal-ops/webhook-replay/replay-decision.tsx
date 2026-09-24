"use client";
import { useTranslations } from "@/src/i18n/client";

import { Button, Dialog, Textarea } from "@clockwork/ui";
import { useId, useState, useTransition } from "react";

import { replayWebhookEvent } from "./actions";
import { replayFailureMessage, replayReasonMinimum } from "./copy";
import styles from "../finance-lifecycle/finance-lifecycle.module.css";

export function ReplayDecision({
  provider,
  providerEventId,
  eventType,
  payloadHash,
}: {
  provider: string;
  providerEventId: string;
  eventType: string;
  payloadHash: string;
}) {
  const t = useTranslations();
  const reasonId = useId().replaceAll(":", "");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [started, setStarted] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (reason.trim().length < replayReasonMinimum) {
      setMessage(replayFailureMessage("WEBHOOK_REPLAY_REASON_REQUIRED", t));
      return;
    }
    const formData = new FormData();
    formData.set("provider", provider);
    formData.set("providerEventId", providerEventId);
    formData.set("reason", reason.trim());
    startTransition(async () => {
      const result = await replayWebhookEvent(formData);
      // A replay already in flight is reported as itself, never as a second
      // success: telling an operator a replay started when it did not is how
      // one incident gets worked twice.
      if (result.ok && result.started) {
        setStarted(true);
        setMessage("");
        return;
      }
      setStarted(false);
      setMessage(replayFailureMessage(result.code, t));
    });
  }

  return (
    <Dialog
      closeLabel={t("common.close")}
      title={t("operations.webhookReplay.dialog.title", {
        callback: providerEventId,
      })}
      description={t("operations.webhookReplay.effect")}
      trigger={
        <Button variant="secondary" size="small">
          {t("operations.webhookReplay.action")}
        </Button>
      }
      footer={
        <Button
          variant="primary"
          size="small"
          onClick={submit}
          disabled={pending}
        >
          {pending
            ? t("operations.webhookReplay.pending")
            : t("operations.webhookReplay.confirm")}
        </Button>
      }
    >
      <dl className={styles.reviewGrid}>
        <div>
          <dt>{t("operations.webhookReplay.column.callback")}</dt>
          <dd>
            {provider} · {providerEventId}
          </dd>
        </div>
        <div>
          <dt>{t("operations.column.type")}</dt>
          <dd>{eventType}</dd>
        </div>
        <div>
          <dt>{t("operations.webhookReplay.detail.payloadHash")}</dt>
          {/* A 71-character hash has no break opportunity and ran into the next card. */}
          <dd style={{ overflowWrap: "anywhere" }}>{payloadHash}</dd>
        </div>
        <div>
          <dt>{t("operations.webhookReplay.detail.repeatSubmission")}</dt>
          <dd>
            {t("operations.webhookReplay.detail.repeatSubmission.answer")}
          </dd>
        </div>
      </dl>
      <Textarea
        id={reasonId}
        name="reason"
        rows={3}
        value={reason}
        label={t("operations.decision.reason")}
        help={t("operations.webhookReplay.reasonHelp", {
          min: replayReasonMinimum,
        })}
        onChange={(event) => {
          setReason(event.currentTarget.value);
          if (message) setMessage("");
        }}
        required
      />
      {message ? (
        <p className={styles.statusMessage} role="alert">
          {message}
        </p>
      ) : null}
      {started && !message ? (
        <p className={styles.statusMessage} role="status">
          {t("operations.webhookReplay.started")}
        </p>
      ) : null}
    </Dialog>
  );
}
