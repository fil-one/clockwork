"use server";

import { z } from "zod";
import {
  availableContractTemplate,
  counterpartySignaturePageVersion,
  renderCounterpartyPaper,
} from "@clockwork/documents";
import {
  ContractCorrectSignerSchema,
  ContractInputSchema,
  ContractResendSchema,
  ContractVoidSchema,
  SendCounterpartyPaperSchema,
  contractPdfFileName,
  contractSignerEmail,
} from "@clockwork/contracts";
import { mndaRepository } from "../mnda/server";
import type { MndaDuplicates } from "../mnda/actions";
import { mayApproveOwnRequests } from "../self-approval/model";
import { attempt } from "./action-result";
import {
  importedScenarioNotes,
  templateRateMinimums,
} from "./line-items-server";
import { prepareInputSchema } from "./prepare-input";
import {
  contractActor,
  contractRepository,
  contractSigningConfiguration,
  contractSigningRepository,
  contractSigningWorkflow,
  contractStaff,
  contractTemplateRegistry,
  sessionHas,
} from "./server";

/** The request a person acted on, when the screen names it: a contract's
 * request is replaced after it ends, so an action taken on an earlier one is
 * refused rather than applied to the next. */
const requestNumber = z.number().int().min(1).optional();

async function assertCurrentRequest(
  contractId: string,
  expected: number | undefined,
) {
  if (expected === undefined) return;
  const record = await contractSigningRepository().get(contractId);
  if (record.requestNumber !== expected)
    throw new Error("CONTRACT_REQUEST_CHANGED");
}

/** Records a new contract, or saves an edit made against a known version. */
export async function saveContract(raw: unknown) {
  return attempt(async () => {
    const session = await contractStaff("contract:write");
    const { contract, expectedVersion } = z
      .object({
        contract: z.unknown(),
        expectedVersion: z.number().int().min(1).optional(),
      })
      .strict()
      .parse(raw);
    const input = ContractInputSchema.parse(contract);
    const actor = contractActor(session);
    if (expectedVersion === undefined) {
      await contractRepository().create(input, actor);
      return { id: input.id, version: 1 };
    }
    const version = await contractRepository().update(
      input.id,
      expectedVersion,
      input,
      actor,
    );
    return { id: input.id, version };
  });
}

/**
 * Earlier MNDAs and register contracts for the same counterparty, matched
 * with the MNDA register's company normalizer, so a seller recording a
 * contract sees what already exists. A warning only: saving never waits on
 * it. MNDAs are listed only to people who may open the MNDA register.
 */
export async function findContractDuplicates(raw: unknown) {
  return attempt(async (): Promise<MndaDuplicates> => {
    const session = await contractStaff("contract:write");
    const { counterpartyName, excludeMndaId } = z
      .object({
        counterpartyName: z.string().trim().max(200),
        // The signed MNDA the contract starts from is not a duplicate.
        excludeMndaId: z.uuid().optional(),
      })
      .strict()
      .parse(raw);
    const repository = mndaRepository();
    const [mndas, contracts] = await Promise.all([
      sessionHas(session, "mnda:send")
        ? repository.duplicates(counterpartyName, excludeMndaId)
        : [],
      repository.contractDuplicates(counterpartyName),
    ]);
    return { mndas, contracts };
  });
}

export async function removeContractFile(raw: unknown) {
  return attempt(async () => {
    const session = await contractStaff("contract:write");
    const { contractId, fileId } = z
      .object({ contractId: z.uuid(), fileId: z.uuid() })
      .strict()
      .parse(raw);
    await contractRepository().removeFile(
      contractId,
      fileId,
      contractActor(session),
    );
    return null;
  });
}

/**
 * Prepares a contract from an available template: validates the seller's
 * values against the template's fields, renders the PDF and records it as a
 * draft awaiting approval or sending. Templates pending from legal refuse.
 */
