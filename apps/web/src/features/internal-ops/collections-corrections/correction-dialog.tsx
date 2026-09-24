"use client";
import type { Translator } from "@/src/i18n";
import { useFormattingLocale, useTranslations } from "@/src/i18n/client";

import { useState, useTransition } from "react";

import { Button, Dialog, Input, Select, Textarea } from "@clockwork/ui";

import {
  CommerceApiError,
  sendCoreCommand,
} from "@/src/features/contracts/commerce-client";
import { uuidV7 } from "@clockwork/contracts";

import { formatMinorAmount } from "../finance-lifecycle/projection-fields";
import { correctionCopy } from "./copy";
import {
  buildCorrectionCommand,
  providerReasons,
  type CorrectionInput,
  type CorrectionKind,
  type CorrectionRefusal,
  type CorrectionSubject,
} from "./model";
import styles from "../finance-lifecycle/finance-lifecycle.module.css";

interface SerializableSubject {
  invoiceId: string;
  accountId: string | null;
  currency: string | null;
  /** Minor units as an exact decimal string; `null` when unrecorded. */
  amountMinor: string | null;
  reference: string;
}

function emptyInput(kind: CorrectionKind): CorrectionInput {
  return {
    kind,
    amountMinor: "",
    providerReason: providerReasons[kind][0] ?? "",
    internalReasonCode: "",
    paymentId: "",
    stripeDisputeId: "",
    evidenceDueAt: "",
  };
}

/**
 * What the operator is told when the server refuses or cannot be reached,
 * worded from the failure class in the reader's language. The server's English
 * `detail` is never quoted to the reader; when the server sent a problem code,
 * that identifier is shown so the refusal can still be traced.
 */
function failureMessage(
  error: unknown,
  t: Translator,
): { text: string; code?: string } {
  if (!(error instanceof CommerceApiError))
    return { text: t(correctionCopy.failures.unknown) };
  if (error.code === "forbidden")
    return { text: t(correctionCopy.failures.forbidden) };
  if (error.code === "conflict")
    return { text: t(correctionCopy.failures.conflict) };
  if (error.code === "unavailable")
    return { text: t(correctionCopy.failures.unavailable) };
  if (error.code === "validation")
    return {
      text: t(correctionCopy.failures.validation),
      ...(error.problemCode ? { code: error.problemCode } : {}),
    };
  return { text: t(correctionCopy.failures.unknown) };
}

/**
 * One money correction against one invoice.
 *
 * The invoice identity, the billing account and the currency come from the row
 * the operator opened and are never editable here. What the operator supplies
 * is the amount, the reasons, and -- for a refund or a dispute -- the payment
 * identity, which is labelled as operator-supplied because no read surface
 * resolves one.
 */
