// i18n-exempt-file: MCP tool names, descriptions and results are read by MCP clients and the model, not rendered in the interface
import "server-only";

import { z } from "zod";

import {
  contractCurrencies,
  contractDocumentMaxBytes,
  contractPdfFileName,
  contractPapers,
  contractSignerEmail,
  contractSorts,
  contractStatuses,
  contractStatusFilterExtras,
  contractTypes,
  contractValueToMinor,
  uploadableContractFileKinds,
  type ContractFileRecord,
  type ContractListRow,
  type ContractRecord,
  type ContractSigningRecord,
} from "@clockwork/contracts";

import {
  prepareContract,
  prepareCounterpartyPaper,
  saveContract,
} from "@/src/features/internal-ops/contracts/actions";
import { withDocumentSlot } from "@/src/features/internal-ops/contracts/http";
import {
  loadContract,
  loadPrepare,
  loadRegister,
  loadRenewals,
  loadTemplates,
} from "@/src/features/internal-ops/contracts/loaders";
import {
  contractActor,
  contractRepository,
  contractStaff,
} from "@/src/features/internal-ops/contracts/server";

import {
  appLink,
  compact,
  defineTool,
  loaded,
  McpToolError,
  unwrap,
  type McpToolContext,
} from "../tool";

/** PDFs sent through MCP as base64; larger files belong in the app. */
const mcpUploadMaxBytes = Math.min(contractDocumentMaxBytes, 10 * 1024 * 1024);

const contractLink = (context: McpToolContext, id: string) =>
  appLink(context, `/internal/contracts/${id}`);

function rowView(row: ContractListRow, context: McpToolContext) {
  return compact({
    id: row.id,
    source: row.source,
    counterparty: row.counterpartyName,
    title: row.title,
    type: row.contractType,
    paper: row.paper,
    status: row.status,
    signingState: row.signingState,
    effectiveDate: row.effectiveDate,
    termEndDate: row.termEndDate,
    renewalDate: row.renewalDate,
    noticeDeadline: row.noticeDeadline,
    autoRenew: row.autoRenew || undefined,
    owner: row.ownerName,
    tags: row.tags,
    documents: row.documentCount,
    updatedAt: row.updatedAt,
    link:
      row.source === "mnda"
        ? appLink(
            context,
            `/internal/mndas?q=${encodeURIComponent(row.counterpartyName)}`,
          )
        : contractLink(context, row.id),
  });
}

function contractView(contract: ContractRecord) {
  return compact({
    id: contract.id,
    source: contract.source,
    counterparty: contract.counterpartyName,
    title: contract.title,
    type: contract.contractType,
    paper: contract.paper,
    status: contract.status,
    effectiveDate: contract.effectiveDate,
    initialTermMonths: contract.initialTermMonths,
    autoRenew: contract.autoRenew,
    renewalTermMonths: contract.renewalTermMonths,
    noticePeriodDays: contract.noticePeriodDays,
    termEndDate: contract.termEndDate,
    renewalDate: contract.renewalDate,
    noticeDeadline: contract.noticeDeadline,
    value:
      contract.valueMinor !== null && contract.currency
        ? {
            amount: (contract.valueMinor / 100).toFixed(2),
            currency: contract.currency,
          }
        : undefined,
    pricingNotes: contract.pricingNotes,
    owner: contract.ownerName,
    internalNotes: contract.internalNotes,
    tags: contract.tags,
    executedAt: contract.executedAt,
    recordedBy: contract.createdByName,
    createdAt: contract.createdAt,
    updatedAt: contract.updatedAt,
    version: contract.version,
  });
}

function fileView(
  contractId: string,
  file: ContractFileRecord,
  context: McpToolContext,
) {
  return {
    id: file.id,
    kind: file.kind,
    fileName: file.fileName,
    sizeBytes: file.sizeBytes,
    uploadedBy: file.uploadedByName,
    createdAt: file.createdAt,
    link: appLink(
      context,
      `/internal/contracts/${contractId}/files/${file.id}`,
    ),
  };
}