export async function prepareContract(raw: unknown) {
  return attempt(async () => {
    const session = await contractStaff("contract:write");
    const templateId = z
      .object({ templateId: z.string().min(1).max(64) })
      .loose()
      .parse(raw).templateId;
    const template = availableContractTemplate(
      contractTemplateRegistry(),
      templateId,
    );
    const input = prepareInputSchema(
      template.fields,
      await templateRateMinimums(template.fields),
    ).parse(raw);
    const repository = contractSigningRepository();
    const countersigner = (await repository.countersigners()).find(
      (signer) => signer.id === input.countersignerId,
    );
    if (!countersigner) throw new Error("CONTRACT_COUNTERSIGNER_UNAVAILABLE");
    if (countersigner.email.toLowerCase() === input.signerEmail)
      throw new Error("CONTRACT_DISTINCT_SIGNERS_REQUIRED");
    const signer = {
      name: input.signerName,
      email: input.signerEmail,
      title: input.signerTitle,
    };
    const rendered = await template.render({
      contractId: input.id,
      counterpartyName: input.counterpartyName,
      effectiveDate: input.effectiveDate,
      values: input.values,
      signer,
      countersigner,
    });
    const documentName =
      `Fil One ${template.name} - ${input.counterpartyName}`.slice(0, 200);
    const pricingNotes = await importedScenarioNotes(session, input.values);
    await repository.prepare(
      {
        contract: {
          id: input.id,
          counterpartyName: input.counterpartyName,
          title: template.name,
          contractType: template.contractType,
          paper: "ours",
          status: "draft",
          effectiveDate: input.effectiveDate,
          initialTermMonths: null,
          autoRenew: false,
          renewalTermMonths: null,
          noticePeriodDays: null,
          valueMinor: null,
          currency: null,
          pricingNotes,
          ownerName: input.ownerName,
          internalNotes: "",
          tags: [],
        },
        signing: {
          templateId: template.id,
          templateVersion: template.version,
          templateHash: template.templateHash,
          documentName,
          input: input.values,
          counterpartySigner: signer,
          countersignerId: countersigner.id,
          approvalRequired: template.requiresApproval,
          testMode: contractSigningConfiguration().testMode,
          preparerEmail: session.profile.email,
        },
        pdf: rendered.bytes,
        fileName: contractPdfFileName(documentName),
      },
      contractActor(session),
    );
    return { id: input.id };
  });
}

/**
 * Approves or rejects a prepared contract. The preparer cannot decide, except
 * that a holder of `approval:self` may approve their own contract with a
 * written reason (`selfApprovalReason`), from their own MFA-verified session
 * signed in recently. The repository checks the stored memberships and the
 * reason; the database records the audit event and the notices.
 */
export async function decideContract(raw: unknown) {
  return attempt(async () => {
    const session = await contractStaff("contract:approve");
    const input = z
      .discriminatedUnion("approve", [
        z
          .object({
            contractId: z.uuid(),
            requestNumber,
            approve: z.literal(true),
            selfApprovalReason: z.string().max(2000).optional(),
          })
          .strict(),
        z
          .object({
            contractId: z.uuid(),
            requestNumber,
            approve: z.literal(false),
            reason: z
              .string()
              .trim()
              .min(1, { message: "required" })
              .max(1000, { message: "too_big" }),
          })
          .strict(),
      ])
      .parse(raw);
    const selfApprovalReason = input.approve
      ? input.selfApprovalReason
      : undefined;
    if (selfApprovalReason !== undefined) {
      if (!mayApproveOwnRequests(session))
        throw new Error("SELF_APPROVAL_NOT_PERMITTED");
      if (!session.recentAuthenticationVerified)
        throw new Error("CONTRACT_RECENT_AUTH_REQUIRED");
    }
    const record = await contractSigningRepository().decide(
      input.contractId,
      !input.approve
        ? { approve: false, reason: input.reason }
        : selfApprovalReason !== undefined
          ? { approve: true, selfApproval: { reason: selfApprovalReason } }
          : { approve: true },
      contractActor(session),
      input.requestNumber,
    );
    return { approvalState: record.approvalState };
  });
}

/** Sends, refreshes, reminds or discards a prepared contract. */
export async function operateContract(raw: unknown) {
  return attempt(async () => {
    const session = await contractStaff("contract:write");
    const {
      contractId,
      operation,
      requestNumber: expected,
    } = z
      .object({
        contractId: z.uuid(),
        requestNumber,
        operation: z.enum(["send", "sync", "remind", "cancel"]),
      })
      .strict()
      .parse(raw);
    await assertCurrentRequest(contractId, expected);
    const record = await contractSigningWorkflow(operation)[operation](
      contractId,
      contractActor(session),
    );
    return { state: record.state };
  });
}

/** Voiding or correcting a colleague's request takes an approver, so it is
 * not changed by accident. */
async function assertMayChangeSigning(
  session: Awaited<ReturnType<typeof contractStaff>>,
  contractId: string,
) {
  if (sessionHas(session, "contract:approve")) return;
  const record = await contractSigningRepository().get(contractId);
  if (record.preparerId !== session.userId)
    throw new Error("CONTRACT_NOT_PREPARER");
}

/**
 * Voids a sent request the counterparty has not signed, or closes one whose
 * document was deleted in SignWell, with a typed reason or the code for "a
 * different person will sign". Sending needs `contract:write`, and so does
 * voiding; as with MNDAs, someone other than the preparer also needs to be an
 * approver.
 */
