import {
  durableHumanWait,
  type DurableHumanWait,
  workflowEffect,
  type WorkflowEffect,
  type WorkflowIdentity,
} from "../onboarding/durable";

export const agreementTaskIds = Object.freeze({
  envelopeDispatch: "lifecycle-agreements-envelope-dispatch-v1",
  signatureReminder: "lifecycle-agreements-signature-reminder-v1",
  evidenceIngestion: "lifecycle-agreements-evidence-ingestion-v1",
});

export type EnvelopeState =
  "draft" | "sent" | "viewed" | "completed" | "declined" | "voided" | "expired";

export interface VerifiedSignatureEvent {
  providerEventId: string;
  envelopeId: string;
  occurredAt: string;
  state: EnvelopeState;
  signedPdf?: Uint8Array;
  certificate?: Uint8Array;
  signedPdfSha256?: string;
  certificateSha256?: string;
}

export type AgreementEffect = WorkflowEffect<
  | "create_signature_envelope"
  | "send_signature_reminder"
  | "store_signed_pdf"
  | "store_completion_certificate"
  | "record_envelope_state"
  | "open_legal_exception",
  Readonly<Record<string, unknown>>
>;

function envelopeIdentity(
  agreementId: string,
  version: number,
): WorkflowIdentity {
  return {
    aggregateType: "agreement",
    aggregateId: agreementId,
    aggregateVersion: version,
    operation: "counter-sign",
  };
}

export function startCounterSignature(input: {
  agreementId: string;
  accountId: string;
  documentId: string;
  signerEmail: string;
  version: number;
  expiresAt: string;
}): { effect: AgreementEffect; wait: DurableHumanWait } {
  const identity = envelopeIdentity(input.agreementId, input.version);
  return {
    effect: workflowEffect(
      identity,
      "create-envelope",
      "create_signature_envelope",
      {
        agreementId: input.agreementId,
        accountId: input.accountId,
        documentId: input.documentId,
        signerEmail: input.signerEmail,
        redirectFallbackRequired: true,
      },
    ),
    wait: durableHumanWait({
      identity,
      discriminator: "signature-completion",
      subjectType: "agreement",
      subjectId: input.agreementId,
      resumeEvents: [
        "signature.completed",
        "signature.declined",
        "signature.voided",
        "signature.expired",
      ],
      expiresAt: input.expiresAt,
    }),
  };
}

export function planSignatureReminder(input: {
  agreementId: string;
  version: number;
  envelopeId: string;
  state: EnvelopeState;
  reminderNumber: number;
  executeAt: string;
}): AgreementEffect | null {
  if (!["sent", "viewed"].includes(input.state)) return null;
  if (!Number.isSafeInteger(input.reminderNumber) || input.reminderNumber < 1)
    throw new Error("SIGNATURE_REMINDER_NUMBER_INVALID");
  return workflowEffect(
    envelopeIdentity(input.agreementId, input.version),
    `envelope:${input.envelopeId}:reminder:${input.reminderNumber}`,
    "send_signature_reminder",
    { envelopeId: input.envelopeId, agreementId: input.agreementId },
    input.executeAt,
  );
}

export type SignatureIngestion =
  | Readonly<{ status: "replay_ignored"; effects: readonly [] }>
  | Readonly<{ status: "out_of_order_ignored"; effects: readonly [] }>
  | Readonly<{
      status: "state_recorded" | "completed";
      effects: readonly AgreementEffect[];
    }>;

/**
 * Consumes only an event returned by the signature verifier. The caller must
 * atomically persist providerEventId before executing effects.
 */
export function ingestVerifiedSignatureEvent(input: {
  agreementId: string;
  accountId: string;
  version: number;
  event: VerifiedSignatureEvent;
  currentState: EnvelopeState;
  processedProviderEventIds: ReadonlySet<string>;
  retainUntil: string;
}): SignatureIngestion {
  if (input.processedProviderEventIds.has(input.event.providerEventId))
    return { status: "replay_ignored", effects: [] };
  const allowedTransitions: Readonly<
    Record<EnvelopeState, readonly EnvelopeState[]>
  > = {
    draft: ["draft", "sent", "declined", "voided", "expired"],
    sent: ["sent", "viewed", "completed", "declined", "voided", "expired"],
    viewed: ["viewed", "completed", "declined", "voided", "expired"],
    completed: ["completed"],
    declined: ["declined"],
    voided: ["voided"],
    expired: ["expired"],
  };
  if (!allowedTransitions[input.currentState].includes(input.event.state))
    return { status: "out_of_order_ignored", effects: [] };
  const identity = envelopeIdentity(input.agreementId, input.version);
  const stateEffect = workflowEffect(
    identity,
    `provider-event:${input.event.providerEventId}:state`,
    "record_envelope_state",
    {
      providerEventId: input.event.providerEventId,
      envelopeId: input.event.envelopeId,
      state: input.event.state,
      occurredAt: input.event.occurredAt,
    },
  );
  if (input.event.state !== "completed")
    return { status: "state_recorded", effects: [stateEffect] };
  if (
    !input.event.signedPdf ||
    !input.event.certificate ||
    !input.event.signedPdfSha256 ||
    !input.event.certificateSha256
  )
    throw new Error("COMPLETED_ENVELOPE_EVIDENCE_REQUIRED");
  return {
    status: "completed",
    effects: [
      workflowEffect(
        identity,
        `envelope:${input.event.envelopeId}:signed-pdf:${input.event.signedPdfSha256}`,
        "store_signed_pdf",
        {
          accountId: input.accountId,
          agreementId: input.agreementId,
          bytes: input.event.signedPdf,
          contentHash: input.event.signedPdfSha256,
          retainUntil: input.retainUntil,
        },
      ),
      workflowEffect(
        identity,
        `envelope:${input.event.envelopeId}:certificate:${input.event.certificateSha256}`,
        "store_completion_certificate",
        {
          accountId: input.accountId,
          agreementId: input.agreementId,
          bytes: input.event.certificate,
          contentHash: input.event.certificateSha256,
          retainUntil: input.retainUntil,
        },
      ),
      stateEffect,
    ],
  };
}

export function routeNegotiatedAgreement(input: {
  agreementId: string;
  version: number;
  paper: "ours" | "theirs";
  hasRedlines: boolean;
  keyTermsComplete: boolean;
}): readonly AgreementEffect[] {
  if (input.paper === "ours" && !input.hasRedlines && input.keyTermsComplete)
    return [];
  const reasons = [
    input.paper === "theirs" ? "CUSTOMER_PAPER" : null,
    input.hasRedlines ? "REDLINES" : null,
    !input.keyTermsComplete ? "KEY_TERMS_INCOMPLETE" : null,
  ].filter((reason): reason is string => reason !== null);
  return [
    workflowEffect(
      {
        ...envelopeIdentity(input.agreementId, input.version),
        operation: "legal-review",
      },
      reasons.join("+"),
      "open_legal_exception",
      { agreementId: input.agreementId, reasons },
    ),
  ];
}