function signingView(signing: ContractSigningRecord) {
  return compact({
    requestNumber: signing.requestNumber,
    documentType: signing.documentType,
    documentName: signing.documentName,
    state: signing.state,
    approval: signing.approvalState,
    approver: signing.approverName,
    rejectionReason: signing.rejectionReason,
    counterpartySigns: signing.counterpartySigns,
    counterpartySigner: signing.counterpartySigns
      ? {
          name: signing.counterpartySigner.name,
          email: contractSignerEmail(signing),
          title: signing.counterpartySigner.title,
        }
      : undefined,
    countersigner: signing.countersigner.name,
    preparedBy: signing.preparerName,
    testMode: signing.testMode || undefined,
    remindedAt: signing.remindedAt,
    completedAt: signing.completedAt,
    voidReason: signing.cancelReason,
    closedBecause: signing.cancelCode,
    error: signing.error,
  });
}

/** A contract as the contract page loads it. */
async function contractDetail(id: string) {
  return loaded(await loadContract(id));
}

/** The contract page's detail, as a tool reports it. */
async function contractResult(id: string, context: McpToolContext) {
  const detail = await contractDetail(id);
  return {
    contract: contractView(detail.contract),
    files: detail.files.map((file) => fileView(id, file, context)),
    signing: detail.signing ? signingView(detail.signing) : null,
    previousSigning: detail.previousSigning.map((entry) => ({
      requestNumber: entry.requestNumber,
      state: entry.state,
      closedBecause: entry.cancelCode,
      voidReason: entry.cancelReason,
      updatedAt: entry.updatedAt,
    })),
    ...(detail.paperSources.length
      ? {
          sendableFiles: detail.paperSources.map((file) => file.id),
          countersigners: detail.countersigners.map((signer) => ({
            id: signer.id,
            name: signer.name,
            title: signer.title,
          })),
        }
      : {}),
    signingReady: detail.signingReady,
    link: contractLink(context, id),
  };
}

export const listContracts = defineTool({
  name: "list_contracts",
  title: "List contracts",
  description:
    "Search the contract register (25 per page). Signed MNDAs appear too for people who may open MNDAs. Filter by counterparty text, type, status (including signing_declined, signing_expired, signing_canceled, signing_approval and signing_attention), renewal window in days, or contracts you recorded.",
  input: {
    search: z.string().max(100).optional(),
    type: z.enum(contractTypes).optional(),
    status: z
      .enum([...contractStatuses, ...contractStatusFilterExtras])
      .optional(),
    renewalWindowDays: z
      .union([z.literal(30), z.literal(60), z.literal(90)])
      .optional(),
    sort: z.enum(contractSorts).optional(),
    direction: z.enum(["asc", "desc"]).optional(),
    mine: z.boolean().optional(),
    page: z.number().int().min(1).max(10_000).optional(),
  },
  access: "read",
  run: async (args, context) => {
    const register = loaded(
      await loadRegister({
        ...(args.search ? { q: args.search } : {}),
        ...(args.type ? { type: args.type } : {}),
        ...(args.status ? { status: args.status } : {}),
        ...(args.renewalWindowDays
          ? { window: String(args.renewalWindowDays) }
          : {}),
        ...(args.sort ? { sort: args.sort } : {}),
        ...(args.direction ? { direction: args.direction } : {}),
        ...(args.mine ? { mine: "1" } : {}),
        ...(args.page ? { page: String(args.page) } : {}),
      }),
    );
    return {
      total: register.result.total,
      page: register.result.page,
      pageSize: register.result.pageSize,
      contracts: register.result.rows.map((row) => rowView(row, context)),
    };
  },
});

export const getContract = defineTool({
  name: "get_contract",
  title: "Get a contract",
  description:
    "One contract with its terms, files (with download links), signing request and earlier requests. When it can be sent for signature, lists the file ids and countersigners prepare_contract_for_signature takes.",
  input: { id: z.uuid() },
  access: "read",
  run: async ({ id }, context) => {
    context.targets.contractId = id;
    return contractResult(id, context);
  },
});

const fileUpload = z
  .object({
    fileName: z.string().min(1).max(200),
    base64: z.string().min(1),
    kind: z.enum(uploadableContractFileKinds).optional(),
  })
  .strict();