export function CorrectionDialog({
  kind,
  subject,
}: {
  kind: CorrectionKind;
  subject: SerializableSubject;
}) {
  const t = useTranslations();
  const formattingLocale = useFormattingLocale();
  const [input, setInput] = useState<CorrectionInput>(() => emptyInput(kind));
  const [refusals, setRefusals] = useState<readonly CorrectionRefusal[]>([]);
  const [message, setMessage] = useState<{ text: string; code?: string }>();
  const [recorded, setRecorded] = useState("");
  const [pending, startTransition] = useTransition();
  const labels = correctionCopy.kinds[kind];
  const reasons = providerReasons[kind];
  const invoiceTotal =
    subject.amountMinor !== null && subject.currency
      ? formatMinorAmount(
          subject.amountMinor,
          subject.currency,
          formattingLocale,
        )
      : null;
  const amountHelp = !subject.currency
    ? t(correctionCopy.fields.amountHelpNoCurrency)
    : invoiceTotal
      ? t(correctionCopy.fields.amountHelpWithTotal, {
          currency: subject.currency,
          total: invoiceTotal,
        })
      : t(correctionCopy.fields.amountHelp, { currency: subject.currency });

  const domain: CorrectionSubject = {
    invoiceId: subject.invoiceId,
    accountId: subject.accountId,
    currency: subject.currency,
    amountMinor:
      subject.amountMinor === null ? null : BigInt(subject.amountMinor),
  };

  function set<K extends keyof CorrectionInput>(
    key: K,
    value: CorrectionInput[K],
  ) {
    setInput((current) => ({ ...current, [key]: value }));
    setRefusals([]);
    setMessage(undefined);
  }

  function submit() {
    const built = buildCorrectionCommand(domain, input);
    if (!built.ok) {
      setRefusals(built.refusals);
      return;
    }
    setRefusals([]);
    setMessage(undefined);
    startTransition(async () => {
      try {
        const result = await sendCoreCommand({
          resource: built.command.resource,
          id: uuidV7(),
          accountId: built.command.accountId,
          action: built.command.action,
          payload: built.command.payload,
        });
        setRecorded(result.record.id);
      } catch (error) {
        setMessage(failureMessage(error, t));
      }
    });
  }

  return (
    <Dialog
      title={t("common.join.labels", {
        first: t(labels.trigger),
        second: subject.reference,
      })}
      description={t(labels.effect)}
      trigger={
        <Button variant="secondary" size="small">
          {t(labels.trigger)}
        </Button>
      }
      footer={
        <Button
          variant={kind === "dispute" ? "primary" : "danger"}
          size="small"
          onClick={submit}
          disabled={pending || Boolean(recorded)}
        >
          {pending ? t(correctionCopy.submitting) : t(labels.confirm)}
        </Button>
      }
    >
      <dl className={styles.reviewGrid}>
        <div>
          <dt>{t(correctionCopy.subject)}</dt>
          <dd>
            {subject.reference}
            <span className={styles.id}> {subject.invoiceId}</span>
          </dd>
        </div>
        <div>
          <dt>{t(correctionCopy.effectTerm)}</dt>
          <dd>{t(labels.effect)}</dd>
        </div>
        <div>
          <dt>{t(correctionCopy.reversibleTerm)}</dt>
          <dd>{t(labels.reversible)}</dd>
        </div>
      </dl>

      <Input
        label={t(correctionCopy.fields.amount)}
        name="amountMinor"
        inputMode="numeric"
        value={input.amountMinor}
        onChange={(event) => set("amountMinor", event.currentTarget.value)}
        help={amountHelp}
        required
      />

      {reasons.length > 0 ? (
        <Select
          label={t(correctionCopy.fields.providerReason)}
          name="providerReason"
          value={input.providerReason}
          onChange={(event) => set("providerReason", event.currentTarget.value)}
          options={reasons.map((reason) => ({
            value: reason,
            label: t(correctionCopy.providerReasons[reason]),
          }))}
          help={t(correctionCopy.fields.providerReasonHelp)}
        />
      ) : null}

      {kind === "dispute" ? null : (
        <Textarea
          label={t(correctionCopy.fields.internalReason)}
          name="internalReasonCode"
          value={input.internalReasonCode}
          onChange={(event) =>
            set("internalReasonCode", event.currentTarget.value)
          }
          help={t(correctionCopy.fields.internalReasonHelp)}
          rows={2}
          required
        />
      )}

      {kind === "credit_note" ? null : (
        <Input
          label={t(correctionCopy.fields.payment)}
          name="paymentId"
          value={input.paymentId}
          onChange={(event) => set("paymentId", event.currentTarget.value)}
          help={t(correctionCopy.fields.paymentHelp)}
          required
        />
      )}

      {kind === "dispute" ? (
        <>
          <Input
            label={t(correctionCopy.fields.disputeReference)}
            name="stripeDisputeId"
            value={input.stripeDisputeId}
            onChange={(event) =>
              set("stripeDisputeId", event.currentTarget.value)
            }
            help={t(correctionCopy.fields.disputeReferenceHelp)}
            required
          />
          <Input
            label={t(correctionCopy.fields.evidenceDue)}
            name="evidenceDueAt"
            type="datetime-local"
            value={input.evidenceDueAt}
            onChange={(event) =>
              set("evidenceDueAt", event.currentTarget.value)
            }
            help={t(correctionCopy.fields.evidenceDueHelp)}
            required
          />
        </>
      ) : null}

      <p className={styles.actorNote}>{t(correctionCopy.authority)}</p>

      {refusals.length > 0 ? (
        <ul className={styles.blocked} role="alert">
          {refusals.map((refusal) => (
            <li key={refusal}>{t(correctionCopy.refusals[refusal])}</li>
          ))}
        </ul>
      ) : null}

      {message ? (
        <div className={styles.blocked} role="alert">
          <p>{message.text}</p>
          {message.code ? (
            <p>{t(correctionCopy.serverCode, { code: message.code })}</p>
          ) : null}
        </div>
      ) : null}

      {recorded ? (
        <p className={styles.statusMessage} role="status">
          {t(correctionCopy.recorded, { reference: recorded })}
        </p>
      ) : null}

      <details className={styles.disclosure}>
        <summary>{t(correctionCopy.refusalsSummary)}</summary>
        <ul>
          {(
            Object.keys(correctionCopy.refusals) as readonly CorrectionRefusal[]
          ).map((refusal) => (
            <li key={refusal}>{t(correctionCopy.refusals[refusal])}</li>
          ))}
        </ul>
      </details>
    </Dialog>
  );
}
