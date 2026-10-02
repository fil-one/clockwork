import type { Actor, MndaRecord } from "@clockwork/contracts";
import { type MndaRepository, terminalMndaStates } from "@clockwork/db";
import {
  signWellState,
  assertSignWellSigningFields,
  type MndaSigningProvider,
  type SignWellDocument,
} from "@clockwork/integrations";

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
    if (state === record.state && !record.error) return record;
    const pdf =
      state === "completed"
        ? await this.provider.completedPdf(doc.id)
        : undefined;
    return this.repo.update(
      record.id,
      token,
      { state, error: null },
      actor,
      pdf,
    );
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
      assertSignWellSigningFields(doc);
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
      return await this.apply(
        record,
        token,
        await this.provider.get(record.providerId),
        actor,
      );
    } finally {
      await this.repo.release(id, token);
    }
  }
  async remind(id: string, actor: Actor) {
    const { record, token } = await this.repo.claim(id);
    try {
      if (!record.providerId || terminalMndaStates.includes(record.state))
        throw new Error("MNDA_NOT_PENDING");
      const current = await this.apply(
        record,
        token,
        await this.provider.get(record.providerId),
        actor,
      );
      if (
        !["sent", "viewed", "awaiting_countersignature"].includes(current.state)
      )
        return current;
      if (Date.now() - Date.parse(record.updatedAt) < 60_000)
        throw new Error("MNDA_REMINDER_TOO_SOON");
      await this.provider.remind(record.providerId);
      return await this.repo.update(id, token, { error: null }, actor);
    } finally {
      await this.repo.release(id, token);
    }
  }
  async cancel(id: string, actor: Actor) {
    const { record, token } = await this.repo.claim(id);
    try {
      if (terminalMndaStates.includes(record.state)) return record;
      // SignWell's API deletes the document when canceling. Do not race a
      // signer's completion and delete evidence; only discard local drafts.
      if (record.providerId) throw new Error("MNDA_CANCEL_IN_SIGNWELL");
      return await this.repo.update(
        id,
        token,
        { state: "canceled", error: null },
        actor,
      );
    } finally {
      await this.repo.release(id, token);
    }
  }
}
