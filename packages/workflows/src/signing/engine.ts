import type {
  Actor,
  MndaCancelCode,
  SigningDocumentType,
  SigningState,
} from "@clockwork/contracts";
import {
  assertSignWellFields,
  checkSignWellCopiedContacts,
  signWellAttentionReason,
  signWellFieldValues,
  signWellRefused,
  signWellSigningState,
  type SignWellSigningDocument,
} from "@clockwork/integrations";

/** A signer as the request records them. */
export interface SigningSigner {
  name: string;
  /** The address SignWell should have now. */
  email: string;
  /** Every address SignWell may show for this signer: the original, a
   * confirmed correction and one still pending. */
  accepted: readonly string[];
  /** A correction sent to SignWell and not yet confirmed. */
  pending: string | null;
}

/** What the engine reads from a request, whichever table holds it. */
export interface SigningView {
  id: string;
  state: SigningState;
  providerId: string | null;
  testMode: boolean;
  templateHash: string;
  error: string | null;
  remindedAt: string | null;
  /** Approved, or the request needs no approval. */
  approved: boolean;
  /** By SignWell recipient id: the declared signers who sign this request. */
  signers: Readonly<Record<string, SigningSigner>>;
  /** Addresses SignWell must copy on the completed document. */
  copiedContacts: readonly string[];
}

export interface SigningPatch {
  state?: SigningState;
  providerId?: string;
  error?: string | null;
  remindedAt?: Date;
  cancelCode?: MndaCancelCode;
  cancelReason?: string;
  /** The correctable signer's pending and confirmed corrections. */
  pendingSignerEmail?: string | null;
  correctedSignerEmail?: string;
  /** With completion: what the first signer entered in the declared capture
   * fields, by field id. Empty when SignWell reported none. */
  capturedFields?: Readonly<Record<string, string>>;
}

/** A change worth its own history entry, beyond a state change. */
export interface SigningNote {
  /** Overrides the store's default event for the new state. */
  eventType?: string;
  before?: Record<string, unknown>;
  detail?: Record<string, unknown>;
  /** A second history entry, recorded after the first in the same change. */
  followUp?: { eventType: string; detail?: Record<string, unknown> };
}

/**
 * Persistence for one document type. Adapters over the existing repositories
 * implement it; their rules stay theirs: the lease token, frozen terminal
 * rows, the executed PDF stored and hash-checked in the transaction that
 * completes the request, and history on the request's own aggregate.
 */
export interface SigningStore<R> {
  /**
   * What the table can keep beyond state and error: `signer_correction` (a
   * pending and a confirmed signer email, with before-images in history),
   * `cancel_code` (why a request closed, and a typed void reason) and
   * `captured_fields` (the first signer's entered values, kept with
   * completion, and a follow-up history entry in the same change).
   */
  capabilities: ReadonlySet<SigningStoreCapability>;
  view(record: R): SigningView;
  claim(id: string): Promise<{ record: R; token: string }>;
  extendLease(id: string, token: string): Promise<void>;
  release(id: string, token: string): Promise<void>;
  get(id: string): Promise<R>;
  /** The PDF prepared for signature, verified against its recorded hash. */
  originalPdf(id: string): Promise<Uint8Array>;
  update(
    record: R,
    token: string,
    patch: SigningPatch,
    actor: Actor,
    executed?: Uint8Array,
    note?: SigningNote,
  ): Promise<R>;
  /** Where the type declares approval: records a decision. Only a pending
   * request can be decided, and never by its preparer. */
  decide?(
    id: string,
    decision: SigningDecision,
    actor: Actor & { kind: "user" },
  ): Promise<R>;
}
export type SigningDecision =
  { approve: true } | { approve: false; reason: string };
export type SigningStoreCapability =
  "signer_correction" | "cancel_code" | "captured_fields";