export async function voidContract(raw: unknown) {
  return attempt(async () => {
    const session = await contractStaff("contract:write");
    const input = ContractVoidSchema.parse(raw);
    await assertCurrentRequest(input.contractId, input.requestNumber);
    await assertMayChangeSigning(session, input.contractId);
    const record = await contractSigningWorkflow("void").void(
      input.contractId,
      contractActor(session),
      "code" in input ? { code: input.code } : { reason: input.reason },
    );
    return { state: record.state };
  });
}

/**
 * Replaces the counterparty signer's email (a bounce or a typo) while they
 * have not started signing; SignWell sends the request to the new address.
 * The same people who may void the request may correct it.
 */
export async function correctContractSigner(raw: unknown) {
  return attempt(async () => {
    const session = await contractStaff("contract:write");
    const {
      contractId,
      signerEmail,
      requestNumber: expected,
    } = ContractCorrectSignerSchema.parse(raw);
    await assertCurrentRequest(contractId, expected);
    await assertMayChangeSigning(session, contractId);
    const record = await contractSigningWorkflow("correctSigner").correctSigner(
      contractId,
      contractActor(session),
      signerEmail,
    );
    return { state: record.state, signerEmail: contractSignerEmail(record) };
  });
}

/**
 * Prepares one of a recorded contract's uploaded PDFs for signature, on
 * either party's paper (their agreement, or Fil One's own term sheet or
 * letter): the chosen PDF, read and checked against its hash, with the Fil
 * One signature page appended. The seller chooses whether the counterparty
 * signs in SignWell first or signed the PDF already. Approval and sending
 * then follow the signing panel, as for templates. After a request was
 * declined, expired or voided, this prepares the next one.
 */
export async function prepareCounterpartyPaper(raw: unknown) {
  return attempt(async () => {
    const session = await contractStaff("contract:write");
    const input = SendCounterpartyPaperSchema.parse(raw);
    const { file, contract, bytes } = await contractRepository().readFile(
      input.contractId,
      input.fileId,
    );
    if (!contract) throw new Error("CONTRACT_NOT_FOUND");
    const repository = contractSigningRepository();
    const countersigner = (await repository.countersigners()).find(
      (signer) => signer.id === input.countersignerId,
    );
    if (!countersigner) throw new Error("CONTRACT_COUNTERSIGNER_UNAVAILABLE");
    const counterpartySigner =
      input.signers === "fil-one"
        ? null
        : {
            name: input.signerName,
            email: input.signerEmail,
            title: input.signerTitle,
          };
    if (
      counterpartySigner &&
      countersigner.email.toLowerCase() === counterpartySigner.email
    )
      throw new Error("CONTRACT_DISTINCT_SIGNERS_REQUIRED");
    const rendered = await renderCounterpartyPaper(bytes, {
      contractId: input.contractId,
      counterpartyName: contract.counterpartyName,
      sourceSha256: file.sha256,
      counterpartySigner,
      countersigner,
      preparedOn: new Date().toISOString().slice(0, 10),
    });
    // Their paper keeps the countersignature name; Fil One's own PDF is
    // named by what it is.
    const documentName = (
      contract.paper === "theirs"
        ? `Fil One countersignature - ${contract.counterpartyName}`
        : `Fil One ${contract.title.trim() || "agreement"} - ${contract.counterpartyName}`
    ).slice(0, 200);
    const { record } = await repository.prepareCounterpartyPaper(
      {
        contractId: input.contractId,
        source: { fileId: file.id, sha256: file.sha256 },
        documentName,
        signaturePageVersion: counterpartySignaturePageVersion,
        counterpartySigner,
        countersignerId: countersigner.id,
        testMode: contractSigningConfiguration().testMode,
        preparerEmail: session.profile.email,
        pdf: rendered.bytes,
        fileName: contractPdfFileName(documentName),
      },
      contractActor(session),
    );
    return { state: record.state };
  });
}

/**
 * Sends a contract again to the same people after its request was declined,
 * expired or voided, with the same prepared PDF. The new request replaces the
 * ended one, which stays in the contract's signing history, and needs
 * approval again where the first did. The person sending it again is its
 * preparer.
 */
export async function resendContract(raw: unknown) {
  return attempt(async () => {
    const session = await contractStaff("contract:write");
    const { contractId, requestNumber } = ContractResendSchema.parse(raw);
    const { record } = await contractSigningRepository().resend(
      contractId,
      requestNumber,
      {
        testMode: contractSigningConfiguration().testMode,
        preparerEmail: session.profile.email,
      },
      contractActor(session),
    );
    return { state: record.state, requestNumber: record.requestNumber };
  });
}
