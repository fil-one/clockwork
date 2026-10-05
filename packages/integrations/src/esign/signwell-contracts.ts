import { z } from "zod";
import type {
  ContractSigningRecord,
  ContractSigningState,
} from "@clockwork/contracts";
import { SignWellClient } from "./signwell";

/**
 * Template contracts on the same SignWell client the MNDA workflow uses: one
 * HTTP transport, timeout, response cap and webhook verifier. Only the
 * document shape differs, because these documents carry
 * `commerce_contract_id` where an MNDA carries `commerce_mnda_id`.
 */
const contractDocumentSchema = z.object({
  id: z.uuid(),
  status: z.string(),
  test_mode: z.boolean(),
  metadata: z.object({
    commerce_contract_id: z.uuid(),
    template_sha256: z.string(),
  }),
  recipients: z.array(
    z.object({
      id: z.string(),
      email: z.email(),
      name: z.string(),
      status: z.string().nullable().optional(),
      bounced: z.boolean().nullable().optional(),
    }),
  ),
  fields: z.array(
    z.array(
      z.object({
        recipient_id: z.string(),
        type: z.string(),
        required: z.boolean(),
        api_id: z.string().nullable().optional(),
      }),
    ),
  ),
  apply_signing_order: z.boolean(),
});
export type SignWellContractDocument = z.infer<typeof contractDocumentSchema>;

export class SignWellContractClient extends SignWellClient {
  private async contractDocument(path: string, method = "GET", body?: unknown) {
    return contractDocumentSchema.parse(
      JSON.parse(
        Buffer.from(await this.request(path, method, body)).toString("utf8"),
      ),
    );
  }

  /** An unsent draft: counterparty signs first, then the Fil One signer. */
  createContractDraft(record: ContractSigningRecord, pdf: Uint8Array) {
    return this.contractDocument("documents", "POST", {
      draft: true,
      test_mode: record.testMode,
      name: record.documentName,
      files: [
        {
          name: "Fil-One-Agreement.pdf",
          file_base64: Buffer.from(pdf).toString("base64"),
        },
      ],
      recipients: [
        {
          id: "counterparty",
          name: record.counterpartySigner.name,
          email: record.counterpartySigner.email,
        },
        {
          id: "fil-one",
          name: record.countersigner.name,
          email: record.countersigner.email,
        },
      ],
      apply_signing_order: true,
      text_tags: true,
      reminders: true,
      expires_in: 30,
      embedded_signing: false,
      allow_reassign: false,
      subject: record.documentName,
      message:
        "Please review and sign the attached agreement. Fil One will countersign and you will receive the completed agreement.",
      metadata: {
        commerce_contract_id: record.contractId,
        template_sha256: record.templateHash,
      },
    });
  }

  getContract(id: string) {
    return this.contractDocument(`documents/${z.uuid().parse(id)}`);
  }
}

/** The authoritative state of a bound document, after checking that it is
 * the document this contract created, for the same signers and mode. */
export function contractSignWellState(
  doc: SignWellContractDocument,
  record: ContractSigningRecord,
): ContractSigningState {
  if (
    doc.metadata.commerce_contract_id !== record.contractId ||
    doc.metadata.template_sha256 !== record.templateHash ||
    doc.test_mode !== record.testMode ||
    (record.providerId && doc.id !== record.providerId)
  )
    throw new Error("SIGNWELL_BINDING_MISMATCH");
  const email = (id: string) =>
    doc.recipients.find((r) => r.id === id)?.email.toLowerCase();
  if (
    doc.recipients.length !== 2 ||
    email("counterparty") !== record.counterpartySigner.email.toLowerCase() ||
    email("fil-one") !== record.countersigner.email.toLowerCase()
  )
    throw new Error("SIGNWELL_SIGNERS_MISMATCH");
  const status = doc.status.toLowerCase();
  if (status === "completed") return "completed";
  if (status === "declined" || status === "expired" || status === "canceled")
    return status;
  if (doc.recipients.some((r) => r.bounced)) return "attention";
  if (status === "created") return "preparing";
  if (status === "draft") return "ready";
  if (status === "sending") return "sending";
  if (!["sent", "pending", "viewed"].includes(status)) return "attention";
  const counterparty = doc.recipients.find((r) => r.id === "counterparty");
  if (
    ["signed", "completed"].includes(counterparty?.status?.toLowerCase() ?? "")
  )
    return "awaiting_countersignature";
  if (status === "viewed" || status === "pending") return "viewed";
  return "sent";
}

/** Exactly one required signature and signing date per recipient, in order. */
export function assertContractSigningFields(doc: SignWellContractDocument) {
  if (
    !doc.apply_signing_order ||
    doc.recipients[0]?.id !== "counterparty" ||
    doc.recipients[1]?.id !== "fil-one"
  )
    throw new Error("SIGNWELL_SIGNING_ORDER_MISMATCH");
  const fields = doc.fields.flat();
  if (
    fields.length !== 4 ||
    !["counterparty", "fil-one"].every((id) =>
      ["signature", "autofill_date_signed"].every(
        (type) =>
          fields.filter(
            (f) => f.recipient_id === id && f.type === type && f.required,
          ).length === 1,
      ),
    )
  )
    throw new Error("SIGNWELL_SIGNING_FIELDS_MISMATCH");
}
