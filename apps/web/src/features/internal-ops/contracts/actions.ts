"use server";

import { z } from "zod";
import { availableContractTemplate } from "@clockwork/documents";
import {
  ContractInputSchema,
  ContractVoidSchema,
  contractPdfFileName,
} from "@clockwork/contracts";
import { mndaRepository } from "../mnda/server";
import type { MndaDuplicates } from "../mnda/actions";
import { attempt } from "./action-result";
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
    const input = prepareInputSchema(template.fields).parse(raw);
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
          pricingNotes: "",
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
        },
        pdf: rendered.bytes,
        fileName: contractPdfFileName(documentName),
      },
      contractActor(session),
    );
    return { id: input.id };
  });
}

/** Approves or rejects a prepared contract. The preparer cannot decide. */
export async function decideContract(raw: unknown) {
  return attempt(async () => {
    const session = await contractStaff("contract:approve");
    const input = z
      .discriminatedUnion("approve", [
        z.object({ contractId: z.uuid(), approve: z.literal(true) }).strict(),
        z
          .object({
            contractId: z.uuid(),
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
    const record = await contractSigningRepository().decide(
      input.contractId,
      input.approve
        ? { approve: true }
        : { approve: false, reason: input.reason },
      contractActor(session),
    );
    return { approvalState: record.approvalState };
  });
}

/** Sends, refreshes, reminds or discards a prepared contract. */
export async function operateContract(raw: unknown) {
  return attempt(async () => {
    const session = await contractStaff("contract:write");
    const { contractId, operation } = z
      .object({
        contractId: z.uuid(),
        operation: z.enum(["send", "sync", "remind", "cancel"]),
      })
      .strict()
      .parse(raw);
    const record = await contractSigningWorkflow(operation)[operation](
      contractId,
      contractActor(session),
    );
    return { state: record.state };
  });
}

/**
 * Voids a sent request the counterparty has not signed, or closes one whose
 * document was deleted in SignWell. Sending needs `contract:write`, and so
 * does voiding; as with MNDAs, someone other than the preparer also needs to
 * be an approver, so a colleague's request is not withdrawn by accident.
 */
export async function voidContract(raw: unknown) {
  return attempt(async () => {
    const session = await contractStaff("contract:write");
    const { contractId, reason } = ContractVoidSchema.parse(raw);
    if (!sessionHas(session, "contract:approve")) {
      const record = await contractSigningRepository().get(contractId);
      if (record.preparerId !== session.userId)
        throw new Error("CONTRACT_NOT_PREPARER");
    }
    const record = await contractSigningWorkflow("void").void(
      contractId,
      contractActor(session),
      reason,
    );
    return { state: record.state };
  });
}
