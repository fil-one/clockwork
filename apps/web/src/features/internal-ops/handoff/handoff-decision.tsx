"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { HandoffStatus } from "@clockwork/contracts";
import { Button, Textarea } from "@clockwork/ui";

import { useTranslations } from "@/src/i18n/client";

import { decideHandoff } from "./actions";
import { HandoffOutcomeBanner, type HandoffOutcome } from "./outcome-banner";
import styles from "./handoff.module.css";

/**
 * Take, complete or decline. Each submits the version the page was read at,
 * so a request someone else moved meanwhile is refused rather than overwritten.
 */
export function HandoffDecision({
  id,
  version,
  status,
  assignedToReader,
}: {
  id: string;
  version: number;
  status: HandoffStatus;
  assignedToReader: boolean;
}) {
  const t = useTranslations();
  const router = useRouter();
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState<HandoffOutcome | null>(null);
  const [pending, startTransition] = useTransition();
  if (status === "done" || status === "declined")
    return outcome ? (
      <HandoffOutcomeBanner outcome={outcome} onReloaded={() => {}} />
    ) : null;

  function run(decision: "take" | "complete" | "decline") {
    setOutcome(null);
    startTransition(async () => {
      const result = await decideHandoff(decision, {
        id,
        expectedVersion: version,
        ...(note.trim() ? { note } : {}),
      }).catch(() => ({ ok: false as const, code: "UNEXPECTED" }));
      if (result.ok) {
        setNote("");
        setOutcome({
          tone: "success",
          message: t(
            decision === "take"
              ? "operations.handoff.action.taken"
              : decision === "complete"
                ? "operations.handoff.action.completed"
                : "operations.handoff.action.declined",
          ),
        });
        router.refresh();
        return;
      }
      setOutcome({ tone: "danger", code: result.code });
    });
  }

  return (
    <div className={styles.block}>
      <HandoffOutcomeBanner
        outcome={outcome}
        onReloaded={() => setOutcome(null)}
      />
      <Textarea
        label={t("operations.handoff.action.note")}
        help={t("operations.handoff.action.noteHelp")}
        name="note"
        rows={3}
        maxLength={2000}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <div className={styles.actions}>
        {status === "open" || !assignedToReader ? (
          <Button
            type="button"
            variant="primary"
            loading={pending}
            onClick={() => run("take")}
          >
            {status === "open"
              ? t("operations.handoff.action.take")
              : t("operations.handoff.action.takeOver")}
          </Button>
        ) : null}
        {status === "in_progress" && assignedToReader ? (
          <Button
            type="button"
            variant="primary"
            loading={pending}
            onClick={() => run("complete")}
          >
            {t("operations.handoff.action.complete")}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => run("decline")}
        >
          {t("operations.handoff.action.decline")}
        </Button>
      </div>
    </div>
  );
}
