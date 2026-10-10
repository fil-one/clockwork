import {
  contractSigning,
  type Actor,
  type ContractSigningRecord,
} from "@clockwork/contracts";
import type { SignWellContractClient } from "@clockwork/integrations";
import {
  SigningEngine,
  signingErrors,
  signingReminderCooldownMs,
  type SigningDecision,
} from "./signing/engine";
import {
  contractSigningStore,
  type ContractSigningStoreRepository,
} from "./signing/stores";

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
export const contractReminderCooldownMs = signingReminderCooldownMs;

// The contract signing panel has no message of its own for these.
const named = signingErrors(contractSigning, {
  SIGNED_IN_SIGNWELL: "CONTRACT_NOT_VOIDABLE",
  REMIND_NEEDS_ATTENTION: "CONTRACT_NEEDS_ATTENTION",
});

/**
 * Prepare, approve, send and archive for template contracts: the shared
 * signing engine (ADR 0012) over the contract signing repository, with
 * `CONTRACT_*` error codes. Approval is checked before any provider call and
 * again by the database.
 */
export class ContractSigningWorkflow {
  private readonly engine: SigningEngine<ContractSigningRecord>;
  constructor(
    repo: ContractSigningStoreRepository,
    provider: ContractSigningClient,
    wait?: (ms: number) => Promise<void>,
  ) {
    this.engine = new SigningEngine(
      contractSigning,
      contractSigningStore(repo),
      {
        createDraft: (record, pdf) => provider.createContractDraft(record, pdf),
        get: (id) => provider.getContract(id),
        send: (id, testMode) => provider.send(id, testMode),
        remind: (id) => provider.remind(id),
        cancel: (id) => provider.cancel(id),
        completedPdf: (id) => provider.completedPdf(id),
      },
      wait,
    );
  }

  /** Approves or rejects a pending request; the preparer cannot decide. */
  decide(
    contractId: string,
    decision: SigningDecision,
    actor: Actor & { kind: "user" },
  ) {
    return this.engine.decide(contractId, decision, actor).catch(named);
  }
  send(contractId: string, actor: Actor) {
    return this.engine.send(contractId, actor).catch(named);
  }
  /** Re-reads the provider's state; called by staff and by webhooks. */
  sync(contractId: string, actor: Actor) {
    return this.engine.sync(contractId, actor).catch(named);
  }
  /** Reminds whoever signs next: the counterparty, then the Fil One
   * countersigner. */
  remind(contractId: string, actor: Actor) {
    return this.engine.remind(contractId, actor).catch(named);
  }
  /** Discards a preparation that never reached SignWell. Once a provider
   * document exists, the request is voided instead. */
  cancel(contractId: string, actor: Actor) {
    return this.engine.cancel(contractId, actor).catch(named);
  }
  /** Voids a request the counterparty has not signed, with a typed reason
   * kept in the contract's history. */
  void(contractId: string, actor: Actor, reason: string) {
    return this.engine.void(contractId, actor, { reason }).catch(named);
  }
}
