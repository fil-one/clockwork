// i18n-exempt-file: MCP tool names, descriptions and results are read by MCP clients and the model, not rendered in the interface
import "server-only";

import { z } from "zod";

import {
  addPartnerDays,
  partnerCurrencies,
  partnerDealModels,
  partnerDealStatuses,
  partnerDueFilters,
  partnerExclusivity,
  partnerModels,
  partnerSizeUnits,
  partnerStatuses,
  PartnerListQuerySchema,
  type PartnerDealWithConflicts,
  type PartnerRecord,
} from "@clockwork/contracts";

import {
  savePartner,
  savePartnerDeal,
} from "@/src/features/internal-ops/partners/actions";
import {
  loadPartner,
  partnerRepository,
  partnerToday,
} from "@/src/features/internal-ops/partners/server";
import { contractStaff } from "@/src/features/internal-ops/contracts/server";

import {
  appLink,
  compact,
  defineTool,
  loaded,
  McpToolError,
  unwrap,
  type McpToolContext,
} from "../tool";

const partnerLink = (context: McpToolContext, id: string) =>
  appLink(context, `/internal/partners/${id}`);

function partnerView(partner: PartnerRecord) {
  return compact({
    id: partner.id,
    name: partner.name,
    website: partner.website,
    region: partner.region,
    models: partner.models,
    status: partner.status,
    owner: partner.ownerName,
    ownerId: partner.ownerId,
    organization: partner.organizationName,
    organizationId: partner.organizationId,
    contacts: partner.contacts,
    nextStep: partner.nextStep,
    nextStepDue: partner.nextStepDue,
    notes: partner.notes,
    terms: partner.terms,
    createdBy: partner.createdByName,
    updatedAt: partner.updatedAt,
    version: partner.version,
  });
}

function dealView(deal: PartnerDealWithConflicts) {
  return compact({
    id: deal.id,
    partnerId: deal.partnerId,
    endClient: deal.endClient,
    organization: deal.organizationName,
    registeredOn: deal.registeredOn,
    protectedUntil: deal.protectedUntil,
    estimatedSize:
      deal.estimatedSize && deal.sizeUnit
        ? `${deal.estimatedSize} ${deal.sizeUnit}`
        : undefined,
    model: deal.model,
    status: deal.status,
    notes: deal.notes,
    createdBy: deal.createdByName,
    updatedAt: deal.updatedAt,
    version: deal.version,
    overlaps: deal.conflicts.map((conflict) => ({
      partner: conflict.partnerName,
      partnerId: conflict.partnerId,
      endClient: conflict.endClient,
      status: conflict.status,
      protectedUntil: conflict.protectedUntil,
    })),
  });
}

export const listPartners = defineTool({
  name: "list_partners",
  title: "List partners",
  description:
    "Channel, referral and technology partners, most recently changed first: status, models, owner, next step, headline commission and margin, and open deal counts. Filter by text, status, model, owner, your own, or next steps overdue or due this week. Use limit and the returned nextCursor as cursor to continue with the same filters.",
  input: {
    search: z.string().max(100).optional(),
    status: z.enum(partnerStatuses).optional(),
    model: z.enum(partnerModels).optional(),
    ownerId: z.uuid().optional(),
    mine: z.boolean().optional(),
    due: z.enum(partnerDueFilters).optional(),
    limit: z.int().min(1).max(100).optional(),
    cursor: z.string().min(1).max(500).optional(),
  },
  access: "read",
  run: async (args, context) => {
    const session = await contractStaff("sales:read");
    const repository = partnerRepository();
    const query = PartnerListQuerySchema.parse({
      ...(args.search ? { q: args.search } : {}),
      ...(args.status ? { status: args.status } : {}),
      ...(args.model ? { model: args.model } : {}),
      ...(args.ownerId ? { owner: args.ownerId } : {}),
      ...(args.mine ? { mine: "1" } : {}),
      ...(args.due ? { due: args.due } : {}),
    });
    const [page, owners] = await Promise.all([
      repository.listPage(
        query,
        { viewerId: session.userId, today: partnerToday() },
        {
          ...(args.limit !== undefined ? { limit: args.limit } : {}),
          ...(args.cursor !== undefined ? { cursor: args.cursor } : {}),
        },
      ),
      repository.owners(),
    ]);
    return {
      nextCursor: page.nextCursor,
      partners: page.rows.map((row) =>
        compact({ ...row, link: partnerLink(context, row.id) }),
      ),
      owners,
    };
  },
});

export const getPartner = defineTool({
  name: "get_partner",
  title: "Get a partner",
  description:
    "One partner with its contacts, terms, registered deals (with overlapping registrations by other partners), linked MNDAs and contracts, and recent history.",
  input: { id: z.uuid() },
  access: "read",
  run: async ({ id }, context) => {
    context.targets.partnerId = id;
    const detail = loaded(await loadPartner(id));
    return {
      partner: partnerView(detail.partner),
      deals: detail.deals.map(dealView),
      links: detail.links,
      protectionDays: detail.protectionDays,
      history: detail.activity.slice(0, 20),
      link: partnerLink(context, id),
    };
  },
});

