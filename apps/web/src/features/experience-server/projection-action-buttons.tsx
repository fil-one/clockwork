"use client";
import { useTranslations } from "@/src/i18n/client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Button, Dialog } from "@clockwork/ui";

import {
  readProjectionAction,
  sendProjectionAction,
} from "@/src/features/contracts/experience-client";
import type { ExperienceAudience, ProjectionChannel } from "./model";
import { actionLabel, isDestructiveAction } from "./projection-action-labels";
import { problemText } from "@/src/features/contracts/error-text";
import { canRunProjectionAction } from "./projection-authorization";

type ActionFeedback = {
  readonly tone: "progress" | "success" | "error";
  readonly message: string;
  /** Set once polling gives up, so the operator can ask the server again. */
  readonly recheck?: string;
};

const feedbackClass = {
  progress: "form-message",
  success: "form-message form-message--success",
  error: "form-message form-message--error",
} as const;

export function ProjectionActionButtons({
  audience,
  channel,
  recordKey,
  projectionId,
  version,
  actions,
  roles,
}: {
  audience: ExperienceAudience;
  channel: ProjectionChannel;
  recordKey: string;
  projectionId: string;
  version: number;
  actions: readonly string[];
  roles: readonly string[];
}) {
  const t = useTranslations();
  const router = useRouter();
  const keys = useRef(new Map<string, string>());
  const messages = useRef(new Map<string, HTMLParagraphElement | null>());
  const [pending, setPending] = useState<readonly string[]>([]);
  const [feedback, setFeedback] = useState<
    Readonly<Record<string, ActionFeedback>>
  >({});
  /** Bumped on confirmation so the uncontrolled dialog returns to its closed state. */
  const [confirmations, setConfirmations] = useState(0);
  const region = useId();

  const authorizedActions = actions.filter((action) =>
    canRunProjectionAction(roles, audience, channel, action),
  );
  /**
   * A command that lands usually spends the record's last permitted action, so
   * the refresh that follows it leaves nothing to press. The receipt stays: an
   * early return here used to drop "was applied" the moment it was reported.
   */
  const readOnly = authorizedActions.length === 0;
  if (readOnly && Object.keys(feedback).length === 0)
    return <span>{t("projection.action.readOnly")}</span>;

  const messageId = (action: string) => `${region}-${action}`;
  const report = (action: string, next: ActionFeedback) =>
    setFeedback((current) => ({ ...current, [action]: next }));
  const track = (action: string, running: boolean) =>
    setPending((current) =>
      running
        ? current.includes(action)
          ? current
          : [...current, action]
        : current.filter((value) => value !== action),
    );

  /**
   * Polls the receipt until the server reports a terminal status. Falling out of
   * the loop is reported as an unresolved command, never as a completed one.
   */
  const awaitReceipt = async (action: string, actionRequestId: string) => {
    for (let attempt = 0; attempt < 15; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      const receipt = await readProjectionAction({
        audience,
        channel,
        recordKey,
        actionRequestId,
      });
      if (receipt.status === "queued") continue;
      if (receipt.status === "applied")
        report(action, {
          tone: "success",
          message:
            receipt.authoritativeVersion === null
              ? t("experience.action.appliedUnknownVersion", {
                  action: actionLabel(action, t),
                })
              : t("experience.action.applied", {
                  action: actionLabel(action, t),
                  version: receipt.authoritativeVersion,
                }),
        });
      else
        report(action, {
          tone: "error",
          // The receipt status is a closed pair; each gets its own sentence
          // rather than the raw status word inside a translated one.
          message: t(
            receipt.status === "failed"
              ? "experience.action.failed"
              : "experience.action.rejected",
            {
              action: actionLabel(action, t),
              code: receipt.resultCode ?? "AUTHORITATIVE_COMMAND_REJECTED",
            },
          ),
        });
      router.refresh();
      return;
    }
    report(action, {
      tone: "progress",
      message: t("experience.action.timeout", {
        action: actionLabel(action, t),
      }),
      recheck: actionRequestId,
    });
  };

  /**
   * The API's problem title is English for integrators and is never shown; the
   * reader gets a sentence chosen from its stable code and status.
   */
  const failed = (action: string) => (error: unknown) =>
    report(action, {
      tone: "error",
      message: t("common.join.sentences", {
        first: t("experience.action.notApplied", {
          action: actionLabel(action, t),
        }),
        second: problemText(error, t, {
          fallback: t("experience.problem.refused"),
        }),
      }),
    });

  const run = (action: string) => {
    track(action, true);
    report(action, {
      tone: "progress",
      message: t("experience.action.submitting", {
        action: actionLabel(action, t),
      }),
    });
    const idempotencyKey = keys.current.get(action) ?? crypto.randomUUID();
    keys.current.set(action, idempotencyKey);
    void sendProjectionAction(
      {
        audience,
        channel,
        recordKey,
        projectionId,
        action,
        expectedVersion: version,
      },
      { idempotencyKey },
    )
      .then(async (queued) => {
        report(action, {
          tone: "progress",
          message: t("experience.action.queued", {
            action: actionLabel(action, t),
          }),
        });
        await awaitReceipt(action, queued.id);
      })
      .catch(failed(action))
      .finally(() => track(action, false));
  };

  const recheck = (action: string, actionRequestId: string) => {
    track(action, true);
    report(action, {
      tone: "progress",
      message: t("experience.action.rechecking", {
        action: actionLabel(action, t),
      }),
    });
    void awaitReceipt(action, actionRequestId)
      .catch(failed(action))
      .finally(() => track(action, false));
  };

  return (
    <div>
      {readOnly ? <span>{t("projection.action.readOnly")}</span> : null}
      {authorizedActions.map((action) => {
        const running = pending.includes(action);
        const destructive = isDestructiveAction(action);
        const control = (
          <Button
            key={action}
            size="small"
            variant={destructive ? "danger" : "secondary"}
            disabled={running}
            aria-describedby={feedback[action] ? messageId(action) : undefined}
            {...(destructive ? {} : { onClick: () => run(action) })}
          >
            {running ? t("projection.action.pending") : actionLabel(action, t)}
          </Button>
        );
        if (!destructive) return control;
        return (
          <Dialog
            key={`${action}:${confirmations}`}
            title={t("projection.action.confirm.title", {
              action: actionLabel(action, t),
            })}
            description={t("projection.action.confirm.description", {
              record: recordKey,
              version,
            })}
            closeLabel={t("projection.action.confirm.cancel")}
            trigger={control}
            footer={
              <Button
                variant="danger"
                size="small"
                onClick={() => {
                  setConfirmations((count) => count + 1);
                  run(action);
                  window.setTimeout(
                    () => messages.current.get(action)?.focus(),
                    0,
                  );
                }}
              >
                {actionLabel(action, t)}
              </Button>
            }
          >
            <p>{t("projection.action.confirm.detail")}</p>
          </Dialog>
        );
      })}
      {Object.entries(feedback).map(([action, item]) => {
        const actionRequestId = item.recheck;
        return (
          <div key={action}>
            <p
              id={messageId(action)}
              ref={(node) => {
                messages.current.set(action, node);
              }}
              tabIndex={-1}
              role={item.tone === "error" ? "alert" : "status"}
              className={feedbackClass[item.tone]}
            >
              {item.message}
            </p>
            {actionRequestId ? (
              <Button
                size="small"
                variant="secondary"
                disabled={pending.includes(action)}
                onClick={() => recheck(action, actionRequestId)}
              >
                {t("projection.action.recheck")}
              </Button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