/** The SignWell calls the engine makes. */
export interface SignWellCalls<R> {
  createDraft(record: R, pdf: Uint8Array): Promise<SignWellSigningDocument>;
  get(id: string): Promise<SignWellSigningDocument>;
  send(id: string, testMode: boolean): Promise<void>;
  remind(id: string): Promise<void>;
  /** Deletes the document in SignWell, which also stops signing. */
  cancel(id: string): Promise<void>;
  /** Needed only where a slot is correctable. */
  updateRecipient?(
    id: string,
    recipient: { id: string; name: string; email: string },
  ): Promise<SignWellSigningDocument>;
  completedPdf(id: string): Promise<Uint8Array>;
}

/** How a void is explained: a typed reason, or a code. */
export type SigningVoidReason = { reason: string } | { code: "signer_change" };

const terminal: readonly SigningState[] = [
  "completed",
  "declined",
  "expired",
  "canceled",
];
/** A request can be voided until the first signer has signed. */
const voidable: readonly SigningState[] = [
  "draft",
  "preparing",
  "ready",
  "sent",
  "viewed",
  "attention",
];
/** The states in which SignWell has the request out for signature. */
const outForSignature: readonly SigningState[] = [
  "sending",
  "sent",
  "viewed",
  "awaiting_countersignature",
];
const waiting: readonly SigningState[] = [
  "sent",
  "viewed",
  "awaiting_countersignature",
];
/** Manual reminders are spaced so a double click cannot email twice. */
export const signingReminderCooldownMs = 60_000;

const notFound = (error: unknown) =>
  error instanceof Error && error.message === "SIGNWELL_HTTP_404";
const httpStatus = (error: unknown) =>
  error instanceof Error
    ? /^SIGNWELL_HTTP_(\d{3})$/.exec(error.message)?.[1]
    : undefined;
const failure = (code: string) => new Error(`SIGNING_${code}`);
const is = (error: unknown, ...codes: string[]) =>
  error instanceof Error &&
  codes.some((code) => error.message === `SIGNING_${code}`);
const message = (error: unknown) =>
  error instanceof Error ? error.message.slice(0, 120) : "";
/** SignWell's copy disagrees with the record. Nothing is applied from it; the
 * request waits in `attention` until a person voids it. */
const signWellFieldsMismatch = "signwell_fields_mismatch";
const mismatchReasons: Readonly<Record<string, string>> = {
  SIGNWELL_SIGNERS_MISMATCH: "signwell_signers_mismatch",
  SIGNWELL_BINDING_MISMATCH: "signwell_binding_mismatch",
  // The unsent draft carries fields other than the declared ones, such as a
  // PDF's own form fields; sending it again cannot change that.
  SIGNWELL_SIGNING_FIELDS_MISMATCH: signWellFieldsMismatch,
  SIGNWELL_SIGNING_ORDER_MISMATCH: signWellFieldsMismatch,
};
const mismatchReason = (error: unknown) =>
  error instanceof Error ? mismatchReasons[error.message] : undefined;
const mismatched = (view: SigningView) =>
  view.state === "attention" &&
  (view.error === "signwell_signed_mismatch" ||
    Object.values(mismatchReasons).some((reason) => reason === view.error));
/** Signed by anyone, as SignWell's own copy reports it. */
const signedInSignWell = (doc: SignWellSigningDocument) =>
  doc.status.toLowerCase() === "completed" ||
  doc.recipients.some((r) =>
    ["signed", "completed"].includes(r.status?.toLowerCase() ?? ""),
  );

/** Someone signed SignWell's mismatched copy: only a person in SignWell can
 * decide whether it stands, so it is never voided from here. */
const mismatchFor = (doc: SignWellSigningDocument, reason: string) =>
  signedInSignWell(doc) ? "signwell_signed_mismatch" : reason;

/**
 * Names an engine error in a type's own codes: `SIGNING_NOT_PENDING` becomes
 * `MNDA_NOT_PENDING`, unless the type maps a code it has no message for to
 * one it has. Every other error passes through unchanged.
 */