const contact = z
  .object({
    name: z.string().min(1).max(200),
    email: z.email().optional(),
    role: z.string().max(200).optional(),
  })
  .strict();

const terms = z
  .object({
    commissionPct: z.string().nullable().optional().describe('Such as "17.5"'),
    commissionSchedule: z.string().max(500).optional(),
    commissionSteps: z
      .array(
        z
          .object({ fromMonth: z.number().int().min(1), ratePct: z.string() })
          .strict(),
      )
      .optional(),
    marginPct: z.string().nullable().optional(),
    territory: z.string().max(500).optional(),
    exclusivity: z.enum(partnerExclusivity).nullable().optional(),
    exclusivityNote: z.string().max(500).optional(),
    currency: z.enum(partnerCurrencies).nullable().optional(),
    nfrAllowance: z.string().max(500).optional(),
    trialPeriod: z.string().max(200).optional(),
    trialTargets: z.string().max(2000).optional(),
    rows: z
      .array(
        z
          .object({
            label: z.string().min(1).max(120),
            value: z.string().min(1).max(500),
            notes: z.string().max(1000).optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

const partnerFields = {
  name: z.string().min(1).max(200),
  website: z.string().max(500).optional(),
  region: z.string().max(500).optional(),
  models: z.array(z.enum(partnerModels)).optional(),
  status: z.enum(partnerStatuses).optional(),
  ownerId: z.uuid().nullable().optional().describe("A staff member's user id"),
  organizationId: z.uuid().nullable().optional(),
  contacts: z.array(contact).max(20).optional(),
  nextStep: z.string().max(500).optional(),
  nextStepDue: z.iso.date().nullable().optional(),
  notes: z.string().max(8000).optional(),
  terms: terms.optional(),
};

export const createPartner = defineTool({
  name: "create_partner",
  title: "Create a partner",
  description:
    "Records a new partner with whatever is known so far; terms can be filled in later with update_partner.",
  input: {
    id: z
      .uuid()
      .optional()
      .describe(
        "Your own id for the new record, so a retried call cannot create it twice",
      ),
    ...partnerFields,
  },
  access: "write",
  run: async ({ id: requested, ...args }, context) => {
    const id = requested ?? crypto.randomUUID();
    context.targets.partnerId = id;
    const saved = unwrap(
      await savePartner({ id, ...args, ownerId: args.ownerId ?? null }),
    );
    return {
      id: saved.id,
      version: saved.version,
      link: partnerLink(context, id),
    };
  },
});

export const updatePartner = defineTool({
  name: "update_partner",
  title: "Update a partner",
  description:
    "Edits a partner. Pass the version you read (get_partner); a change saved by someone else since then is refused, so read again and retry. Fields left out keep their values; terms fields merge into the existing terms.",
  input: {
    id: z.uuid(),
    expectedVersion: z.number().int().min(1),
    ...partnerFields,
    name: partnerFields.name.optional(),
  },
  access: "write",
  run: async (
    { id, expectedVersion, terms: changedTerms, ...changes },
    context,
  ) => {
    context.targets.partnerId = id;
    const { partner } = loaded(await loadPartner(id));
    const saved = unwrap(
      await savePartner({
        id,
        expectedVersion,
        name: changes.name ?? partner.name,
        website: changes.website ?? partner.website,
        region: changes.region ?? partner.region,
        models: changes.models ?? partner.models,
        status: changes.status ?? partner.status,
        ownerId:
          changes.ownerId !== undefined ? changes.ownerId : partner.ownerId,
        organizationId:
          changes.organizationId !== undefined
            ? changes.organizationId
            : partner.organizationId,
        contacts: changes.contacts ?? partner.contacts,
        nextStep: changes.nextStep ?? partner.nextStep,
        nextStepDue:
          changes.nextStepDue !== undefined
            ? changes.nextStepDue
            : partner.nextStepDue,
        notes: changes.notes ?? partner.notes,
        terms: { ...partner.terms, ...changedTerms },
      }),
    );
    return {
      id: saved.id,
      version: saved.version,
      link: partnerLink(context, id),
    };
  },
});

export const listPartnerDeals = defineTool({
  name: "list_partner_deals",
  title: "List a partner's deals",
  description:
    "The deals a partner registered, with protection dates and overlapping registrations by other partners.",
  input: { partnerId: z.uuid() },
  access: "read",
  run: async ({ partnerId }, context) => {
    context.targets.partnerId = partnerId;
    const detail = loaded(await loadPartner(partnerId));
    return {
      partner: { id: detail.partner.id, name: detail.partner.name },
      deals: detail.deals.map(dealView),
      link: partnerLink(context, partnerId),
    };
  },
});

const dealFields = {
  endClient: z.string().min(1).max(200),
  organizationId: z.uuid().nullable().optional(),
  registeredOn: z.iso.date().optional().describe("Defaults to today"),
  protectedUntil: z.iso
    .date()
    .nullable()
    .optional()
    .describe("Empty takes the channel policy's protection period"),
  estimatedSize: z.string().nullable().optional().describe('Such as "250"'),
  sizeUnit: z.enum(partnerSizeUnits).nullable().optional(),
  model: z.enum(partnerDealModels).optional(),
  status: z.enum(partnerDealStatuses).optional(),
  notes: z.string().max(4000).optional(),
};

function dealResult(
  saved: { id: string; version: number; status: string; conflicts: unknown[] },
  partnerId: string,
  context: McpToolContext,
) {
  return {
    id: saved.id,
    version: saved.version,
    status: saved.status,
    ...(saved.conflicts.length
      ? {
          warning:
            "Another partner has an open registration for this end client. Saved anyway.",
          overlaps: saved.conflicts,
        }
      : {}),
    link: partnerLink(context, partnerId),
  };
}

export const registerPartnerDeal = defineTool({
  name: "register_partner_deal",
  title: "Register a partner deal",
  description:
    "Registers a deal for a partner. Overlapping open registrations by other partners come back as a warning; they never block the save.",
  input: {
    partnerId: z.uuid(),
    id: z
      .uuid()
      .optional()
      .describe(
        "Your own id for the new record, so a retried call cannot create it twice",
      ),
    ...dealFields,
  },
  access: "write",
  run: async ({ partnerId, id: requested, ...deal }, context) => {
    const id = requested ?? crypto.randomUUID();
    context.targets.partnerId = partnerId;
    context.targets.dealId = id;
    const saved = unwrap(
      await savePartnerDeal({
        id,
        partnerId,
        ...deal,
        registeredOn: deal.registeredOn ?? partnerToday(),
      }),
    );
    return dealResult(saved, partnerId, context);
  },
});

export const updatePartnerDeal = defineTool({
  name: "update_partner_deal",
  title: "Update a partner deal",
  description:
    "Edits a registered deal, such as moving its status to won or lost. Pass the version you read; fields left out keep their values.",
  input: {
    partnerId: z.uuid(),
    dealId: z.uuid(),
    expectedVersion: z.number().int().min(1),
    ...dealFields,
    endClient: dealFields.endClient.optional(),
  },
  access: "write",
  run: async ({ partnerId, dealId, expectedVersion, ...changes }, context) => {
    context.targets.partnerId = partnerId;
    context.targets.dealId = dealId;
    const { deals } = loaded(await loadPartner(partnerId));
    const deal = deals.find((candidate) => candidate.id === dealId);
    if (!deal) throw new McpToolError("PARTNER_DEAL_NOT_FOUND");
    const pick = <K extends keyof typeof changes>(key: K, current: unknown) =>
      changes[key] !== undefined ? changes[key] : current;
    const saved = unwrap(
      await savePartnerDeal({
        id: dealId,
        partnerId,
        expectedVersion,
        endClient: pick("endClient", deal.endClient),
        organizationId: pick("organizationId", deal.organizationId),
        registeredOn: pick("registeredOn", deal.registeredOn),
        protectedUntil: pick("protectedUntil", deal.protectedUntil),
        estimatedSize: pick("estimatedSize", deal.estimatedSize),
        sizeUnit: pick("sizeUnit", deal.sizeUnit),
        model: pick("model", deal.model),
        status: pick("status", deal.status),
        notes: pick("notes", deal.notes),
      }),
    );
    return dealResult(saved, partnerId, context);
  },
});

export const partnerNextStepsDue = defineTool({
  name: "partner_next_steps_due",
  title: "Partner next steps due",
  description:
    "Partners whose next step is overdue or due within the next N days (default 7), earliest first; only yours with mine: true.",
  input: {
    withinDays: z.number().int().min(0).max(90).optional(),
    mine: z.boolean().optional(),
  },
  access: "read",
  run: async ({ withinDays, mine }, context) => {
    const session = await contractStaff("sales:read");
    const today = partnerToday();
    const due = await partnerRepository().nextStepsDue({
      today,
      through: addPartnerDays(today, withinDays ?? 7),
      ...(mine ? { ownerId: session.userId } : {}),
    });
    return {
      today,
      due: due.map((row) =>
        compact({ ...row, link: partnerLink(context, row.partnerId) }),
      ),
    };
  },
});

export const partnerTools = [
  listPartners,
  getPartner,
  createPartner,
  updatePartner,
  listPartnerDeals,
  registerPartnerDeal,
  updatePartnerDeal,
  partnerNextStepsDue,
];
