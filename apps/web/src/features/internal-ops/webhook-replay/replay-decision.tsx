"use client";

import { Button, Dialog, Textarea } from "@clockwork/ui";
import { useId, useState, useTransition } from "react";

import { replayWebhookEvent } from "./actions";
import { webhookReplayCopy } from "./copy";
import styles from "../finance-lifecycle/finance-lifecycle.module.css";

const failure: Readonly<Record<string, string>> = {
  WEBHOOK_REPLAY_REASON_REQUIRED: webhookReplayCopy.outcome.reasonRequired,
  WEBHOOK_REPLAY_RECENT_AUTH_REQUIRED:
    webhookReplayCopy.outcome.recentAuthRequired,
  WEBHOOK_REPLAY_FORBIDDEN: webhookReplayCopy.outcome.forbidden,
  WEBHOOK_REPLAY_EVENT_NOT_FOUND: webhookReplayCopy.outcome.notFound,
  WEBHOOK_REPLAY_UNAVAILABLE: webhookReplayCopy.outcome.unavailable,
  WEBHOOK_REPLAY_ALREADY_RUNNING: webhookReplayCopy.outcome.alreadyRunning,
  WEBHOOK_REPLAY_INVALID: webhookReplayCopy.outcome.failed,
  WEBHOOK_REPLAY_FAILED: webhookReplayCopy.outcome.failed,
};

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
  const reasonId = useId().replaceAll(":", "");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [started, setStarted] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (reason.trim().length < 8) {
      setMessage(webhookReplayCopy.outcome.reasonRequired);
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
      setMessage(
        (result.code ? failure[result.code] : undefined) ??
          webhookReplayCopy.outcome.failed,
      );
    });
  }

  return (
    <Dialog
      title={`${webhookReplayCopy.action} ${providerEventId}`}
      description={webhookReplayCopy.effect}
      trigger={
        <Button variant="secondary" size="small">
          {webhookReplayCopy.action}
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
            ? webhookReplayCopy.pending
            : webhookReplayCopy.confirmAccept}
        </Button>
      }
    >
      <dl className={styles.reviewGrid}>
        <div>
          <dt>{webhookReplayCopy.detail.callback}</dt>
          <dd>
            {provider} · {providerEventId}
          </dd>
        </div>
        <div>
          <dt>{webhookReplayCopy.detail.eventType}</dt>
          <dd>{eventType}</dd>
        </div>
        <div>
          <dt>{webhookReplayCopy.detail.payloadHash}</dt>
          <dd>{payloadHash}</dd>
        </div>
        <div>
          <dt>{webhookReplayCopy.detail.repeatSubmission}</dt>
          <dd>{webhookReplayCopy.repeatSubmission}</dd>
        </div>
      </dl>
      <Textarea
        id={reasonId}
        name="reason"
        rows={3}
        value={reason}
        label={webhookReplayCopy.reasonLabel}
        help={webhookReplayCopy.reasonHelp}
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
          {webhookReplayCopy.outcome.started}
        </p>
      ) : null}
    </Dialog>
  );
}
