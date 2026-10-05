import {
  mndaSignerEmail,
  type Actor,
  type MndaRecord,
} from "@clockwork/contracts";
import { type MndaRepository, terminalMndaStates } from "@clockwork/db";
import {
  signWellAttentionReason,
  signWellState,
  assertSignWellSigningFields,
  type MndaSigningProvider,
  type SignWellDocument,
} from "@clockwork/integrations";

/** Manual reminders are spaced so a double click cannot email twice. */
export const mndaReminderCooldownMs = 60_000;
const notFound = (error: unknown) =>
  error instanceof Error && error.message === "SIGNWELL_HTTP_404";

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
  private async apply(
    record: MndaRecord,
    token: string,
    doc: SignWellDocument,
    actor: Actor,
  ) {
    const state = signWellState(doc, record);
    const error = state === "attention" ? signWellAttentionReason(doc) : null;
    if (state === record.state && record.error === error) return record;
    const pdf =
      state === "completed"
        ? await this.provider.completedPdf(doc.id)
        : undefined;
    return this.repo.update(record.id, token, { state, error }, actor, pdf);
  }
  /** A bound document that SignWell no longer has cannot be signed. */
  private gone(record: MndaRecord, token: string, actor: Actor) {
    return this.repo.update(
      record.id,
      token,
      { state: "canceled", error: "deleted_in_signwell" },
      actor,
      undefined,
      { eventType: "mnda.deleted_in_signwell" },
    );
  }
  private async fetch(providerId: string) {
    try {
      return await this.provider.get(providerId);
    } catch (error) {
      if (notFound(error)) return null;
      throw error;
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
      if (!doc) return await this.gone(record, token, actor);
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
        { state: "canceled", error: null, cancelReason: "discarded" },
        actor,
      );
    } finally {
      await this.repo.release(id, token);
    }
  }
  /**
   * Voids a request in SignWell. The authoritative state is read first, so a
   * request that completed in the meantime is kept, with its executed PDF,
   * rather than deleted. SignWell's cancel deletes its copy of the document;
   * the original PDF and the audit trail stay in Commerce.
   */
  async void(id: string, actor: Actor, reason: string) {
    const { record, token } = await this.repo.claim(id);
    try {
      if (terminalMndaStates.includes(record.state)) {
        if (record.state === "completed")
          throw new Error("MNDA_ALREADY_COMPLETED");
        return record;
      }
      const voided = {
        eventType: "mnda.voided",
        detail: { reason },
      };
      if (record.providerId) {
        const doc = await this.fetch(record.providerId);
        if (doc) {
          const current = await this.apply(record, token, doc, actor);
          if (current.state === "completed")
            throw new Error("MNDA_ALREADY_COMPLETED");
          if (terminalMndaStates.includes(current.state)) return current;
          try {
            await this.provider.cancel(record.providerId);
          } catch (error) {
            if (!notFound(error)) throw error;
          }
        }
      }
      return await this.repo.update(
        id,
        token,
        { state: "canceled", error: null, cancelReason: reason },
        actor,
        undefined,
        voided,
      );
    } finally {
      await this.repo.release(id, token);
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
      const doc = await this.fetch(record.providerId);
      if (!doc) return await this.gone(record, token, actor);
      const current = await this.apply(record, token, doc, actor);
      const counterparty = doc.recipients.find((r) => r.id === "counterparty");
      if (["signed", "completed"].includes(counterparty?.status ?? ""))
        throw new Error("MNDA_SIGNER_STARTED");
      if (!["sent", "viewed", "attention"].includes(current.state))
        throw new Error("MNDA_NOT_CORRECTABLE");
      const previous = mndaSignerEmail(current);
      if (signerEmail === previous) return current;
      // Record the intended address first: a lost provider response then
      // still matches on the next refresh. Restore it if SignWell refuses.
      const pending = await this.repo.update(
        id,
        token,
        { correctedSignerEmail: signerEmail, error: null },
        actor,
        undefined,
        {
          eventType: "mnda.signer_corrected",
          before: { signerEmail: previous },
          detail: { signerEmail },
        },
      );
      let updated: SignWellDocument;
      try {
        updated = await this.provider.updateRecipient(record.providerId, {
          id: "counterparty",
          name: record.input.signerName,
          email: signerEmail,
        });
      } catch (error) {
        await this.repo.update(
          id,
          token,
          { correctedSignerEmail: previous },
          actor,
          undefined,
          {
            eventType: "mnda.signer_correction_failed",
            detail: { signerEmail: previous },
          },
        );
        if (error instanceof Error && error.message === "SIGNWELL_HTTP_422")
          throw new Error("MNDA_SIGNER_STARTED");
        if (error instanceof Error && error.message === "SIGNWELL_HTTP_409")
          throw new Error("MNDA_NOT_CORRECTABLE");
        throw error;
      }
      return await this.apply(pending, token, updated, actor);
    } finally {
      await this.repo.release(id, token);
    }
  }
}