const contractFields = {
  counterpartyName: z.string().min(1).max(200).optional(),
  title: z.string().max(200).optional(),
  contractType: z.enum(contractTypes).optional(),
  paper: z.enum(contractPapers).optional().describe("ours or theirs"),
  status: z.enum(contractStatuses).optional(),
  effectiveDate: z.iso.date().nullable().optional(),
  initialTermMonths: z.number().int().min(1).max(600).nullable().optional(),
  autoRenew: z.boolean().optional(),
  renewalTermMonths: z.number().int().min(1).max(600).nullable().optional(),
  noticePeriodDays: z.number().int().min(0).max(3650).nullable().optional(),
  value: z
    .string()
    .nullable()
    .optional()
    .describe('Total value as a decimal, such as "120000.00"; null clears it'),
  currency: z.enum(contractCurrencies).nullable().optional(),
  pricingNotes: z.string().max(2000).optional(),
  ownerName: z.string().min(1).max(120).optional(),
  internalNotes: z.string().max(10_000).optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
};

export const recordContract = defineTool({
  name: "record_contract",
  title: "Record or edit a contract",
  description:
    "Records a contract in the register, or edits one when id and expectedVersion are given (fields left out keep their values). Optionally attaches one PDF sent as base64, at most 10 MB; larger files go through the app. Returns the contract.",
  input: {
    id: z
      .uuid()
      .optional()
      .describe(
        "An existing contract to edit (with expectedVersion), or the id for a new one so a retry cannot record it twice",
      ),
    expectedVersion: z.number().int().min(1).optional(),
    ...contractFields,
    files: z.array(fileUpload).max(1).optional(),
  },
  access: "write",
  run: async (
    { id, expectedVersion, files, value, currency, ...fields },
    context,
  ) => {
    const session = await contractStaff("contract:write");
    let contractId = id;
    const hasFieldChanges =
      Object.keys(fields).length > 0 ||
      value !== undefined ||
      currency !== undefined;
    if (!contractId || hasFieldChanges) {
      // A new contract may carry its own id, so a retried call returns the
      // contract it recorded instead of recording a second one.
      const stored = contractId ? await loadContract(contractId) : null;
      const current =
        stored && stored.kind !== "missing" ? loaded(stored).contract : null;
      const base = current ?? {
        id: contractId ?? crypto.randomUUID(),
        counterpartyName: "",
        title: "",
        contractType: "other" as const,
        paper: "ours" as const,
        status: "draft" as const,
        effectiveDate: null,
        initialTermMonths: null,
        autoRenew: false,
        renewalTermMonths: null,
        noticePeriodDays: null,
        valueMinor: null,
        currency: null,
        pricingNotes: "",
        ownerName: session.profile.name,
        internalNotes: "",
        tags: [],
      };
      const result = await saveContract({
        contract: {
          id: base.id,
          counterpartyName: fields.counterpartyName ?? base.counterpartyName,
          title: fields.title ?? base.title,
          contractType: fields.contractType ?? base.contractType,
          paper: fields.paper ?? base.paper,
          status: fields.status ?? base.status,
          effectiveDate:
            fields.effectiveDate !== undefined
              ? fields.effectiveDate
              : base.effectiveDate,
          initialTermMonths:
            fields.initialTermMonths !== undefined
              ? fields.initialTermMonths
              : base.initialTermMonths,
          autoRenew: fields.autoRenew ?? base.autoRenew,
          renewalTermMonths:
            fields.renewalTermMonths !== undefined
              ? fields.renewalTermMonths
              : base.renewalTermMonths,
          noticePeriodDays:
            fields.noticePeriodDays !== undefined
              ? fields.noticePeriodDays
              : base.noticePeriodDays,
          valueMinor:
            value === undefined
              ? base.valueMinor
              : value === null
                ? null
                : contractValueToMinor(value),
          currency: currency !== undefined ? currency : base.currency,
          pricingNotes: fields.pricingNotes ?? base.pricingNotes,
          ownerName: fields.ownerName ?? base.ownerName,
          internalNotes: fields.internalNotes ?? base.internalNotes,
          tags: fields.tags ?? base.tags,
        },
        ...(current && expectedVersion !== undefined
          ? { expectedVersion }
          : {}),
      });
      if (
        !result.ok &&
        result.code === "CONTRACT_IDEMPOTENCY_CONFLICT" &&
        current
      )
        throw new McpToolError(
          "expected_version_required",
          `This contract exists. Pass expectedVersion (it is at version ${current.version}) to edit it.`,
        );
      const saved = unwrap(result);
      contractId = saved.id;
    }
    context.targets.contractId = contractId;
    for (const file of files ?? []) {
      const bytes = Buffer.from(file.base64, "base64");
      if (bytes.length === 0) throw new McpToolError("DOCUMENT_EMPTY");
      if (bytes.length > mcpUploadMaxBytes)
        throw new McpToolError(
          "DOCUMENT_TOO_LARGE",
          "Files over 10 MB go through the contract page in the app.",
        );
      const targetId = contractId;
      await withDocumentSlot(() =>
        contractRepository().addFile(
          targetId,
          {
            kind: file.kind ?? "main",
            fileName: contractPdfFileName(file.fileName),
            bytes: new Uint8Array(bytes),
          },
          contractActor(session),
        ),
      );
    }
    return contractResult(contractId, context);
  },
});

