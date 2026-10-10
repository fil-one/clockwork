import {
  contractDeletedInSignWell,
  contractPdfFileName,
  contractVoidableStates,
  terminalContractSigningStates,
  type Actor,
  type ContractSigningRecord,
  type ContractSigningState,
} from "@clockwork/contracts";
import type { ContractSigningRepository } from "@clockwork/db";
import {
  assertContractSigningFields,
  contractSignWellState,
  signWellRefused,
  type SignWellContractClient,
  type SignWellContractDocument,
} from "@clockwork/integrations";

/** The SignWell calls this workflow makes, typed from the concrete client so
 * tests can substitute a fake without a separate e-sign abstraction. */
export type ContractSigningClient = Pick<
  SignWellContractClient,
  | "createContractDraft"
  | "getContract"
  | "send"
  | "remind"
  | "cancel"
  | "completedPdf"
>;

/** Manual reminders are spaced so a double click cannot email twice. */
export const contractReminderCooldownMs = 60_000;
const notFound = (error: unknown) =>
  error instanceof Error && error.message === "SIGNWELL_HTTP_404";
/** SignWell's copy disagrees with the record. Nothing is applied from it; the
 * request waits in `attention` until a person voids it. */
const mismatchReasons: Readonly<Record<string, string>> = {
  SIGNWELL_SIGNERS_MISMATCH: "signwell_signers_mismatch",
  SIGNWELL_BINDING_MISMATCH: "signwell_binding_mismatch",
};
const mismatchReason = (error: unknown) =>
  error instanceof Error ? mismatchReasons[error.message] : undefined;
const mismatched = (record: ContractSigningRecord) =>
  record.state === "attention" &&
  Object.values(mismatchReasons).some((reason) => reason === record.error);
/** Whether SignWell's copy shows the counterparty's signature, whatever
 * state the workflow derives from it (a bounced countersigner reads as
 * `attention`, and a mismatched copy is never applied). */
const counterpartySigned = (doc: SignWellContractDocument) =>
  doc.status.toLowerCase() === "completed" ||
  ["signed", "completed"].includes(
    doc.recipients
      .find((r) => r.id === "counterparty")
      ?.status?.toLowerCase() ?? "",
  );
/** Already recorded on the request; the signing panel says what to do. */
const needsAttention = () => new Error("CONTRACT_NEEDS_ATTENTION");

