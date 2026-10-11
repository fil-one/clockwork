// i18n-exempt-file: MCP tool names, descriptions and results are read by MCP clients and the model, not rendered in the interface
import "server-only";

import { z } from "zod";

import {
  mndaSignerEmail,
  mndaStates,
  mndaStatusGroups,
  type MndaRecord,
  type MndaState,
} from "@clockwork/contracts";

import {
  findMndaDuplicates,
  loadMndas,
  operateMnda,
  prepareMnda,
} from "@/src/features/internal-ops/mnda/actions";
import { mndaPdfHref } from "@/src/features/internal-ops/mnda/register";
import {
  mndaActor,
  mndaRepository,
  mndaStaff,
} from "@/src/features/internal-ops/mnda/server";

import {
  appLink,
  compact,
  defineTool,
  McpToolError,
  unwrap,
  type McpToolContext,
} from "../tool";

/** PDFs at or below this size can come back inline as well as by link. */
const inlinePdfLimit = 4 * 1024 * 1024;

function mndaView(record: MndaRecord, context: McpToolContext) {
  return compact({
    id: record.id,
    company: record.input.company,
    signerName: record.input.signerName,
    signerEmail: mndaSignerEmail(record),
    signerTitle: record.input.signerTitle,
    countersigner: record.countersigner.name,
    effectiveDate: record.input.effectiveDate,
    state: record.state,
    owner: record.ownerName,
    testMode: record.testMode || undefined,
    createdAt: record.createdAt,
    sentAt: record.sentAt,
    remindedAt: record.remindedAt,
    completedAt: record.completedAt,
    voidReason: record.cancelReason,
    closedBecause: record.cancelCode,
    error: record.error,
    version: record.version,
    links: compact({
      register: appLink(
        context,
        `/internal/mndas?q=${encodeURIComponent(record.input.company)}`,
      ),
      preview: appLink(context, mndaPdfHref(record.id, "original")),
      signedPdf:
        record.state === "completed"
          ? appLink(context, mndaPdfHref(record.id, "executed", true))
          : undefined,
    }),
  });
}

async function readMnda(id: string) {
  await mndaStaff();
  return mndaRepository().get(id);
}

const groupNames = Object.keys(mndaStatusGroups) as [
  keyof typeof mndaStatusGroups,
  ...(keyof typeof mndaStatusGroups)[],
];

export const listMndas = defineTool({
  name: "list_mndas",
  title: "List MNDAs",
  description:
    "Search the MNDA register. Filter by company or signer text, by what the MNDA is waiting on (drafts, waiting_partner, waiting_fil_one, attention, completed, closed) or by exact states, and to the ones you prepared. Newest first, 25 per page by default.",
  input: {
    search: z.string().max(120).optional().describe("Company or signer text"),
    group: z.enum(groupNames).optional(),
    states: z.array(z.enum(mndaStates)).max(mndaStates.length).optional(),
    mine: z.boolean().optional().describe("Only MNDAs you prepared"),
    page: z.number().int().min(1).max(1000).optional(),
    pageSize: z
      .union([z.literal(25), z.literal(50), z.literal(100)])
      .optional(),
  },
  access: "read",
  run: async (args, context) => {
    const status: MndaState[] = [
      ...(args.group ? mndaStatusGroups[args.group] : []),
      ...(args.states ?? []),
    ];
    const data = unwrap(
      await loadMndas({
        status: [...new Set(status)],
        mine: args.mine ?? false,
        q: args.search ?? "",
        page: args.page ?? 1,
        pageSize: args.pageSize ?? 25,
      }),
    );
    return {
      total: data.register.total,
      page: data.register.page,
      pageSize: data.register.pageSize,
      mndas: data.register.records.map((record) => mndaView(record, context)),
      sendingReady: data.ready,
      testMode: data.testMode,
    };
  },
});

export const getMnda = defineTool({
  name: "get_mnda",
  title: "Get an MNDA",
  description: "One MNDA with its signer, state, dates and links.",
  input: { id: z.uuid() },
  access: "read",
  run: async ({ id }, context) => {
    context.targets.mndaId = id;
    return mndaView(await readMnda(id), context);
  },
});

const draftFields = {
  company: z
    .string()
    .min(1)
    .max(180)
    .describe("The partner's legal company name"),
  signerName: z.string().min(1).max(180),
  signerEmail: z.email(),
  signerTitle: z.string().max(180).optional(),
  effectiveDate: z.iso.date().optional().describe("Defaults to today (UTC)"),
  detailsMode: z
    .enum(["team", "mixed"])
    .optional()
    .describe(
      "team (default): you supply every partner detail below. mixed: the partner fills in what you leave blank when they sign.",
    ),
  shortName: z.string().max(180).optional(),
  entityDescription: z
    .string()
    .max(180)
    .optional()
    .describe('Jurisdiction and entity type, such as "a Delaware corporation"'),
  streetAddress: z.string().max(180).optional(),
  locality: z
    .string()
    .max(180)
    .optional()
    .describe("City, region, postal code, country"),
  noticesContact: z.string().max(180).optional(),
  noticesEmail: z.email().optional(),
  countersignerId: z
    .uuid()
    .optional()
    .describe("Fil One countersigner; defaults to the default countersigner"),
};
type DraftFields = {
  [K in keyof typeof draftFields]?:
    z.infer<(typeof draftFields)[K]> | undefined;
};

