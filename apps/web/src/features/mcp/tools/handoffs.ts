// i18n-exempt-file: MCP tool names, descriptions and results are read by MCP clients and the model, not rendered in the interface
import "server-only";

import { z } from "zod";

import {
  handoffRequestedSides,
  handoffStatuses,
  type HandoffRequestRecord,
} from "@clockwork/contracts";

import { requestHandoff } from "@/src/features/internal-ops/handoff/actions";
import {
  loadHandoffQueue,
  loadOwnHandoffs,
} from "@/src/features/internal-ops/handoff/server";
import {
  contractReader,
  salesLibraryReader,
} from "@/src/features/internal-ops/contracts/demo-access";
import { sessionHas } from "@/src/features/internal-ops/contracts/server";

import {
  appLink,
  compact,
  defineTool,
  McpToolError,
  unwrap,
  type McpToolContext,
} from "../tool";

function handoffView(request: HandoffRequestRecord, context: McpToolContext) {
  return compact({
    id: request.id,
    counterparty: request.counterpartyLegalName,
    requestedSide: request.requestedSide,
    status: request.status,
    requestedBy: request.requestedByName,
    assignee: request.assigneeName,
    signer: `${request.signerName} <${request.signerEmail}>`,
    contractIds: request.contractIds,
    mndaId: request.mndaId,
    pricingScenarioId: request.pricingScenarioId,
    notes: request.notes,
    decisionNote: request.decisionNote,
    decidedAt: request.decidedAt,
    organizationId: request.organizationId,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    link: appLink(context, `/internal/handoffs/${request.id}`),
  });
}

export const createHandoffRequest = defineTool({
  name: "create_handoff_request",
  title: "Hand a signed contract to operations",
  description:
    "Asks operations to set up the counterparty of one or more signed contracts as a customer or partner organization. Optionally names the completed MNDA and a saved pricing scenario that go with them.",
  input: {
    id: z
      .uuid()
      .optional()
      .describe(
        "Your own id for the new record, so a retried call cannot create it twice",
      ),
    contractIds: z.array(z.uuid()).min(1).max(10),
    requestedSide: z.enum(handoffRequestedSides),
    counterpartyLegalName: z.string().min(1).max(200),
    signerName: z.string().min(1).max(200),
    signerEmail: z.email(),
    signerTitle: z.string().max(200).optional(),
    mndaId: z.uuid().optional(),
    pricingScenarioId: z.uuid().optional(),
    notes: z.string().max(4000).optional(),
  },
  access: "write",
  run: async (args, context) => {
    const id = args.id ?? crypto.randomUUID();
    context.targets.handoffId = id;
    const saved = unwrap(
      await requestHandoff({
        id,
        contractIds: args.contractIds,
        mndaId: args.mndaId ?? null,
        pricingScenarioId: args.pricingScenarioId ?? null,
        counterpartyLegalName: args.counterpartyLegalName,
        signerName: args.signerName,
        signerEmail: args.signerEmail,
        signerTitle: args.signerTitle ?? "",
        requestedSide: args.requestedSide,
        notes: args.notes ?? "",
      }),
    );
    return {
      id: saved.id,
      version: saved.version,
      link: appLink(context, `/internal/handoffs/${saved.id}`),
    };
  },
});

export const listHandoffs = defineTool({
  name: "list_handoffs",
  title: "List handoff requests",
  description:
    "Handoff requests. scope mine (default) lists the ones you raised; queue lists the operations queue, for people who may read it, optionally one status.",
  input: {
    scope: z.enum(["mine", "queue"]).optional(),
    status: z.enum(handoffStatuses).optional(),
  },
  access: "read",
  run: async ({ scope, status }, context) => {
    if ((scope ?? "mine") === "mine") {
      const own = await loadOwnHandoffs();
      if (!own) throw new McpToolError("CONTRACT_FORBIDDEN");
      return {
        handoffs: own
          .filter((request) => !status || request.status === status)
          .map((request) => handoffView(request, context)),
      };
    }
    const queue = await loadHandoffQueue(status);
    if (queue.kind !== "ready")
      throw new McpToolError(
        queue.kind === "forbidden" ? "CONTRACT_FORBIDDEN" : "UNAVAILABLE",
      );
    return {
      handoffs: queue.value.requests.map((request) =>
        handoffView(request, context),
      ),
    };
  },
});

export const listSalesLibrary = defineTool({
  name: "list_sales_library",
  title: "List the sales library",
  description:
    "Current and archived sales collateral (decks, one-pagers, pricing sheets, case studies) with download links for PDFs and the address for links. Downloads through the app are audited.",
  input: {
    audience: z.enum(["customer", "partner"]).optional(),
    includeArchived: z.boolean().optional(),
  },
  access: "read",
  run: async ({ audience, includeArchived }, context) => {
    const session = await contractReader("sales:read");
    const items = await salesLibraryReader().list();
    return {
      canManage: sessionHas(session, "collateral:manage"),
      items: items
        .filter(
          (item) =>
            (includeArchived || item.status === "current") &&
            (!audience || item.audience === audience),
        )
        .map((item) =>
          compact({
            id: item.id,
            title: item.title,
            description: item.description,
            kind: item.kind,
            audience: item.audience,
            status: item.status,
            contentUpdatedOn: item.contentUpdatedOn,
            url: item.linkUrl,
            download: item.file
              ? appLink(context, `/internal/sales-library/items/${item.id}`)
              : undefined,
            fileName: item.file?.fileName,
            sizeBytes: item.file?.sizeBytes,
          }),
        ),
    };
  },
});

export const handoffTools = [createHandoffRequest, listHandoffs];
export const libraryTools = [listSalesLibrary];
