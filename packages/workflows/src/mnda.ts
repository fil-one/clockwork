import {
  mndaSignerEmail,
  mndaVoidableStates,
  type Actor,
  type MndaRecord,
} from "@clockwork/contracts";
import {
  type MndaRepository,
  type MndaUpdatePatch,
  terminalMndaStates,
} from "@clockwork/db";
import {
  assertSignWellCopiedContacts,
  assertSignWellSigningFields,
  signWellAttentionReason,
  signWellRefused,
  signWellState,
  type MndaSigningProvider,
  type SignWellDocument,
} from "@clockwork/integrations";

/** Manual reminders are spaced so a double click cannot email twice. */
export const mndaReminderCooldownMs = 60_000;
const notFound = (error: unknown) =>
  error instanceof Error && error.message === "SIGNWELL_HTTP_404";
const httpStatus = (error: unknown) =>
  error instanceof Error
    ? /^SIGNWELL_HTTP_(\d{3})$/.exec(error.message)?.[1]
    : undefined;

/** How a void is explained: a typed reason, or the signer-change code. */
export type MndaVoidReason = { reason: string } | { code: "signer_change" };

/** Provider documents are created as unsent drafts. The binding must commit
 * before sending; retries always read that same document's authoritative state. */
export class MndaWorkflow {
  constructor(
    private readonly repo: Pick<
      MndaRepository,
      "claim" | "release" | "update" | "get" | "readArtifact"
    >,
    private readonly provider: MndaSigningProvider,
  ) {}
  /**
   * Applies SignWell's state. A partner email change still pending is settled
   * here: kept when SignWell shows it, dropped otherwise.
   */
  private async apply(
    record: MndaRecord,
    token: string,
    doc: SignWellDocument,
    actor: Actor,
  ) {
    const state = signWellState(doc, record);
    const error = state === "attention" ? signWellAttentionReason(doc) : null;
    const patch: MndaUpdatePatch = {};
    if (record.pendingSignerEmail) {
      const partner = doc.recipients
        .find((r) => r.id === "counterparty")
        ?.email.toLowerCase();
      patch.pendingSignerEmail = null;
      if (partner === record.pendingSignerEmail)
        patch.correctedSignerEmail = partner;
    }
    if (
      state === record.state &&
      record.error === error &&
      !("pendingSignerEmail" in patch)
    )
      return record;
    const pdf =
      state === "completed"
        ? await this.provider.completedPdf(doc.id)
        : undefined;
    return this.repo.update(
      record.id,
      token,
      { ...patch, state, error },
      actor,
      pdf,
      "pendingSignerEmail" in patch && state === record.state
        ? {
            eventType: patch.correctedSignerEmail
              ? "mnda.signer_corrected"
              : "mnda.signer_correction_dropped",
            before: { signerEmail: mndaSignerEmail(record) },
            detail: { signerEmail: patch.correctedSignerEmail ?? null },
          }
        : undefined,
    );
  }
  /**
   * SignWell no longer has a bound document. Signing cannot continue, but the
   * request is not closed automatically: a person voids it with a reason.
   */
  private gone(record: MndaRecord, token: string, actor: Actor) {
    if (record.state === "attention" && record.error === "deleted_in_signwell")
      return Promise.resolve(record);
    return this.repo.update(
      record.id,
      token,
      { state: "attention", error: "deleted_in_signwell" },
      actor,
      undefined,
      { eventType: "mnda.deleted_in_signwell" },
    );
  }
  /** The document, or null when SignWell answers 404 twice in a row. */
  private async fetch(providerId: string) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.provider.get(providerId);
      } catch (error) {
        if (!notFound(error)) throw error;
        if (attempt > 0) return null;
      }
    }
  }
  async send(id: string, actor: Actor) {
    const { record, token } = await this.repo.claim(id);
    let current = record;
    try {
      if (terminalMndaStates.includes(current.state)) return current;
      if (!current.providerId) {
        current = await this.repo.update(
          id,
          token,
          { state: "preparing", error: null },
          actor,
        );
        const pdf = await this.repo.readArtifact(id, "original");
        const doc = await this.provider.createDraft(current, pdf);
        if (!["ready", "preparing"].includes(signWellState(doc, current)))
          throw new Error("SIGNWELL_EXPECTED_UNSENT_DRAFT");
        current = await this.repo.update(
          id,
          token,
          { providerId: doc.id, state: "ready" },
          actor,
        );
      }
      if (!current.providerId) throw new Error("MNDA_PROVIDER_ID_REQUIRED");
      let doc = await this.provider.get(current.providerId);
      // SignWell extracts text tags asynchronously after accepting a draft.
      // Keep the saved binding while allowing a bounded processing interval.
      for (
        let attempt = 0;
        signWellState(doc, current) === "preparing" && attempt < 8;
        attempt++
      ) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        doc = await this.provider.get(current.providerId);
      }
      if (signWellState(doc, current) !== "ready")
        return await this.apply(current, token, doc, actor);
      assertSignWellSigningFields(doc, record);
      assertSignWellCopiedContacts(doc, current);
      await this.repo.update(
        id,
        token,
        { state: "sending", error: null },
        actor,
      );
      await this.provider.send(current.providerId, current.testMode);
      return await this.apply(
        await this.repo.get(id),
        token,
        await this.provider.get(current.providerId),
        actor,
      );
    } catch (error) {
      // Never include provider response bodies, keys, or signing links in errors.
      await this.repo.update(
        id,
        token,
        { error: "provider_unavailable" },
        actor,
      );
      throw error;
    } finally {
      await this.repo.release(id, token);
    }
  }
  async sync(id: string, actor: Actor) {
    const { record, token } = await this.repo.claim(id);
    try {
      if (!record.providerId || terminalMndaStates.includes(record.state))
        return record;
      const doc = await this.fetch(record.providerId);
      if (!doc) return await this.gone(record, token, actor);
      return await this.apply(record, token, doc, actor);
    } finally {
      await this.repo.release(id, token);
    }
  }
  /** Reminds whoever signs next: the partner, then the Fil One countersigner. */
  async remind(id: string, actor: Actor) {
    const { record, token } = await this.repo.claim(id);
    try {
      if (!record.providerId || terminalMndaStates.includes(record.state))
        throw new Error("MNDA_NOT_PENDING");
      const doc = await this.fetch(record.providerId);
      if (!doc) {
        await this.gone(record, token, actor);
        throw new Error("MNDA_NOT_PENDING");
      }
      const current = await this.apply(record, token, doc, actor);
      if (
        !["sent", "viewed", "awaiting_countersignature"].includes(current.state)
      )
        return current;
      if (
        record.remindedAt &&
        Date.now() - Date.parse(record.remindedAt) < mndaReminderCooldownMs
      )
        throw new Error("MNDA_REMINDER_TOO_SOON");
      await this.provider.remind(record.providerId);
      return await this.repo.update(
        id,
        token,
        { error: null, remindedAt: new Date() },
        actor,
        undefined,
        {
          eventType: "mnda.reminded",
          detail: {
            recipient:
              current.state === "awaiting_countersignature"
                ? "fil-one"
                : "counterparty",
          },
        },
      );
    } finally {
      await this.repo.release(id, token);
    }
  }
  /** Discards a draft that never reached SignWell. */
  async cancel(id: string, actor: Actor) {
    const { record, token } = await this.repo.claim(id);
    try {
      if (terminalMndaStates.includes(record.state)) return record;
      if (record.providerId) throw new Error("MNDA_VOID_REQUIRED");
      return await this.repo.update(
        id,
        token,
        { state: "canceled", error: null, cancelCode: "discarded" },
        actor,
      );
    } finally {
      await this.repo.release(id, token);
    }
  }
  /**
   * Voids a request the partner has not signed. The authoritative state is
   * read first, so a request the partner signed in the meantime is refused
   * and one that completed keeps its executed PDF. SignWell's cancel deletes
   * its copy; the original PDF, the reason and the history stay in Commerce.
   */
  async void(id: string, actor: Actor, why: MndaVoidReason) {
    const { record, token } = await this.repo.claim(id);
    try {
      if (record.state === "completed")
        throw new Error("MNDA_ALREADY_COMPLETED");
      if (terminalMndaStates.includes(record.state)) return record;
      if (!mndaVoidableStates.includes(record.state))
        throw new Error("MNDA_NOT_VOIDABLE");
      let current = record;
      if (record.providerId) {
        const doc = await this.fetch(record.providerId);
        if (doc) {
          current = await this.apply(record, token, doc, actor);
          if (current.state === "completed")
            throw new Error("MNDA_ALREADY_COMPLETED");
          if (terminalMndaStates.includes(current.state)) return current;
          if (!mndaVoidableStates.includes(current.state))
            throw new Error("MNDA_NOT_VOIDABLE");
          await this.deleteInSignWell(current, token, actor);
        }
      }
      return await this.repo.update(
        id,
        token,
        {
          state: "canceled",
          error: null,
          ...("code" in why
            ? { cancelCode: why.code }
            : { cancelCode: "voided", cancelReason: why.reason }),
        },
        actor,
        undefined,
        {
          eventType: "mnda.voided",
          detail:
            "code" in why ? { cancelCode: why.code } : { reason: why.reason },
        },
      );
    } finally {
      await this.repo.release(id, token);
    }
  }
  /** Deletes the bound document. When the outcome is unknown (timeout, 5xx),
   * a re-read decides: gone means the delete happened. */
  private async deleteInSignWell(
    record: MndaRecord,
    token: string,
    actor: Actor,
  ) {
    const providerId = record.providerId;
    if (!providerId) return;
    try {
      await this.provider.cancel(providerId);
    } catch (error) {
      if (notFound(error)) return;
      if (signWellRefused(error)) throw error;
      let doc: SignWellDocument | null;
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
   * Replaces the partner signer's email (a bounce or a typo) on a request the
   * partner has not started signing. SignWell sends the request to the new
   * address. The signer's name stays: it may be printed in the agreement.
   */
  async correctSigner(id: string, actor: Actor, signerEmail: string) {
    const { record, token } = await this.repo.claim(id);
    try {
      if (!record.providerId || terminalMndaStates.includes(record.state))
        throw new Error("MNDA_NOT_CORRECTABLE");
      if (signerEmail === record.countersigner.email)
        throw new Error("MNDA_DISTINCT_SIGNERS_REQUIRED");
      const providerId = record.providerId;
      const doc = await this.fetch(providerId);
      if (!doc) {
        await this.gone(record, token, actor);
        throw new Error("MNDA_NOT_CORRECTABLE");
      }
      const current = await this.apply(record, token, doc, actor);
      const counterparty = doc.recipients.find((r) => r.id === "counterparty");
      if (["signed", "completed"].includes(counterparty?.status ?? ""))
        throw new Error("MNDA_SIGNER_STARTED");
      if (!["sent", "viewed", "attention"].includes(current.state))
        throw new Error("MNDA_NOT_CORRECTABLE");
      const previous = mndaSignerEmail(current);
      if (signerEmail === previous) return current;
      // Recorded first, so whatever SignWell does the binding still matches
      // on the next refresh, which settles it.
      const pending = await this.repo.update(
        id,
        token,
        { pendingSignerEmail: signerEmail, error: null },
        actor,
        undefined,
        {
          eventType: "mnda.signer_correction_requested",
          before: { signerEmail: previous },
          detail: { signerEmail },
        },
      );
      const confirm = (updated: SignWellDocument) =>
        this.repo
          .update(
            id,
            token,
            { correctedSignerEmail: signerEmail, pendingSignerEmail: null },
            actor,
            undefined,
            {
              eventType: "mnda.signer_corrected",
              before: { signerEmail: previous },
              detail: { signerEmail },
            },
          )
          .then((corrected) => this.apply(corrected, token, updated, actor));
      let updated: SignWellDocument;
      try {
        updated = await this.provider.updateRecipient(providerId, {
          id: "counterparty",
          name: record.input.signerName,
          email: signerEmail,
        });
      } catch (error) {
        if (signWellRefused(error)) {
          await this.repo.update(
            id,
            token,
            { pendingSignerEmail: null },
            actor,
            undefined,
            {
              eventType: "mnda.signer_correction_refused",
              detail: { signerEmail, status: httpStatus(error) },
            },
          );
          if (httpStatus(error) === "422")
            throw new Error("MNDA_SIGNER_STARTED");
          if (httpStatus(error) === "409")
            throw new Error("MNDA_NOT_CORRECTABLE");
          throw error;
        }
        // The change may have been applied. Read back what SignWell shows; if
        // that read fails too, the pending email stays for the next refresh.
        let after: SignWellDocument | null;
        try {
          after = await this.fetch(providerId);
        } catch {
          throw error;
        }
        if (!after) {
          await this.gone(pending, token, actor);
          throw error;
        }
        const partner = after.recipients
          .find((r) => r.id === "counterparty")
          ?.email.toLowerCase();
        if (partner === signerEmail) return await confirm(after);
        await this.apply(pending, token, after, actor);
        throw error;
      }
      return await confirm(updated);
    } finally {
      await this.repo.release(id, token);
    }
  }
}