export function signingErrors(
  type: { errorPrefix: string },
  renamed: Readonly<Record<string, string>> = {},
) {
  return (error: unknown): never => {
    if (error instanceof Error && error.message.startsWith("SIGNING_")) {
      const code = error.message.slice("SIGNING_".length);
      throw new Error(renamed[code] ?? `${type.errorPrefix}_${code}`);
    }
    throw error;
  };
}

/**
 * One signing workflow for every document type (ADR 0012). Provider
 * documents are created as unsent drafts and bound before sending; retries
 * and callbacks always read that same document's authoritative state. Errors
 * are `SIGNING_*` codes, which each type's workflow names in its own terms.
 */
export class SigningEngine<R> {
  constructor(
    private readonly type: SigningDocumentType<R>,
    private readonly store: SigningStore<R>,
    private readonly signWell: SignWellCalls<R>,
    private readonly wait: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {
    // The states, the reminder target and the void rule assume one signer
    // followed by one countersigner.
    if (type.slots.length !== 2)
      throw new Error(
        `${type.errorPrefix} signing needs exactly two signers, in order`,
      );
    const correctable = type.slots.filter((slot) => slot.correctable);
    if (correctable.length > 1)
      throw new Error(
        `${type.errorPrefix} signing can correct at most one signer`,
      );
    if (
      correctable.length > 0 &&
      (!store.capabilities.has("signer_correction") ||
        !signWell.updateRecipient)
    )
      throw new Error(
        `${type.errorPrefix} declares a correctable signer its store or SignWell client cannot correct`,
      );
    if (type.capture?.length && !store.capabilities.has("captured_fields"))
      throw new Error(
        `${type.errorPrefix} declares captured fields its store cannot keep`,
      );
  }

  private get slots() {
    return [...this.type.slots].sort((a, b) => a.order - b.order);
  }
  /** The declared signers who sign this request, in order: a slot the
   * store's view leaves out does not sign it (counterparty paper the
   * counterparty signed already). */
  private signing(view: SigningView) {
    return this.slots.filter((slot) => slot.id in view.signers);
  }
  /** The signer whose email staff may correct; the stores keep one pending
   * and one confirmed correction per request. */
  private get correctable() {
    return this.type.slots.find((slot) => slot.correctable);
  }
  /** Operator logs carry identifiers and error codes only. */
  private warn(event: string, id: string, detail: Record<string, unknown>) {
    // i18n-exempt: operator log; identifiers and error codes only
    console.warn(`${this.type.errorPrefix} ${event}`, {
      [`${this.type.auditPrefix}Id`]: id,
      ...detail,
    });
  }
  private event(name: string) {
    return `${this.type.auditPrefix}.${name}`;
  }
  private state(doc: SignWellSigningDocument, view: SigningView) {
    return signWellSigningState(doc, {
      bindingKey: this.type.bindingKey,
      id: view.id,
      templateHash: view.templateHash,
      testMode: view.testMode,
      providerId: view.providerId,
      signers: this.signing(view).map(({ id }) => ({
        id,
        emails: view.signers[id]?.accepted ?? [],
      })),
    });
  }

  /**
   * Applies SignWell's state. Nothing is written when the state and the
   * error are unchanged. A correction still pending is settled here: kept
   * when SignWell shows it, dropped otherwise.
   */
  private async apply(
    record: R,
    token: string,
    doc: SignWellSigningDocument,
    actor: Actor,
  ) {
    const view = this.store.view(record);
    let state: SigningState;
    try {
      state = this.state(doc, view);
    } catch (error) {
      const reason = mismatchReason(error);
      if (!reason) throw error;
      return this.mismatch(record, token, mismatchFor(doc, reason), actor);
    }
    // A draft held for its fields stays held: its state reads as ready, but
    // only voiding it moves the request on.
    if (
      view.state === "attention" &&
      view.error === signWellFieldsMismatch &&
      (state === "ready" || state === "preparing")
    )
      return record;
    const error = state === "attention" ? signWellAttentionReason(doc) : null;
    const patch: SigningPatch = {};
    const slot = this.correctable;
    const pending = slot && view.signers[slot.id]?.pending;
    if (slot && pending) {
      const shown = doc.recipients
        .find((r) => r.id === slot.id)
        ?.email.toLowerCase();
      patch.pendingSignerEmail = null;
      if (shown === pending) patch.correctedSignerEmail = shown;
    }
    if (state === view.state && view.error === error && !pending) return record;
    const pdf =
      state === "completed"
        ? await this.signWell.completedPdf(doc.id)
        : undefined;
    // Kept in the same change as completion and its executed PDF.
    const captured =
      state === "completed" ? this.captured(record, doc) : undefined;
    if (captured) patch.capturedFields = captured.values;
    if (captured?.missing.length)
      this.warn("signer fields not reported by SignWell", view.id, {
        providerId: doc.id,
        fields: captured.missing,
      });
    return this.store.update(
      record,
      token,
      { ...patch, state, error },
      actor,
      pdf,
      slot && pending && state === view.state
        ? {
            eventType: this.event(
              patch.correctedSignerEmail
                ? "signer_corrected"
                : "signer_correction_dropped",
            ),
            before: { signerEmail: view.signers[slot.id]?.email },
            detail: { signerEmail: patch.correctedSignerEmail ?? null },
          }
        : captured?.missing.length
          ? {
              followUp: {
                eventType: this.event("fields_unreported"),
                detail: { fields: captured.missing },
              },
            }
          : undefined,
    );
  }
  /**
   * What the first signer entered in the declared capture fields this
   * request asked of them, and which of those SignWell did not report.
   * Undefined when the request asked for none.
   */
  private captured(record: R, doc: SignWellSigningDocument) {
    const declared = new Set(this.type.capture?.map((c) => c.apiId));
    const [first] = this.slots;
    if (!first || declared.size === 0) return undefined;
    const asked = first
      .fields(record)
      .flatMap((f) => (f.apiId && declared.has(f.apiId) ? [f.apiId] : []));
    if (asked.length === 0) return undefined;
    const values = signWellFieldValues(doc, first.id, asked);
    return {
      values,
      missing: asked.filter((id) => !Object.hasOwn(values, id)),
    };
  }
  /**
   * SignWell no longer has a bound document. Signing cannot continue, but the
   * request is not closed automatically: a person voids it with a reason.
   */
  private gone(record: R, token: string, actor: Actor) {
    const view = this.store.view(record);
    if (view.state === "attention" && view.error === "deleted_in_signwell")
      return Promise.resolve(record);
    return this.store.update(
      record,
      token,
      { state: "attention", error: "deleted_in_signwell" },
      actor,
      undefined,
      { eventType: this.event("deleted_in_signwell") },
    );
  }
  /**
   * SignWell's copy names other signers or is not bound to this request. The
   * request waits for a person and keeps its state otherwise: nothing from
   * the mismatched copy is applied.
   */
  private mismatch(record: R, token: string, reason: string, actor: Actor) {
    const view = this.store.view(record);
    if (view.state === "attention" && view.error === reason)
      return Promise.resolve(record);
    return this.store.update(
      record,
      token,
      { state: "attention", error: reason },
      actor,
      undefined,
      { eventType: this.event("signwell_mismatch"), detail: { reason } },
    );
  }
  /** The document, or null when SignWell answers 404 twice in a row. */
  private async fetch(providerId: string) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.signWell.get(providerId);
      } catch (error) {
        if (!notFound(error)) throw error;
        if (attempt > 0) return null;
      }
    }
  }

  /** Approves or rejects a request whose type requires approval. */
  decide(
    id: string,
    decision: SigningDecision,
    actor: Actor & { kind: "user" },
  ) {
    if (this.type.approval !== "two_person" || !this.store.decide)
      return Promise.reject(failure("APPROVAL_NOT_PENDING"));
    return this.store.decide(id, decision, actor);
  }

  async send(id: string, actor: Actor) {
    const { record, token } = await this.store.claim(id);
    let current = record;
    // The bound document as last read, so a mismatch found while sending is
    // named as apply() names it.
    let seen: SignWellSigningDocument | null = null;
    try {
      const view = this.store.view(current);
      if (terminal.includes(view.state)) throw failure("NOT_PENDING");
      // Checked before any SignWell call, and again by the database.
      if (this.type.approval === "two_person" && !view.approved)
        throw failure("APPROVAL_REQUIRED");
      if (!view.providerId) {
        current = await this.store.update(
          current,
          token,
          { state: "preparing", error: null },
          actor,
        );
        const pdf = await this.store.originalPdf(id);
        const doc = await this.signWell.createDraft(current, pdf);
        if (
          !["ready", "preparing"].includes(
            this.state(doc, this.store.view(current)),
          )
        )
          throw new Error("SIGNWELL_EXPECTED_UNSENT_DRAFT");
        current = await this.store.update(
          current,
          token,
          { providerId: doc.id, state: "ready" },
          actor,
        );
      }
      const bound = this.store.view(current);
      const providerId = bound.providerId;
      if (!providerId) throw failure("PROVIDER_ID_REQUIRED");
      let doc = (seen = await this.fetch(providerId));
      const expected = this.signing(bound).map((slot) => ({
        id: slot.id,
        fields: slot.fields(record),
      }));
      // A draft whose fields do not match yet may still be extracting them.
      const fieldsMatch = (draft: SignWellSigningDocument) => {
        try {
          assertSignWellFields(draft, expected);
          return true;
        } catch (error) {
          if (mismatchReason(error) === signWellFieldsMismatch) return false;
          throw error;
        }
      };
      // SignWell extracts text tags asynchronously after accepting a draft.
      // Keep the saved binding while allowing a bounded processing interval,
      // and hold a draft for its fields only once that interval has passed.
      // Each round renews the lease, so a slow provider cannot outlive it.
      for (
        let attempt = 0;
        doc &&
        attempt < 8 &&
        (this.state(doc, bound) === "preparing" ||
          (this.state(doc, bound) === "ready" && !fieldsMatch(doc)));
        attempt++
      ) {
        await this.wait(1500);
        await this.store.extendLease(id, token);
        doc = seen = await this.fetch(providerId);
      }
      await this.store.extendLease(id, token);
      if (!doc) {
        await this.gone(current, token, actor);
        throw failure("NEEDS_ATTENTION");
      }
      if (this.state(doc, bound) !== "ready") {
        // Only a request SignWell already has out for signature (a retry
        // after a lost response) reads as sent.
        const settled = await this.apply(current, token, doc, actor);
        const { state } = this.store.view(settled);
        if (state === "preparing") throw failure("STILL_PREPARING");
        if (state === "attention") throw failure("NEEDS_ATTENTION");
        if (!outForSignature.includes(state)) throw failure("NOT_PENDING");
        return settled;
      }
      assertSignWellFields(doc, expected);
      let note: SigningNote | undefined;
      if (this.type.copySender) {
        const copied = checkSignWellCopiedContacts(doc, bound.copiedContacts);
        if (copied === "unreported")
          this.warn("copied contacts not reported by SignWell", id, {
            providerId,
          });
        note = { detail: { copiedContacts: copied } };
      }
      const sending = await this.store.update(
        current,
        token,
        { state: "sending", error: null },
        actor,
        undefined,
        note,
      );
      await this.signWell.send(providerId, bound.testMode);
      // SignWell accepted the send. Failing to read it back is not a send
      // failure: the webhook or the reconcile task settles the state.
      try {
        const sent = await this.fetch(providerId);
        const stored = await this.store.get(id);
        if (!sent) {
          await this.gone(stored, token, actor);
          throw failure("NEEDS_ATTENTION");
        }
        return await this.apply(stored, token, sent, actor);
      } catch (error) {
        if (is(error, "NEEDS_ATTENTION")) throw error;
        this.warn("state not read after send", id, { error: message(error) });
        return sending;
      }
    } catch (error) {
      // Approval is a precondition, a deleted or mismatched document is
      // already recorded with its reason, and a draft still processing in
      // SignWell or a request nobody signs next has not failed.
      if (
        is(
          error,
          "APPROVAL_REQUIRED",
          "NEEDS_ATTENTION",
          "STILL_PREPARING",
          "NOT_PENDING",
        )
      )
        throw error;
      const found = this.store.view(current).providerId
        ? mismatchReason(error)
        : undefined;
      const reason = found && seen ? mismatchFor(seen, found) : found;
      // Never include provider response bodies, keys, or signing links in
      // errors. Recording the failure must not replace it, for example when
      // the lease was lost meanwhile.
      const recorded = await (
        reason
          ? this.mismatch(current, token, reason, actor)
          : this.store.update(
              current,
              token,
              { error: "provider_unavailable" },
              actor,
            )
      ).then(
        () => true,
        (unrecorded: unknown) => {
          this.warn("send failure not recorded", id, {
            error: message(unrecorded),
          });
          return false;
        },
      );
      if (reason && recorded) throw failure("NEEDS_ATTENTION");
      throw error;
    } finally {
      await this.store.release(id, token);
    }
  }

  /** Re-reads SignWell's state; called by staff, callbacks and the
   * scheduled check. */
  async sync(id: string, actor: Actor) {
    const { record, token } = await this.store.claim(id);
    try {
      const view = this.store.view(record);
      if (!view.providerId || terminal.includes(view.state)) return record;
      const doc = await this.fetch(view.providerId);
      if (!doc) return await this.gone(record, token, actor);
      return await this.apply(record, token, doc, actor);
    } finally {
      await this.store.release(id, token);
    }
  }

  /** Reminds whoever signs next, from SignWell's current state. */
  async remind(id: string, actor: Actor) {
    const { record, token } = await this.store.claim(id);
    try {
      const view = this.store.view(record);
      if (!view.providerId || terminal.includes(view.state))
        throw failure("NOT_PENDING");
      const doc = await this.fetch(view.providerId);
      if (!doc) {
        await this.gone(record, token, actor);
        throw failure("NOT_PENDING");
      }
      const current = await this.apply(record, token, doc, actor);
      const settled = this.store.view(current);
      // SignWell may show the request bounced, completed, declined or expired
      // since the list was loaded. The new state is stored and nobody is
      // reminded; a request needing attention says so, its row says why.
      if (mismatched(settled)) throw failure("NOT_PENDING");
      if (settled.state === "attention")
        throw failure("REMIND_NEEDS_ATTENTION");
      if (!waiting.includes(settled.state)) throw failure("NOT_PENDING");
      if (
        view.remindedAt &&
        Date.now() - Date.parse(view.remindedAt) < signingReminderCooldownMs
      )
        throw failure("REMINDER_TOO_SOON");
      await this.signWell.remind(view.providerId);
      // Once the first signer has signed, the next one is reminded.
      const next =
        this.signing(settled)[
          settled.state === "awaiting_countersignature" ? 1 : 0
        ];
      return await this.store.update(
        current,
        token,
        { error: null, remindedAt: new Date() },
        actor,
        undefined,
        {
          eventType: this.event("reminded"),
          detail: { recipient: next?.id },
        },
      );
    } finally {
      await this.store.release(id, token);
    }
  }

  /** Discards a draft that never reached SignWell. */
  async cancel(id: string, actor: Actor) {
    const { record, token } = await this.store.claim(id);
    try {
      const view = this.store.view(record);
      if (terminal.includes(view.state)) return record;
      if (view.providerId) throw failure("VOID_REQUIRED");
      return await this.store.update(
        record,
        token,
        {
          state: "canceled",
          error: null,
          ...(this.store.capabilities.has("cancel_code")
            ? { cancelCode: "discarded" as const }
            : {}),
        },
        actor,
      );
    } finally {
      await this.store.release(id, token);
    }
  }

  /**
   * Voids a request the first signer has not signed. The authoritative state
   * is read first, so a request signed in the meantime is refused and one
   * that completed keeps its executed PDF. SignWell's cancel deletes its
   * copy; the original PDF, the reason and the history stay in Commerce.
   */
  async void(id: string, actor: Actor, why: SigningVoidReason) {
    const { record, token } = await this.store.claim(id);
    try {
      const view = this.store.view(record);
      if (view.state === "completed") throw failure("ALREADY_COMPLETED");
      if (terminal.includes(view.state)) return record;
      if (!voidable.includes(view.state)) throw failure("NOT_VOIDABLE");
      let current = record;
      if (view.providerId) {
        const doc = await this.fetch(view.providerId);
        if (doc) {
          current = await this.apply(record, token, doc, actor);
          const settled = this.store.view(current);
          if (settled.state === "completed") throw failure("ALREADY_COMPLETED");
          if (terminal.includes(settled.state)) return current;
          if (!voidable.includes(settled.state)) throw failure("NOT_VOIDABLE");
          // The state may not show a signature: a mismatched copy is not
          // applied, and a bounce outranks the signature. Never delete a
          // document anyone signed.
          if (signedInSignWell(doc))
            throw failure(
              mismatched(settled) ? "SIGNED_IN_SIGNWELL" : "NOT_VOIDABLE",
            );
          await this.deleteInSignWell(current, token, actor);
        }
      }
      return await this.store.update(
        current,
        token,
        {
          state: "canceled",
          error: null,
          ...(!this.store.capabilities.has("cancel_code")
            ? {}
            : "code" in why
              ? { cancelCode: why.code }
              : { cancelCode: "voided" as const, cancelReason: why.reason }),
        },
        actor,
        undefined,
        {
          eventType: this.event("voided"),
          detail:
            "code" in why ? { cancelCode: why.code } : { reason: why.reason },
        },
      );
    } finally {
      await this.store.release(id, token);
    }
  }
  /** Deletes the bound document. When the outcome is unknown (timeout, 5xx),
   * a re-read decides: gone means the delete happened. */
  private async deleteInSignWell(record: R, token: string, actor: Actor) {
    const providerId = this.store.view(record).providerId;
    if (!providerId) return;
    try {
      await this.signWell.cancel(providerId);
    } catch (error) {
      if (notFound(error)) return;
      if (signWellRefused(error)) throw error;
      let doc: SignWellSigningDocument | null;
      try {
        doc = await this.fetch(providerId);
      } catch {
        throw error;
      }
      if (!doc) return;
      await this.apply(record, token, doc, actor);
      throw error;
    }
  }

  /**
   * Replaces the correctable signer's email (a bounce or a typo) while they
   * have not started signing. SignWell sends the request to the new address.
   * The signer's name stays: it may be printed in the agreement.
   */
  async correctSigner(id: string, actor: Actor, signerEmail: string) {
    const slot = this.correctable;
    const { record, token } = await this.store.claim(id);
    try {
      const view = this.store.view(record);
      const update = this.signWell.updateRecipient?.bind(this.signWell);
      if (
        !slot ||
        !update ||
        !view.providerId ||
        terminal.includes(view.state) ||
        !view.signers[slot.id]
      )
        throw failure("NOT_CORRECTABLE");
      if (
        Object.entries(view.signers).some(
          ([other, signer]) =>
            other !== slot.id && signer.email === signerEmail,
        )
      )
        throw failure("DISTINCT_SIGNERS_REQUIRED");
      const providerId = view.providerId;
      const doc = await this.fetch(providerId);
      if (!doc) {
        await this.gone(record, token, actor);
        throw failure("NOT_CORRECTABLE");
      }
      const current = await this.apply(record, token, doc, actor);
      const settled = this.store.view(current);
      const shown = doc.recipients.find((r) => r.id === slot.id);
      const email = (v: SigningView) => v.signers[slot.id]?.email;
      // A correction SignWell applied after its answer was lost, and after a
      // refresh dropped it, shows as other signers. When SignWell already has
      // exactly this email, record it; the next read still checks the rest.
      // Never once someone has signed: that row is an administrator's to
      // resolve in SignWell.
      if (
        settled.error === "signwell_signers_mismatch" &&
        shown?.email.toLowerCase() === signerEmail
      ) {
        const corrected = await this.store.update(
          current,
          token,
          { correctedSignerEmail: signerEmail, pendingSignerEmail: null },
          actor,
          undefined,
          {
            eventType: this.event("signer_corrected"),
            before: { signerEmail: email(settled) },
            detail: { signerEmail },
          },
        );
        return await this.apply(corrected, token, doc, actor);
      }
      if (mismatched(settled)) throw failure("NOT_CORRECTABLE");
      if (["signed", "completed"].includes(shown?.status ?? ""))
        throw failure("SIGNER_STARTED");
      if (!["sent", "viewed", "attention"].includes(settled.state))
        throw failure("NOT_CORRECTABLE");
      const previous = email(settled);
      if (signerEmail === previous) return current;
      // Recorded first, so whatever SignWell does the binding still matches
      // on the next refresh, which settles it.
      const pending = await this.store.update(
        current,
        token,
        { pendingSignerEmail: signerEmail, error: null },
        actor,
        undefined,
        {
          eventType: this.event("signer_correction_requested"),
          before: { signerEmail: previous },
          detail: { signerEmail },
        },
      );
      const confirm = (updated: SignWellSigningDocument) =>
        this.store
          .update(
            pending,
            token,
            { correctedSignerEmail: signerEmail, pendingSignerEmail: null },
            actor,
            undefined,
            {
              eventType: this.event("signer_corrected"),
              before: { signerEmail: previous },
              detail: { signerEmail },
            },
          )
          .then((corrected) => this.apply(corrected, token, updated, actor));
      let updated: SignWellSigningDocument;
      try {
        updated = await update(providerId, {
          id: slot.id,
          name: view.signers[slot.id]?.name ?? "",
          email: signerEmail,
        });
      } catch (error) {
        if (signWellRefused(error)) {
          await this.store.update(
            pending,
            token,
            { pendingSignerEmail: null },
            actor,
            undefined,
            {
              eventType: this.event("signer_correction_refused"),
              detail: { signerEmail, status: httpStatus(error) },
            },
          );
          if (httpStatus(error) === "422") throw failure("SIGNER_STARTED");
          if (httpStatus(error) === "409") throw failure("NOT_CORRECTABLE");
          throw error;
        }
        // The change may have been applied. Read back what SignWell shows; if
        // that read fails too, the pending email stays for the next refresh.
        let after: SignWellSigningDocument | null;
        try {
          after = await this.fetch(providerId);
        } catch {
          throw error;
        }
        if (!after) {
          await this.gone(pending, token, actor);
          throw error;
        }
        const now = after.recipients
          .find((r) => r.id === slot.id)
          ?.email.toLowerCase();
        if (now === signerEmail) return await confirm(after);
        await this.apply(pending, token, after, actor);
        throw error;
      }
      return await confirm(updated);
    } finally {
      await this.store.release(id, token);
    }
  }
}