async function prepareDraft(
  fields: DraftFields,
  supersedes: string[] | undefined,
  context: McpToolContext,
  id = crypto.randomUUID(),
) {
  const workspace = unwrap(await loadMndas({ pageSize: 25 }));
  const countersigner = fields.countersignerId
    ? workspace.signers.find(
        (signer) => signer.active && signer.id === fields.countersignerId,
      )
    : workspace.signers.find((signer) => signer.active && signer.isDefault);
  if (!countersigner)
    throw new McpToolError(
      "countersigner_unavailable",
      "No active Fil One countersigner was found. Pick one from the MNDA settings page.",
    );
  const record = unwrap(
    await prepareMnda({
      input: {
        id,
        detailsMode: fields.detailsMode ?? "team",
        company: fields.company,
        shortName: fields.shortName ?? "",
        entityDescription: fields.entityDescription ?? "",
        streetAddress: fields.streetAddress ?? "",
        locality: fields.locality ?? "",
        noticesContact: fields.noticesContact ?? "",
        noticesEmail: fields.noticesEmail ?? "",
        signerName: fields.signerName,
        signerEmail: fields.signerEmail,
        signerTitle: fields.signerTitle ?? "",
        countersignerId: countersigner.id,
        effectiveDate:
          fields.effectiveDate ?? new Date().toISOString().slice(0, 10),
      },
      ...(supersedes ? { supersedes } : {}),
    }),
  );
  context.targets.mndaId = record.id;
  const duplicates = await findMndaDuplicates({
    company: record.input.company,
    excludeId: record.id,
  });
  return {
    mnda: mndaView(record, context),
    next: `Review and send in Commerce: ${appLink(context, `/internal/mndas?q=${encodeURIComponent(record.input.company)}`)}. Sending is always done by a person in the app.`,
    ...(duplicates.ok &&
    (duplicates.value.mndas.length || duplicates.value.contracts.length)
      ? {
          alreadyOnFile: {
            mndas: duplicates.value.mndas.map((match) => ({
              id: match.id,
              company: match.company,
              state: match.state,
              owner: match.ownerName,
            })),
            contracts: duplicates.value.contracts.map((match) => ({
              id: match.id,
              counterparty: match.counterpartyName,
              status: match.status,
            })),
          },
        }
      : {}),
  };
}

export const createMndaDraft = defineTool({
  name: "create_mnda_draft",
  title: "Create an MNDA draft",
  description:
    "Prepares a Fil One mutual NDA draft from the approved template and renders its PDF for preview. Nothing is sent: a person reviews and sends it in Commerce. Returns the draft, a preview link, the link to send it from, and any MNDAs or contracts already on file for the same company.",
  input: {
    id: z
      .uuid()
      .optional()
      .describe(
        "Your own id for the new draft, so an identical retried call cannot create it twice",
      ),
    ...draftFields,
  },
  access: "write",
  run: ({ id, ...args }, context) => prepareDraft(args, undefined, context, id),
});

export const prepareMndaPreview = defineTool({
  name: "prepare_mnda_preview",
  title: "Preview or revise an MNDA draft",
  description:
    "Without changes, returns a draft's state and its preview link. With changes, renders a revised draft that replaces this one (the old draft is discarded) and returns the new draft and its preview link.",
  input: {
    id: z.uuid(),
    changes: z.object(draftFields).partial().strict().optional(),
  },
  access: "write",
  run: async ({ id, changes }, context) => {
    context.targets.mndaId = id;
    const current = await readMnda(id);
    if (!changes || Object.keys(changes).length === 0)
      return { mnda: mndaView(current, context) };
    if (!["draft", "ready"].includes(current.state))
      throw new McpToolError(
        "not_a_draft",
        "Only an unsent draft can be revised. Void it and prepare a new one instead.",
      );
    return prepareDraft(
      {
        ...current.input,
        detailsMode:
          current.input.detailsMode === "recipient"
            ? "mixed"
            : current.input.detailsMode,
        countersignerId: current.countersigner.id,
        ...changes,
      },
      [id],
      context,
    );
  },
});

export const checkMndaStatus = defineTool({
  name: "check_mnda_status",
  title: "Refresh an MNDA's status",
  description:
    "Asks SignWell for an outstanding MNDA's current status, as the Refresh button does, and returns the updated MNDA. Use get_mnda to read it without asking SignWell.",
  input: { id: z.uuid() },
  access: "write",
  run: async ({ id }, context) => {
    context.targets.mndaId = id;
    return {
      mnda: mndaView(
        unwrap(await operateMnda({ id, operation: "sync" })),
        context,
      ),
    };
  },
});

export const downloadSignedMnda = defineTool({
  name: "download_signed_mnda",
  title: "Download a signed MNDA",
  description:
    "The link to a completed MNDA's signed PDF, which opens in the app for anyone signed in with access. With includePdf: true the PDF also comes back inline when it is at most 4 MB. Every download is audited.",
  input: { id: z.uuid(), includePdf: z.boolean().optional() },
  access: "read",
  run: async ({ id, includePdf }, context) => {
    context.targets.mndaId = id;
    const session = await mndaStaff();
    const repository = mndaRepository();
    const record = await repository.get(id);
    if (record.state !== "completed")
      throw new McpToolError(
        "not_completed",
        `This MNDA is ${record.state}; only a completed MNDA has a signed PDF.`,
      );
    const link = appLink(context, mndaPdfHref(id, "executed", true));
    if (!includePdf) return { id, link };
    const bytes = await repository.readArtifact(id, "executed");
    await repository.recordAccess(mndaActor(session), {
      kind: "pdf",
      requestId: id,
      artifact: "executed",
    });
    if (bytes.length > inlinePdfLimit) return { id, link, inline: false };
    return {
      id,
      link,
      pdf: {
        mimeType: "application/pdf",
        base64: Buffer.from(bytes).toString("base64"),
      },
    };
  },
});

export const mndaTools = [
  listMndas,
  getMnda,
  createMndaDraft,
  prepareMndaPreview,
  checkMndaStatus,
  downloadSignedMnda,
];