type Repository = Pick<
  ContractSigningRepository,
  | "claim"
  | "extendLease"
  | "release"
  | "update"
  | "get"
  | "generatedPdf"
  | "decide"
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
    let state: ContractSigningState;
    try {
      state = contractSignWellState(doc, record);
    } catch (failure) {
      const reason = mismatchReason(failure);
      if (!reason) throw failure;
      return this.mismatch(record, token, reason, actor);
    }
    if (state === record.state && !record.error) return record;
    const executed =
      state === "completed"
        ? {
            bytes: await this.provider.completedPdf(doc.id),
            fileName: contractPdfFileName(record.documentName, " (executed)"),
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

  /**
   * SignWell no longer has the bound document. Signing cannot continue, but
   * the request is not closed automatically: a person voids it with a reason.
   */
  private gone(record: ContractSigningRecord, token: string, actor: Actor) {
    if (
      record.state === "attention" &&
      record.error === contractDeletedInSignWell
    )
      return Promise.resolve(record);
    return this.repo.update(
      record.contractId,
      token,
      { state: "attention", error: contractDeletedInSignWell },
      actor,
      undefined,
      { eventType: "contract.deleted_in_signwell" },
    );
  }

  /**
   * SignWell's copy names other signers or is not bound to this contract. The
   * request waits for a person and keeps its state otherwise: nothing from
   * the mismatched copy is applied.
   */
  private mismatch(
    record: ContractSigningRecord,
    token: string,
    reason: string,
    actor: Actor,
  ) {
    if (record.state === "attention" && record.error === reason)
      return Promise.resolve(record);
    return this.repo.update(
      record.contractId,
      token,
      { state: "attention", error: reason },
      actor,
      undefined,
      { eventType: "contract.signwell_mismatch", detail: { reason } },
    );
  }

  /** The document, or null when SignWell answers 404 twice in a row. */
  private async fetch(providerId: string) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.provider.getContract(providerId);
      } catch (error) {
        if (!notFound(error)) throw error;
        if (attempt > 0) return null;
      }
    }
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
      let doc = await this.fetch(current.providerId);
      // SignWell extracts text tags asynchronously after accepting a draft.
      // Each round renews the lease, so a slow provider cannot outlive it.
      for (
        let attempt = 0;
        doc &&
        contractSignWellState(doc, current) === "preparing" &&
        attempt < 8;
        attempt++
      ) {
        await this.wait(1500);
        await this.repo.extendLease(contractId, token);
        doc = await this.fetch(current.providerId);
      }
      await this.repo.extendLease(contractId, token);
      if (!doc) {
        await this.gone(current, token, actor);
        throw needsAttention();
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
      const sent = await this.fetch(current.providerId);
      current = await this.repo.get(contractId);
      if (!sent) {
        await this.gone(current, token, actor);
        throw needsAttention();
      }
      return await this.apply(current, token, sent, actor);
    } catch (error) {
      // Approval is a precondition, not a provider failure, and a deleted or
      // mismatched document is already recorded with its reason.
      if (
        error instanceof Error &&
        ["CONTRACT_APPROVAL_REQUIRED", "CONTRACT_NEEDS_ATTENTION"].includes(
          error.message,
        )
      )
        throw error;
      const reason = current.providerId ? mismatchReason(error) : undefined;
      // Never include provider response bodies, keys or signing links.
      const recorded = await (
        reason
          ? this.mismatch(current, token, reason, actor)
          : this.repo.update(
              contractId,
              token,
              { error: "provider_unavailable" },
              actor,
            )
      ).then(
        () => true,
        () => false,
      );
      if (reason && recorded) throw needsAttention();
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
      const doc = await this.fetch(record.providerId);
      if (!doc) return await this.gone(record, token, actor);
      return await this.apply(record, token, doc, actor);
    } finally {
      await this.repo.release(contractId, token);
    }
  }

  /** Reminds whoever signs next: the counterparty, then the Fil One
   * countersigner. */
  async remind(contractId: string, actor: Actor) {
    const { record, token } = await this.repo.claim(contractId);
    try {
      if (
        !record.providerId ||
        terminalContractSigningStates.includes(record.state)
      )
        throw new Error("CONTRACT_NOT_PENDING");
      const doc = await this.fetch(record.providerId);
      if (!doc) {
        await this.gone(record, token, actor);
        throw new Error("CONTRACT_NOT_PENDING");
      }
      const current = await this.apply(record, token, doc, actor);
      if (mismatched(current)) throw new Error("CONTRACT_NOT_PENDING");
      if (
        !["sent", "viewed", "awaiting_countersignature"].includes(current.state)
      )
        return current;
      if (
        record.remindedAt &&
        Date.now() - Date.parse(record.remindedAt) < contractReminderCooldownMs
      )
        throw new Error("CONTRACT_REMINDER_TOO_SOON");
      await this.provider.remind(record.providerId);
      return await this.repo.update(
        contractId,
        token,
        { error: null, remindedAt: new Date() },
        actor,
        undefined,
        {
          eventType: "contract.reminded",
          detail: {
            recipient:
              current.state === "awaiting_countersignature"
                ? "fil-one"
                : "counterparty",
          },
        },
      );
    } finally {
      await this.repo.release(contractId, token);
    }
  }

  /** Discards a preparation that never reached SignWell. Once a provider
   * document exists, the request is voided instead. */
  async cancel(contractId: string, actor: Actor) {
    const { record, token } = await this.repo.claim(contractId);
    try {
      if (terminalContractSigningStates.includes(record.state)) return record;
      if (record.providerId) throw new Error("CONTRACT_VOID_REQUIRED");
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

  /**
   * Voids a request the counterparty has not signed. The authoritative state
   * is read first, so a request the counterparty signed in the meantime is
   * refused and one that completed keeps its executed PDF. SignWell's cancel
   * deletes its copy; the prepared PDF, the reason and the history stay in
   * Commerce. A document already deleted in SignWell is simply closed.
   */
  async void(contractId: string, actor: Actor, reason: string) {
    const { record, token } = await this.repo.claim(contractId);
    try {
      if (record.state === "completed")
        throw new Error("CONTRACT_ALREADY_COMPLETED");
      if (terminalContractSigningStates.includes(record.state)) return record;
      if (!contractVoidableStates.includes(record.state))
        throw new Error("CONTRACT_NOT_VOIDABLE");
      if (record.providerId) {
        const doc = await this.fetch(record.providerId);
        if (doc) {
          const current = await this.apply(record, token, doc, actor);
          if (current.state === "completed")
            throw new Error("CONTRACT_ALREADY_COMPLETED");
          if (terminalContractSigningStates.includes(current.state))
            return current;
          if (!contractVoidableStates.includes(current.state))
            throw new Error("CONTRACT_NOT_VOIDABLE");
          // A bounced countersigner or a mismatched copy reads as
          // `attention`; SignWell's own copy says whether anyone signed.
          if (counterpartySigned(doc)) throw new Error("CONTRACT_NOT_VOIDABLE");
          await this.deleteInSignWell(current, token, actor);
        }
      }
      return await this.repo.update(
        contractId,
        token,
        { state: "canceled", error: null },
        actor,
        undefined,
        { eventType: "contract.voided", detail: { reason } },
      );
    } finally {
      await this.repo.release(contractId, token);
    }
  }

  /** Deletes the bound document. When the outcome is unknown (timeout, 5xx),
   * a re-read decides: gone means the delete happened. */
  private async deleteInSignWell(
    record: ContractSigningRecord,
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
      let doc: SignWellContractDocument | null;
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
}
