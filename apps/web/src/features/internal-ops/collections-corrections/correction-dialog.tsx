"use client";
import { useTranslations } from "@/src/i18n/client";
import { localizeCopy } from "@/src/i18n/copy";

import { useState, useTransition } from "react";

import { Button, Dialog, Input, Select, Textarea } from "@clockwork/ui";

import {
  CommerceApiError,
  sendCoreCommand,
} from "@/src/features/contracts/commerce-client";
import { uuidV7 } from "@clockwork/contracts";

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
  amountLabel: string | null;
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

function failureMessage(error: unknown): string {
  if (!(error instanceof CommerceApiError))
    return correctionCopy.failures.unknown;
  if (error.code === "forbidden") return correctionCopy.failures.forbidden;
  if (error.code === "conflict") return correctionCopy.failures.conflict;
  if (error.code === "unavailable") return correctionCopy.failures.unavailable;
  if (error.code === "validation")
    return `${correctionCopy.failures.validation} ${error.message}`;
  return correctionCopy.failures.unknown;
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
  const localizedcorrectionCopy = localizeCopy(correctionCopy, t);
  const [input, setInput] = useState<CorrectionInput>(() => emptyInput(kind));
  const [refusals, setRefusals] = useState<readonly CorrectionRefusal[]>([]);
  const [message, setMessage] = useState("");
  const [recorded, setRecorded] = useState("");
  const [pending, startTransition] = useTransition();
  const labels = localizedcorrectionCopy.kinds[kind];
  const reasons: readonly string[] = providerReasons[kind];

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
    setMessage("");
  }

  function submit() {
    const built = buildCorrectionCommand(domain, input);
    if (!built.ok) {
      setRefusals(built.refusals);
      return;
    }
    setRefusals([]);
    setMessage("");
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
        setMessage(failureMessage(error));
      }
    });
  }

  return (
    <Dialog
      title={`${labels.trigger} · ${subject.reference}`}
      description={labels.effect}
      trigger={
        <Button variant="secondary" size="small">
          {labels.trigger}
        </Button>
      }
      footer={
        <Button
          variant={kind === "dispute" ? "primary" : "danger"}
          size="small"
          onClick={submit}
          disabled={pending || Boolean(recorded)}
        >
          {pending ? localizedcorrectionCopy.submitting : labels.confirm}
        </Button>
      }
    >
      <dl className={styles.reviewGrid}>
        <div>
          <dt>{localizedcorrectionCopy.subject}</dt>
          <dd>
            {subject.reference}
            <span className={styles.id}> {subject.invoiceId}</span>
          </dd>
        </div>
        <div>
          <dt>{localizedcorrectionCopy.effectTerm}</dt>
          <dd>{labels.effect}</dd>
        </div>
        <div>
          <dt>{localizedcorrectionCopy.reversibleTerm}</dt>
          <dd>{labels.reversible}</dd>
        </div>
      </dl>

      <Input
        label={localizedcorrectionCopy.fields.amount}
        name="amountMinor"
        inputMode="numeric"
        value={input.amountMinor}
        onChange={(event) => set("amountMinor", event.currentTarget.value)}
        help={localizedcorrectionCopy.fields.amountHelp(
          subject.currency,
          subject.amountLabel,
        )}
        required
      />

      {reasons.length > 0 ? (
        <Select
          label={localizedcorrectionCopy.fields.providerReason}
          name="providerReason"
          value={input.providerReason}
          onChange={(event) => set("providerReason", event.currentTarget.value)}
          options={reasons.map((reason) => ({
            value: reason,
            label: reason.replaceAll("_", " "),
          }))}
          help={localizedcorrectionCopy.fields.providerReasonHelp}
        />
      ) : null}

      {kind === "dispute" ? null : (
        <Textarea
          label={localizedcorrectionCopy.fields.internalReason}
          name="internalReasonCode"
          value={input.internalReasonCode}
          onChange={(event) =>
            set("internalReasonCode", event.currentTarget.value)
          }
          help={localizedcorrectionCopy.fields.internalReasonHelp}
          rows={2}
          required
        />
      )}

      {kind === "credit_note" ? null : (
        <Input
          label={localizedcorrectionCopy.fields.payment}
          name="paymentId"
          value={input.paymentId}
          onChange={(event) => set("paymentId", event.currentTarget.value)}
          help={localizedcorrectionCopy.fields.paymentHelp}
          required
        />
      )}

      {kind === "dispute" ? (
        <>
          <Input
            label={localizedcorrectionCopy.fields.disputeReference}
            name="stripeDisputeId"
            value={input.stripeDisputeId}
            onChange={(event) =>
              set("stripeDisputeId", event.currentTarget.value)
            }
            help={localizedcorrectionCopy.fields.disputeReferenceHelp}
            required
          />
          <Input
            label={localizedcorrectionCopy.fields.evidenceDue}
            name="evidenceDueAt"
            type="datetime-local"
            value={input.evidenceDueAt}
            onChange={(event) =>
              set("evidenceDueAt", event.currentTarget.value)
            }
            help={localizedcorrectionCopy.fields.evidenceDueHelp}
            required
          />
        </>
      ) : null}

      <p className={styles.actorNote}>{localizedcorrectionCopy.authority}</p>

      {refusals.length > 0 ? (
        <ul className={styles.blocked} role="alert">
          {refusals.map((refusal) => (
            <li key={refusal}>{localizedcorrectionCopy.refusals[refusal]}</li>
          ))}
        </ul>
      ) : null}

      {message ? (
        <p className={styles.blocked} role="alert">
          {message}
        </p>
      ) : null}

      {recorded ? (
        <p className={styles.statusMessage} role="status">
          {localizedcorrectionCopy.recorded(recorded)}
        </p>
      ) : null}

      <details className={styles.disclosure}>
        <summary>{localizedcorrectionCopy.refusalsSummary}</summary>
        <ul>
          {(
            Object.keys(
              localizedcorrectionCopy.refusals,
            ) as readonly CorrectionRefusal[]
          ).map((refusal) => (
            <li key={refusal}>{localizedcorrectionCopy.refusals[refusal]}</li>
          ))}
        </ul>
      </details>
    </Dialog>
  );
}
