import {
  contractSigning,
  counterpartyPaperSigning,
  type Actor,
  type ContractSigningDocumentType,
  type ContractSigningRecord,
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
    private readonly provider: ContractSigningClient,
    private readonly wait?: (ms: number) => Promise<void>,
  ) {
    this.engines = {
      contract_template: this.build("contract_template", repo),
      counterparty_paper: this.build("counterparty_paper", repo),
    };
  }

  private build(
    documentType: ContractSigningDocumentType,
    repo: ContractSigningStoreRepository,
  ) {
    const provider = this.provider;
    return new SigningEngine(
      documentType === "contract_template"
        ? contractSigning
        : counterpartyPaperSigning,
      contractSigningStore(repo),
      {
        createDraft: (record, pdf) =>
          documentType === "contract_template"
            ? provider.createContractDraft(record, pdf)
            : provider.createCounterpartyPaperDraft(record, pdf),
        get: (id) => provider.getContract(id),
        send: (id, testMode) => provider.send(id, testMode),
        remind: (id) => provider.remind(id),
        cancel: (id) => provider.cancel(id),
        updateRecipient: (id, recipient) =>
          provider.updateRecipient(id, recipient),
        completedPdf: (id) => provider.completedPdf(id),
      },
      this.wait,
    );
  }

  /**
   * The engine for the request's document type. With `expectedRequest`, the
   * engine's lease is taken only on that request, so an action someone took
   * on a request since replaced is refused instead of applied to the next.
   */
  private async engine(contractId: string, expectedRequest?: number) {
    const { documentType } = await this.repo.get(contractId);
    if (expectedRequest === undefined) return this.engines[documentType];
    const repo = this.repo;
    return this.build(documentType, {
      claim: (id) => repo.claim(id, expectedRequest),
      extendLease: (id, token) => repo.extendLease(id, token),
      release: (id, token) => repo.release(id, token),
      update: (...change) => repo.update(...change),
      get: (id) => repo.get(id),
      generatedPdf: (id) => repo.generatedPdf(id),
      decide: (...decision) => repo.decide(...decision),
    });
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
  send(contractId: string, actor: Actor, expectedRequest?: number) {
    return this.engine(contractId, expectedRequest)
      .then((engine) => engine.send(contractId, actor))
      .catch(named);
  }
  /** Re-reads the provider's state; called by staff and by webhooks. */
  sync(contractId: string, actor: Actor, expectedRequest?: number) {
    return this.engine(contractId, expectedRequest)
      .then((engine) => engine.sync(contractId, actor))
      .catch(named);
  }
  /** Reminds whoever signs next: the counterparty, then the Fil One
   * countersigner. */
  remind(contractId: string, actor: Actor, expectedRequest?: number) {
    return this.engine(contractId, expectedRequest)
      .then((engine) => engine.remind(contractId, actor))
      .catch(named);
  }
  /** Discards a preparation that never reached SignWell. Once a provider
   * document exists, the request is voided instead. */
  cancel(contractId: string, actor: Actor, expectedRequest?: number) {
    return this.engine(contractId, expectedRequest)
      .then((engine) => engine.cancel(contractId, actor))
      .catch(named);
  }
  /** Voids a request nobody has signed yet, with a typed reason or the
   * signer-change code, kept on the request and in its history. */
  void(
    contractId: string,
    actor: Actor,
    why: SigningVoidReason,
    expectedRequest?: number,
  ) {
    return this.engine(contractId, expectedRequest)
      .then((engine) => engine.void(contractId, actor, why))
      .catch(named);
  }
  /** Replaces the counterparty signer's email (a bounce or a typo) on a
   * request they have not started signing. */
  correctSigner(
    contractId: string,
    actor: Actor,
    signerEmail: string,
    expectedRequest?: number,
  ) {
    return this.engine(contractId, expectedRequest)
      .then((engine) => engine.correctSigner(contractId, actor, signerEmail))
      .catch(named);
  }
}