export const prepareContractForSignature = defineTool({
  name: "prepare_contract_for_signature",
  title: "Prepare a contract for signature",
  description:
    "Prepares one of a recorded contract's uploaded PDFs for signature, with the Fil One signature page appended. signers is counterparty_then_fil_one (they sign first; give signerName, signerEmail, signerTitle) or fil-one (they signed the PDF already). Nothing is sent: another person approves it in the app, and a person reviews and sends it from the contract page in Commerce.",
  input: {
    contractId: z.uuid(),
    fileId: z
      .uuid()
      .optional()
      .describe(
        "Which uploaded PDF; defaults to the only one that can be sent",
      ),
    signers: z.enum(["counterparty_then_fil_one", "fil-one"]).optional(),
    signerName: z.string().min(1).max(120).optional(),
    signerEmail: z.email().optional(),
    signerTitle: z.string().min(1).max(120).optional(),
    countersignerId: z
      .uuid()
      .optional()
      .describe("Fil One countersigner; defaults to the first listed"),
  },
  access: "write",
  run: async (args, context) => {
    const { contractId } = args;
    context.targets.contractId = contractId;
    const detail = await contractDetail(contractId);
    const sources = detail.paperSources;
    const file = args.fileId
      ? sources.find((source) => source.id === args.fileId)
      : sources.length === 1
        ? sources[0]
        : undefined;
    if (!file)
      throw new McpToolError(
        "file_required",
        sources.length
          ? `Name the PDF with fileId: ${sources.map((source) => `${source.id} (${source.fileName})`).join(", ")}.`
          : "This contract has no uploaded main or counterparty PDF that can be prepared, or its signing request is already prepared or out.",
      );
    const countersigner =
      detail.countersigners.find(
        (signer) => signer.id === args.countersignerId,
      ) ?? detail.countersigners[0];
    if (!countersigner)
      throw new McpToolError("CONTRACT_COUNTERSIGNER_UNAVAILABLE");
    const signers = args.signers ?? "counterparty_then_fil_one";
    if (
      signers === "counterparty_then_fil_one" &&
      (!args.signerName || !args.signerEmail || !args.signerTitle)
    )
      throw new McpToolError(
        "signer_required",
        "Give signerName, signerEmail and signerTitle for the counterparty signer, or signers: fil-one if they signed already.",
      );
    unwrap(
      await prepareCounterpartyPaper(
        signers === "fil-one"
          ? {
              contractId,
              fileId: file.id,
              countersignerId: countersigner.id,
              signers,
            }
          : {
              contractId,
              fileId: file.id,
              countersignerId: countersigner.id,
              signers,
              signerName: args.signerName,
              signerEmail: args.signerEmail,
              signerTitle: args.signerTitle,
            },
      ),
    );
    return {
      prepared: true,
      next: `Review and send in Commerce: ${contractLink(context, contractId)}. Another person approves it first; sending is always done by a person in the app.`,
      ...(await contractResult(contractId, context)),
    };
  },
});

