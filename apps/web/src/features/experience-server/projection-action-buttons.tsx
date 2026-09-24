"use client";
import { useTranslations } from "@/src/i18n/client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Button, Dialog } from "@clockwork/ui";

import {
  readProjectionAction,
  sendProjectionAction,
} from "@/src/features/contracts/experience-client";
import type { MessageId, Translator } from "@/src/i18n";

import type { ExperienceAudience, ProjectionChannel } from "./model";
import { canRunProjectionAction } from "./projection-authorization";

/**
 * Server action identifiers carry no presentation. Without this map an operator
 * reads the raw command name (`mark_uncollectible`) on a control that changes
 * money. Every identifier the command executor accepts is listed here; anything
 * new falls back to the humanized identifier rather than rendering nothing.
 */
const actionLabels: Readonly<Record<string, MessageId>> = {
  accept: "projection.action.accept",
  add_contact: "projection.action.addContact",
  add_role: "projection.action.addRole",
  apply: "projection.action.applyAmendment",
  approve_exception: "projection.action.approveException",
  consolidate: "projection.action.consolidate",
  create: "projection.action.create",
  evaluate_dunning: "projection.action.evaluateDunning",
  execute_agreement: "projection.action.executeAgreement",
  expire: "projection.action.expire",
  issue: "projection.action.issue",
  mark_uncollectible: "projection.action.markUncollectible",
  open: "projection.action.openInvoice",
  pay: "projection.action.pay",
  prepare_artifact: "projection.action.prepareArtifact",
  convert_poc: "projection.action.convertPoc",
  price: "projection.action.price",
  reject_exception: "projection.action.rejectException",
  request_teardown: "projection.action.requestTeardown",
  request_renewal: "projection.action.requestRenewal",
  revise: "projection.action.revise",
  set_partner_credit: "projection.action.setPartnerCredit",
  set_payment_terms: "projection.action.setPaymentTerms",
  update: "projection.action.update",
  void: "projection.action.void",
};

/** Transitions that end a commercial record or remove a running service. */
const irreversibleActions = new Set([
  "expire",
  "mark_uncollectible",
  "reject_exception",
  "request_teardown",
  "void",
]);

export function actionLabel(action: string, t: Translator): string {
  const id = actionLabels[action];
  return id ? t(id) : action.replaceAll("_", " ");
}

export function isDestructiveAction(action: string): boolean {
  return (
    irreversibleActions.has(action) ||
    /delete|teardown|terminate|cancel/i.test(action)
  );
}

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
  if (authorizedActions.length === 0)
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
              ? t("projection.action.appliedUnknownVersion", {
                  action: actionLabel(action, t),
                })
              : t("projection.action.applied", {
                  action: actionLabel(action, t),
                  version: receipt.authoritativeVersion,
                }),
        });
      else
        report(action, {
          tone: "error",
          message: t("projection.action.rejected", {
            action: actionLabel(action, t),
            status: receipt.status,
            code: receipt.resultCode ?? "AUTHORITATIVE_COMMAND_REJECTED",
          }),
        });
      router.refresh();
      return;
    }
    report(action, {
      tone: "progress",
      message: t("projection.action.timeout", {
        action: actionLabel(action, t),
      }),
      recheck: actionRequestId,
    });
  };

  const failed = (action: string) => (error: unknown) =>
    report(action, {
      tone: "error",
      message:
        error instanceof Error
          ? error.message
          : t("projection.action.conflict"),
    });

  const run = (action: string) => {
    track(action, true);
    report(action, {
      tone: "progress",
      message: t("projection.action.submitting", {
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
          message: t("projection.action.queued", {
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
      message: t("projection.action.rechecking", {
        action: actionLabel(action, t),
      }),
    });
    void awaitReceipt(action, actionRequestId)
      .catch(failed(action))
      .finally(() => track(action, false));
  };

  return (
    <div>
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
