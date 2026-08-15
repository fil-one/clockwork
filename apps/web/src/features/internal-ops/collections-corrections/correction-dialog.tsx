"use client";

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
  const [input, setInput] = useState<CorrectionInput>(() => emptyInput(kind));
  const [refusals, setRefusals] = useState<readonly CorrectionRefusal[]>([]);
  const [message, setMessage] = useState("");
  const [recorded, setRecorded] = useState("");
  const [pending, startTransition] = useTransition();
  const labels = correctionCopy.kinds[kind];
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
          {pending ? correctionCopy.submitting : labels.confirm}
        </Button>
      }
    >
      <dl className={styles.reviewGrid}>
        <div>
          <dt>{correctionCopy.subject}</dt>
          <dd>
            {subject.reference}
            <span className={styles.id}> {subject.invoiceId}</span>
          </dd>
        </div>
        <div>
          <dt>{correctionCopy.effectTerm}</dt>
          <dd>{labels.effect}</dd>
        </div>
        <div>
          <dt>{correctionCopy.reversibleTerm}</dt>
          <dd>{labels.reversible}</dd>
        </div>
      </dl>

      <Input
        label={correctionCopy.fields.amount}
        name="amountMinor"
        inputMode="numeric"
        value={input.amountMinor}
        onChange={(event) => set("amountMinor", event.currentTarget.value)}
        help={correctionCopy.fields.amountHelp(
          subject.currency,
          subject.amountLabel,
        )}
        required
      />

      {reasons.length > 0 ? (
        <Select
          label={correctionCopy.fields.providerReason}
          name="providerReason"
          value={input.providerReason}
          onChange={(event) => set("providerReason", event.currentTarget.value)}
          options={reasons.map((reason) => ({
            value: reason,
            label: reason.replaceAll("_", " "),
          }))}
          help={correctionCopy.fields.providerReasonHelp}
        />
      ) : null}

      {kind === "dispute" ? null : (
        <Textarea
          label={correctionCopy.fields.internalReason}
          name="internalReasonCode"
          value={input.internalReasonCode}
          onChange={(event) =>
            set("internalReasonCode", event.currentTarget.value)
          }
          help={correctionCopy.fields.internalReasonHelp}
          rows={2}
          required
        />
      )}

      {kind === "credit_note" ? null : (
        <Input
          label={correctionCopy.fields.payment}
          name="paymentId"
          value={input.paymentId}
          onChange={(event) => set("paymentId", event.currentTarget.value)}
          help={correctionCopy.fields.paymentHelp}
          required
        />
      )}

      {kind === "dispute" ? (
        <>
          <Input
            label={correctionCopy.fields.disputeReference}
            name="stripeDisputeId"
            value={input.stripeDisputeId}
            onChange={(event) =>
              set("stripeDisputeId", event.currentTarget.value)
            }
            help={correctionCopy.fields.disputeReferenceHelp}
            required
          />
          <Input
            label={correctionCopy.fields.evidenceDue}
            name="evidenceDueAt"
            type="datetime-local"
            value={input.evidenceDueAt}
            onChange={(event) =>
              set("evidenceDueAt", event.currentTarget.value)
            }
            help={correctionCopy.fields.evidenceDueHelp}
            required
          />
        </>
      ) : null}

      <p className={styles.actorNote}>{correctionCopy.authority}</p>

      {refusals.length > 0 ? (
        <ul className={styles.blocked} role="alert">
          {refusals.map((refusal) => (
            <li key={refusal}>{correctionCopy.refusals[refusal]}</li>
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
          {correctionCopy.recorded(recorded)}
        </p>
      ) : null}

      <details className={styles.disclosure}>
        <summary>{correctionCopy.refusalsSummary}</summary>
        <ul>
          {(
            Object.keys(correctionCopy.refusals) as readonly CorrectionRefusal[]
          ).map((refusal) => (
            <li key={refusal}>{correctionCopy.refusals[refusal]}</li>
          ))}
        </ul>
      </details>
    </Dialog>
  );
}