export const renewalNotices = defineTool({
  name: "renewal_notices",
  title: "Renewal notices",
  description:
    "Contracts whose non-renewal notice deadline falls in the next 30, 60 or 90 days (default 90), and auto-renewing contracts whose deadline has passed.",
  input: {
    windowDays: z
      .union([z.literal(30), z.literal(60), z.literal(90)])
      .optional(),
  },
  access: "read",
  run: async ({ windowDays }, context) => {
    const renewals = loaded(await loadRenewals(windowDays ?? 90));
    return {
      asOf: renewals.today,
      windowDays: renewals.days,
      due: renewals.rows.map((row) => rowView(row, context)),
      deadlinePassed: renewals.passed.map((row) => rowView(row, context)),
      link: appLink(context, "/internal/contracts/notices"),
    };
  },
});

export const listContractTemplates = defineTool({
  name: "list_contract_templates",
  title: "List contract templates",
  description:
    "The contract templates in use, as commerce administrators publish them in Commerce: name, type, the version in use and whether it needs approval. With templateId, that version's fields, optional sections and the Fil One countersigners prepare_from_template takes.",
  input: { templateId: z.string().min(1).max(64).optional() },
  access: "read",
  run: async ({ templateId }) => {
    if (!templateId) {
      const { templates } = loaded(await loadTemplates());
      return { templates };
    }
    const prepare = loaded(await loadPrepare(templateId));
    return {
      template: prepare.template,
      countersigners: prepare.countersigners.map((signer) => ({
        id: signer.id,
        name: signer.name,
        title: signer.title,
      })),
      signingReady: prepare.signingReady,
      testMode: prepare.testMode,
    };
  },
});

export const prepareFromTemplate = defineTool({
  name: "prepare_from_template",
  title: "Prepare a contract from a template",
  description:
    "Prepares a contract from a template's version in use: checks the values and sections against it (see list_contract_templates), renders the PDF and records the contract as a draft. Nothing is sent: a person reviews and sends it from the contract page in Commerce.",
  input: {
    id: z
      .uuid()
      .optional()
      .describe(
        "Your own id for the new record, so a retried call cannot create it twice",
      ),
    templateId: z.string().min(1).max(64),
    templateVersion: z
      .string()
      .min(1)
      .max(40)
      .optional()
      .describe(
        "The version you read with list_contract_templates; defaults to the version in use now",
      ),
    sections: z
      .array(z.string().min(1).max(48))
      .max(30)
      .optional()
      .describe("Optional sections to include, by id"),
    counterpartyName: z.string().min(1).max(200),
    effectiveDate: z.iso.date(),
    signerName: z.string().min(1).max(120),
    signerEmail: z.email(),
    signerTitle: z.string().min(1).max(120),
    countersignerId: z.uuid(),
    ownerName: z.string().min(1).max(120).optional(),
    values: z
      .record(z.string(), z.unknown())
      .describe("Field id to value, as listed for the template"),
  },
  access: "write",
  run: async (args, context) => {
    const id = args.id ?? crypto.randomUUID();
    context.targets.contractId = id;
    // A template replaced since it was read is refused rather than prepared
    // from a version the caller did not look at.
    const templateVersion =
      args.templateVersion ??
      loaded(await loadPrepare(args.templateId)).template.version;
    unwrap(
      await prepareContract({
        id,
        templateId: args.templateId,
        templateVersion,
        sections: args.sections ?? [],
        counterpartyName: args.counterpartyName,
        effectiveDate: args.effectiveDate,
        signerName: args.signerName,
        signerEmail: args.signerEmail,
        signerTitle: args.signerTitle,
        countersignerId: args.countersignerId,
        ownerName: args.ownerName ?? context.session.profile.name,
        values: args.values,
      }),
    );
    return {
      prepared: true,
      next: `Review and send in Commerce: ${contractLink(context, id)}. Sending is always done by a person in the app.`,
      ...(await contractResult(id, context)),
    };
  },
});

export const contractTools = [
  listContracts,
  getContract,
  recordContract,
  prepareContractForSignature,
  renewalNotices,
  listContractTemplates,
  prepareFromTemplate,
];
