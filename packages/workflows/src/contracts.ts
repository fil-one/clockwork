import {
  contractSigning,
  counterpartyPaperSigning,
  type Actor,
  type ContractSigningDocumentType,
  type ContractSigningRecord,
  type SigningDocumentType,
} from "@clockwork/contracts";
import type { SignWellContractClient } from "@clockwork/integrations";
import {
  SigningEngine,
  signingErrors,
  type SigningDecision,
  type SigningVoidReason,
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
  | "createCounterpartyPaperDraft"
  | "getContract"
  | "send"
  | "remind"
  | "cancel"
  | "updateRecipient"
  | "completedPdf"
>;

// The contract signing panel has no message of its own for these.
const named = signingErrors(contractSigning, {
  SIGNED_IN_SIGNWELL: "CONTRACT_NOT_VOIDABLE",
  REMIND_NEEDS_ATTENTION: "CONTRACT_NEEDS_ATTENTION",
});

/**
 * Prepare, approve, send and archive for contracts signed through SignWell:
 * the shared signing engine (ADR 0012) over the contract signing repository,
 * with `CONTRACT_*` error codes. Template contracts and counterparty paper
 * share the table and store; each request runs on its own type's
 * declaration. Approval is checked before any provider call and again by
 * the database.
 */
export class ContractSigningWorkflow {
  private readonly engines: Readonly<
    Record<ContractSigningDocumentType, SigningEngine<ContractSigningRecord>>
  >;
  constructor(
    private readonly repo: ContractSigningStoreRepository,
    provider: ContractSigningClient,
    wait?: (ms: number) => Promise<void>,
  ) {
    const engine = (
      type: SigningDocumentType<ContractSigningRecord>,
      createDraft: (
        record: ContractSigningRecord,
        pdf: Uint8Array,
      ) => ReturnType<ContractSigningClient["createContractDraft"]>,
    ) =>
      new SigningEngine(
        type,
        contractSigningStore(repo),
        {
          createDraft,
          get: (id) => provider.getContract(id),
          send: (id, testMode) => provider.send(id, testMode),
          remind: (id) => provider.remind(id),
          cancel: (id) => provider.cancel(id),
          updateRecipient: (id, recipient) =>
            provider.updateRecipient(id, recipient),
          completedPdf: (id) => provider.completedPdf(id),
        },
        wait,
      );
    this.engines = {
      contract_template: engine(contractSigning, (record, pdf) =>
        provider.createContractDraft(record, pdf),
      ),
      counterparty_paper: engine(counterpartyPaperSigning, (record, pdf) =>
        provider.createCounterpartyPaperDraft(record, pdf),
      ),
    };
  }

  /** The engine for the request's document type. */
  private async engine(contractId: string) {
    return this.engines[(await this.repo.get(contractId)).documentType];
  }

  /** Approves or rejects a pending request; the preparer cannot decide. */
  decide(
    contractId: string,
    decision: SigningDecision,
    actor: Actor & { kind: "user" },
  ) {
    return this.engine(contractId)
      .then((engine) => engine.decide(contractId, decision, actor))
      .catch(named);
  }
  send(contractId: string, actor: Actor) {
    return this.engine(contractId)
      .then((engine) => engine.send(contractId, actor))
      .catch(named);
  }
  /** Re-reads the provider's state; called by staff and by webhooks. */
  sync(contractId: string, actor: Actor) {
    return this.engine(contractId)
      .then((engine) => engine.sync(contractId, actor))
      .catch(named);
  }
  /** Reminds whoever signs next: the counterparty, then the Fil One
   * countersigner. */
  remind(contractId: string, actor: Actor) {
    return this.engine(contractId)
      .then((engine) => engine.remind(contractId, actor))
      .catch(named);
  }
  /** Discards a preparation that never reached SignWell. Once a provider
   * document exists, the request is voided instead. */
  cancel(contractId: string, actor: Actor) {
    return this.engine(contractId)
      .then((engine) => engine.cancel(contractId, actor))
      .catch(named);
  }
  /** Voids a request nobody has signed yet, with a typed reason or the
   * signer-change code, kept on the request and in its history. */
  void(contractId: string, actor: Actor, why: SigningVoidReason) {
    return this.engine(contractId)
      .then((engine) => engine.void(contractId, actor, why))
      .catch(named);
  }
  /** Replaces the counterparty signer's email (a bounce or a typo) on a
   * request they have not started signing. */
  correctSigner(contractId: string, actor: Actor, signerEmail: string) {
    return this.engine(contractId)
      .then((engine) => engine.correctSigner(contractId, actor, signerEmail))
      .catch(named);
  }
}
