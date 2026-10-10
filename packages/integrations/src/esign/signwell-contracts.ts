import {
  contractSignerEmail,
  contractSigning,
  signatureFields,
  type ContractSigningRecord,
  type ContractSigningState,
} from "@clockwork/contracts";
import {
  SignWellSigningClient,
  assertSignWellFields,
  signWellSigningState,
  type SignWellSigningDocument,
} from "./signwell";

/**
 * Template contracts on the same SignWell client and document schema as
 * MNDAs. Their documents carry `commerce_contract_id` where an MNDA carries
 * `commerce_mnda_id`.
 */
export type SignWellContractDocument =
  SignWellSigningDocument<"commerce_contract_id">;

export class SignWellContractClient extends SignWellSigningClient<"commerce_contract_id"> {
  protected readonly bindingKey = "commerce_contract_id";

  /** An unsent draft: counterparty signs first, then the Fil One signer. */
  createContractDraft(record: ContractSigningRecord, pdf: Uint8Array) {
    return this.createSigningDraft(
      contractSigning,
      record,
      {
        id: record.contractId,
        templateHash: record.templateHash,
        testMode: record.testMode,
        recipients: [
          {
            id: "counterparty",
            name: record.counterpartySigner.name,
            email: contractSignerEmail(record),
          },
          {
            id: "fil-one",
            name: record.countersigner.name,
            email: record.countersigner.email,
          },
        ],
        copiedContacts: [],
      },
      pdf,
    );
  }

  getContract(id: string) {
    return this.get(id);
  }
}

/** The authoritative state of a bound document, after checking that it is
 * the document this contract created, for the same signers and mode. */
export function contractSignWellState(
  doc: SignWellContractDocument,
  record: ContractSigningRecord,
): ContractSigningState {
  return signWellSigningState(doc, {
    bindingKey: contractSigning.bindingKey,
    id: record.contractId,
    templateHash: record.templateHash,
    testMode: record.testMode,
    providerId: record.providerId,
    signers: [
      {
        id: "counterparty",
        emails: [
          record.counterpartySigner.email,
          record.correctedSignerEmail,
          record.pendingSignerEmail,
        ].filter((email): email is string => Boolean(email)),
      },
      { id: "fil-one", emails: [record.countersigner.email] },
    ],
  });
}

/** Exactly one required signature and signing date per recipient, in order. */
export function assertContractSigningFields(doc: SignWellContractDocument) {
  assertSignWellFields(
    doc,
    contractSigning.slots.map(({ id }) => ({ id, fields: signatureFields })),
  );
}
