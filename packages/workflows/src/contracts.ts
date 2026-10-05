import {
  terminalContractSigningStates,
  type Actor,
  type ContractSigningRecord,
} from "@clockwork/contracts";
import type { ContractSigningRepository } from "@clockwork/db";
import {
  assertContractSigningFields,
  contractSignWellState,
  type SignWellContractClient,
  type SignWellContractDocument,
} from "@clockwork/integrations";

/** The SignWell calls this workflow makes, typed from the concrete client so
 * tests can substitute a fake without a separate e-sign abstraction. */
export type ContractSigningClient = Pick<
  SignWellContractClient,
  "createContractDraft" | "getContract" | "send" | "remind" | "completedPdf"
>;

type Repository = Pick<
  ContractSigningRepository,
  "claim" | "release" | "update" | "get" | "generatedPdf" | "decide"
>;

/**
 * Prepare, approve, send and archive for template contracts. The rules are
 * the MNDA workflow's (ADR 0011): the provider document is created as an
 * unsent draft and bound before anything is sent, a retry reads that same
 * document, callbacks only trigger a fresh read, and completion stores the
 * executed PDF with the state change. Approval, when a template requires it,
 * is checked here before any provider call and again by the database.
 */
export class ContractSigningWorkflow {
  constructor(
    private readonly repo: Repository,
    private readonly provider: ContractSigningClient,
    private readonly wait: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  private async apply(
    record: ContractSigningRecord,
    token: string,
    doc: SignWellContractDocument,
    actor: Actor,
  ) {
    const state = contractSignWellState(doc, record);
    if (state === record.state && !record.error) return record;
    const executed =
      state === "completed"
        ? {
            bytes: await this.provider.completedPdf(doc.id),
            fileName: `${record.documentName} (executed).pdf`,
          }
        : undefined;
    return this.repo.update(
      record.contractId,
      token,
      { state, error: null },
      actor,
      executed,
    );
  }

  /** Approves or rejects a pending request; the preparer cannot decide. */
  decide(
    contractId: string,
    decision: { approve: true } | { approve: false; reason: string },
    actor: Actor & { kind: "user" },
  ) {
    return this.repo.decide(contractId, decision, actor);
  }

  async send(contractId: string, actor: Actor) {
    const { record, token } = await this.repo.claim(contractId);
    let current = record;
    try {
      if (terminalContractSigningStates.includes(current.state)) return current;
      if (!["not_required", "approved"].includes(current.approvalState))
        throw new Error("CONTRACT_APPROVAL_REQUIRED");
      if (!current.providerId) {
        current = await this.repo.update(
          contractId,
          token,
          { state: "preparing", error: null },
          actor,
        );
        const pdf = await this.repo.generatedPdf(contractId);
        const doc = await this.provider.createContractDraft(current, pdf);
        if (
          !["ready", "preparing"].includes(contractSignWellState(doc, current))
        )
          throw new Error("SIGNWELL_EXPECTED_UNSENT_DRAFT");
        current = await this.repo.update(
          contractId,
          token,
          { providerId: doc.id, state: "ready" },
          actor,
        );
      }
      if (!current.providerId) throw new Error("CONTRACT_PROVIDER_ID_REQUIRED");
      let doc = await this.provider.getContract(current.providerId);
      // SignWell extracts text tags asynchronously after accepting a draft.
      for (
        let attempt = 0;
        contractSignWellState(doc, current) === "preparing" && attempt < 8;
        attempt++
      ) {
        await this.wait(1500);
        doc = await this.provider.getContract(current.providerId);
      }
      if (contractSignWellState(doc, current) !== "ready")
        return await this.apply(current, token, doc, actor);
      assertContractSigningFields(doc);
      await this.repo.update(
        contractId,
        token,
        { state: "sending", error: null },
        actor,
      );
      await this.provider.send(current.providerId, current.testMode);
      return await this.apply(
        await this.repo.get(contractId),
        token,
        await this.provider.getContract(current.providerId),
        actor,
      );
    } catch (error) {
      // Approval is a precondition, not a provider failure.
      if (!(
        error instanceof Error && error.message === "CONTRACT_APPROVAL_REQUIRED"
      ))
        // Never include provider response bodies, keys or signing links.
        await this.repo
          .update(contractId, token, { error: "provider_unavailable" }, actor)
          .catch(() => {});
      throw error;
    } finally {
      await this.repo.release(contractId, token);
    }
  }

  /** Re-reads the provider's state; called by staff and by webhooks. */
  async sync(contractId: string, actor: Actor) {
    const { record, token } = await this.repo.claim(contractId);
    try {
      if (
        !record.providerId ||
        terminalContractSigningStates.includes(record.state)
      )
        return record;
      return await this.apply(
        record,
        token,
        await this.provider.getContract(record.providerId),
        actor,
      );
    } finally {
      await this.repo.release(contractId, token);
    }
  }

  async remind(contractId: string, actor: Actor) {
    const { record, token } = await this.repo.claim(contractId);
    try {
      if (
        !record.providerId ||
        terminalContractSigningStates.includes(record.state)
      )
        throw new Error("CONTRACT_NOT_PENDING");
      const current = await this.apply(
        record,
        token,
        await this.provider.getContract(record.providerId),
        actor,
      );
      if (
        !["sent", "viewed", "awaiting_countersignature"].includes(current.state)
      )
        return current;
      if (Date.now() - Date.parse(record.updatedAt) < 60_000)
        throw new Error("CONTRACT_REMINDER_TOO_SOON");
      await this.provider.remind(record.providerId);
      return await this.repo.update(contractId, token, { error: null }, actor);
    } finally {
      await this.repo.release(contractId, token);
    }
  }

  /** Discards a preparation that was never sent. SignWell's cancel deletes
   * the document, so a sent request is voided in SignWell, not here. */
  async cancel(contractId: string, actor: Actor) {
    const { record, token } = await this.repo.claim(contractId);
    try {
      if (terminalContractSigningStates.includes(record.state)) return record;
      if (record.providerId) throw new Error("CONTRACT_CANCEL_IN_SIGNWELL");
      return await this.repo.update(
        contractId,
        token,
        { state: "canceled", error: null },
        actor,
      );
    } finally {
      await this.repo.release(contractId, token);
    }
  }
}
