import "server-only";

import { createHash } from "node:crypto";

import {
  canonicalHubSpotJson,
  cleanHubSpotText,
  hubspotBaseProperties,
  hubspotContactEmail,
  hubspotContactName,
  hubspotDealLinkState,
  hubspotFreshness,
  hubspotLimits,
  hubspotRecordUrl,
  normalizeHubSpotWebsite,
  parseHubSpotRecordUrl,
  summarizeHubSpotPipeline,
  type HubSpotAssociation,
  type HubSpotConnectionRecord,
  type HubSpotDeal,
  type HubSpotFieldHistory,
  type HubSpotFile,
  type HubSpotImportRecord,
  type HubSpotLinkRecord,
  type HubSpotNoteReference,
  type HubSpotObjectType,
  type HubSpotOwner,
  type HubSpotPipeline,
  type HubSpotPipelineDeal,
  type HubSpotPipelineQuery,
  type HubSpotPortal,
  type HubSpotPropertyDefinition,
  type HubSpotSearchResult,
  type HubSpotSourceValue,
} from "@clockwork/contracts";
import { HubSpotRepository } from "@clockwork/db";
import {
  FakeHubSpotReader,
  HttpHubSpotReader,
  HubSpotError,
  type HubSpotReader,
} from "@clockwork/integrations/hubspot";

import { explicitDemoIdentityEnabled } from "@/src/auth/session";
import { getOptionalServiceDatabase } from "@/src/db/service";
import { demoNow } from "@/src/features/experience-server/demo-clock";

import type { DealCompanyChoice, HandoffSource } from "./model";

/**
 * Why HubSpot data cannot be shown: no token in this deployment, no approved
 * connection, or a token that now reaches a different portal.
 */
export type HubSpotUnavailableCode =
  | "HUBSPOT_NOT_CONFIGURED"
  | "HUBSPOT_NOT_CONNECTED"
  | "HUBSPOT_PORTAL_MISMATCH";

export class HubSpotUnavailableError extends Error {
  constructor(readonly code: HubSpotUnavailableCode) {
    super(code);
  }
}

/** Commerce's own HubSpot records: the connection, links and imports. */
export type HubSpotStore = Pick<
  HubSpotRepository,
  | "connection"
  | "partnersForCompanies"
  | "linkForPartner"
  | "imports"
  | "import"
  | "fieldHistory"
  | "similarPartners"
>;

export interface HubSpotContext {
  connection: HubSpotConnectionRecord;
  reader: HubSpotReader;
  portal: HubSpotPortal;
  store: HubSpotStore;
  demo: boolean;
}

/** The token for this deployment's portal. It never leaves the server. */
function configuredReader(): HubSpotReader | null {
  const token = process.env.HUBSPOT_ACCESS_TOKEN?.trim();
  return token ? new HttpHubSpotReader({ accessToken: token }) : null;
}

/**
 * Whether sellers can bring HubSpot records in here: the demo always can; a
 * deployment needs a token and an approved connection. Never throws, so a
 * page that only offers the entry point is not taken down by it.
 */
export async function hubspotReady(): Promise<boolean> {
  if (explicitDemoIdentityEnabled()) return true;
  if (!process.env.HUBSPOT_ACCESS_TOKEN?.trim()) return false;
  try {
    return (await hubspotRepository().connection()).active !== null;
  } catch {
    return false;
  }
}

export function hubspotRepository(): HubSpotRepository {
  const database = getOptionalServiceDatabase();
  if (!database) throw new Error("HUBSPOT_UNAVAILABLE");
  return new HubSpotRepository(database);
}

// ---------------------------------------------------------------------------
// The guided demo: a fictional portal, one linked partner, no writes.
// ---------------------------------------------------------------------------

const demoPortal = { portalId: "4410", uiDomain: "app.hubspot.com" };
const demoLinkedPartner = {
  companyId: "9003",
  id: "019a44af-0000-7000-8000-0000000000a1",
  name: "Larchmont Data Services",
};

function demoConnection(now: Date): HubSpotConnectionRecord {
  return {
    id: "019a44af-0000-7000-8000-0000000000c1",
    ...demoPortal,
    status: "active",
    audience: "staff_sales_read",
    approvedById: "019a44af-0000-7000-8000-0000000000f1",
    // i18n-exempt: a fictional administrator's name in demo data
    approvedByName: "Jonah Pike",
    approvedAt: new Date(now.getTime() - 30 * 86_400_000).toISOString(),
    scope: {
      company: ["industry", "partner_tier"],
      deal: ["deal_source"],
      contact: [],
      notes: true,
      files: true,
    },
    defaultPipelineId: "default",
    ownerMappings: [],
    updatedAt: new Date(now.getTime() - 30 * 86_400_000).toISOString(),
    version: 1,
  };
}

function demoStore(now: Date): HubSpotStore {
  const connection = demoConnection(now);
  const link: HubSpotLinkRecord = {
    id: "019a44af-0000-7000-8000-0000000000c2",
    portalId: demoPortal.portalId,
    companyId: demoLinkedPartner.companyId,
    partnerId: demoLinkedPartner.id,
    partnerName: demoLinkedPartner.name,
    companyName: demoLinkedPartner.name,
    // i18n-exempt: a fictional seller's name in demo data
    createdByName: "Jonah Pike",
    createdAt: new Date(now.getTime() - 20 * 86_400_000).toISOString(),
  };
  return {
    connection: () =>
      Promise.resolve({ active: connection, latest: connection }),
    partnersForCompanies: (_portalId, ids) =>
      Promise.resolve(
        new Map(
          ids.includes(demoLinkedPartner.companyId)
            ? [
                [
                  demoLinkedPartner.companyId,
                  { id: demoLinkedPartner.id, name: demoLinkedPartner.name },
                ],
              ]
            : [],
        ),
      ),
    linkForPartner: (partnerId) =>
      Promise.resolve(partnerId === demoLinkedPartner.id ? link : null),
    imports: () => Promise.resolve([]),
    import: () => Promise.reject(new Error("HUBSPOT_IMPORT_NOT_FOUND")),
    fieldHistory: () => Promise.resolve({}),
    similarPartners: ({ name }) =>
      Promise.resolve(
        name.toLowerCase().includes("larchmont")
          ? [
              {
                id: demoLinkedPartner.id,
                name: demoLinkedPartner.name,
                website: "https://larchmont.example",
                reason: "name" as const,
                linkedCompanyId: demoLinkedPartner.companyId,
              },
            ]
          : [],
      ),
  };
}

// ---------------------------------------------------------------------------
// The connection gate every read and import passes.
// ---------------------------------------------------------------------------

/**
 * The approved connection with a reader for it. Checked on every request
 * against the database, so a disconnect hides live data at once; the portal
 * the token reaches must be the approved one.
 */
export async function hubspotContext(): Promise<HubSpotContext> {
  if (explicitDemoIdentityEnabled()) {
    const now = demoNow();
    const reader = new FakeHubSpotReader(now);
    return {
      connection: demoConnection(now),
      reader,
      portal: await reader.portal(),
      store: demoStore(now),
      demo: true,
    };
  }
  const store = hubspotRepository();
  const reader = configuredReader();
  const { active } = await store.connection();
  if (!active) throw new HubSpotUnavailableError("HUBSPOT_NOT_CONNECTED");
  if (!reader) throw new HubSpotUnavailableError("HUBSPOT_NOT_CONFIGURED");
  const { value: portal } = await cached(active, "portal", () =>
    reader.portal(),
  );
  if (portal.portalId !== active.portalId)
    throw new HubSpotUnavailableError("HUBSPOT_PORTAL_MISMATCH");
  return { connection: active, reader, portal, store, demo: false };
}

/**
 * What an administrator chooses from: every property HubSpot defines beyond
 * the base set, the deal pipelines and the active owners. Read directly,
 * since no connection exists yet when the scope is first approved.
 */
export async function settingsCatalog() {
  const reader = configuredReader();
  if (!reader) return null;
  const [company, deal, contact, pipelineList, ownerList] = await Promise.all([
    reader.properties("company"),
    reader.properties("deal"),
    reader.properties("contact"),
    reader.pipelines(),
    reader.owners(),
  ]);
  return {
    properties: [...company, ...deal, ...contact].filter(
      (property) =>
        !(
          hubspotBaseProperties[property.objectType] as readonly string[]
        ).includes(property.name),
    ),
    pipelines: pipelineList,
    owners: ownerList.filter((owner) => !owner.archived),
  };
}

/** The portal the configured token reaches, for the administrator. */
export async function configuredPortal(): Promise<HubSpotPortal | null> {
  if (explicitDemoIdentityEnabled()) return demoPortal as HubSpotPortal;
  const reader = configuredReader();
  return reader ? reader.portal() : null;
}

// ---------------------------------------------------------------------------
// A short display cache. Keys carry the connection ID and version, so a
// changed scope or a disconnect never serves an earlier answer; the gate
// above runs before any cached value is read.
// ---------------------------------------------------------------------------

interface Entry {
  at: number;
  value: unknown;
  pending: Promise<unknown> | null;
}
const cache = new Map<string, Entry>();
const cacheLimit = 200;

/**
 * A value at most `hubspotFreshness.targetMs` old. When HubSpot is briefly
 * unavailable the last answer is served marked stale, with its age; any
 * other failure is raised.
 */
export async function cached<T>(
  connection: Pick<HubSpotConnectionRecord, "id" | "version">,
  key: string,
  load: () => Promise<T>,
  options: { refresh?: boolean } = {},
): Promise<{ value: T; checkedAt: string; stale: boolean }> {
  const full = `${connection.id}:${connection.version}:${key}`;
  const entry = cache.get(full);
  const fresh =
    entry &&
    entry.pending === null &&
    Date.now() - entry.at < hubspotFreshness.targetMs &&
    !options.refresh;
  if (fresh)
    return {
      value: entry.value as T,
      checkedAt: new Date(entry.at).toISOString(),
      stale: false,
    };
  // Concurrent readers share one request rather than each calling HubSpot.
  const pending = entry?.pending ?? load();
  if (entry) entry.pending = pending;
  else {
    if (cache.size >= cacheLimit) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(full, { at: 0, value: undefined, pending });
  }
  try {
    const value = (await pending) as T;
    cache.set(full, { at: Date.now(), value, pending: null });
    return { value, checkedAt: new Date().toISOString(), stale: false };
  } catch (error) {
    const previous = cache.get(full);
    if (previous) previous.pending = null;
    const transient =
      error instanceof HubSpotError &&
      (error.code === "HUBSPOT_UNAVAILABLE" ||
        error.code === "HUBSPOT_RATE_LIMITED");
    if (transient && previous && previous.at > 0)
      return {
        value: previous.value as T,
        checkedAt: new Date(previous.at).toISOString(),
        stale: true,
      };
    if (previous && previous.at === 0) cache.delete(full);
    throw error;
  }
}

/** Drops every cached answer, after a disconnect or a scope change. */
export function clearHubSpotCache() {
  cache.clear();
}

const owners = (context: HubSpotContext) =>
  cached(context.connection, "owners", () => context.reader.owners());
const pipelines = (context: HubSpotContext) =>
  cached(context.connection, "pipelines", () => context.reader.pipelines());
export const propertyDefinitions = (
  context: Pick<HubSpotContext, "connection" | "reader">,
  objectType: HubSpotObjectType,
) =>
  cached(context.connection, `properties:${objectType}`, () =>
    context.reader.properties(objectType),
  );

export async function hubspotOwners(context: HubSpotContext) {
  return (await owners(context)).value;
}

export async function hubspotPipelines(context: HubSpotContext) {
  return (await pipelines(context)).value;
}

const ownerRef = (
  ownerId: string | null,
  list: readonly HubSpotOwner[],
): { id: string; name: string | null } | null =>
  ownerId
    ? {
        id: ownerId,
        name: list.find((owner) => owner.id === ownerId)?.name ?? null,
      }
    : null;

function stageOf(list: readonly HubSpotPipeline[], deal: HubSpotDeal) {
  const pipeline = list.find((p) => p.id === deal.pipelineId);
  const stage = pipeline?.stages.find((s) => s.id === deal.stageId);
  return {
    pipeline: { id: deal.pipelineId, label: pipeline?.label ?? null },
    stage: {
      id: deal.stageId,
      label: stage?.label ?? null,
      closed: stage ? stage.closed : null,
    },
  };
}

/** Approved, non-sensitive additional properties of one object type. */
async function approvedProperties(
  context: HubSpotContext,
  objectType: HubSpotObjectType,
): Promise<HubSpotPropertyDefinition[]> {
  const approved = context.connection.scope[objectType];
  if (!approved.length) return [];
  const definitions = (await propertyDefinitions(context, objectType)).value;
  // A property HubSpot now marks sensitive, or that no longer exists, is not
  // read even if it was approved before.
  return definitions.filter(
    (definition) => approved.includes(definition.name) && !definition.sensitive,
  );
}

const sourceValues = (
  objectType: "company" | "deal",
  definitions: readonly HubSpotPropertyDefinition[],
  values: Readonly<Record<string, string | null>>,
): HubSpotSourceValue[] =>
  definitions.map((definition) => ({
    objectType,
    property: definition.name,
    label: definition.label,
    type: definition.type,
    value: values[definition.name] ?? null,
  }));

const digest = (value: unknown) =>
  createHash("sha256").update(canonicalHubSpotJson(value)).digest("hex");

function mergeAssociations(
  lists: readonly (readonly HubSpotAssociation[])[],
): HubSpotAssociation[] {
  const byId = new Map<string, Set<string>>();
  for (const list of lists)
    for (const item of list) {
      const labels = byId.get(item.id) ?? new Set<string>();
      for (const label of item.labels) labels.add(label);
      byId.set(item.id, labels);
    }
  return [...byId.entries()].map(([id, labels]) => ({
    id,
    labels: [...labels],
  }));
}

/**
 * Everything the review shows, read now through the approved scope. A deal
 * must be associated with the company; an archived company cannot be
 * brought in.
 */
export async function loadHandoffSource(
  context: HubSpotContext,
  input: { companyId: string; dealId: string | null },
): Promise<HandoffSource> {
  const { reader, connection } = context;
  const scope = connection.scope;
  const [companyProps, dealProps] = await Promise.all([
    approvedProperties(context, "company"),
    input.dealId ? approvedProperties(context, "deal") : Promise.resolve([]),
  ]);
  const [[company], ownerList, pipelineList] = await Promise.all([
    reader.companies(
      [input.companyId],
      [...hubspotBaseProperties.company, ...companyProps.map((p) => p.name)],
    ),
    owners(context).then((result) => result.value),
    input.dealId
      ? pipelines(context).then((result) => result.value)
      : Promise.resolve([]),
  ]);
  if (!company) throw new HubSpotError("HUBSPOT_RECORD_NOT_FOUND");
  if (company.archived) throw new Error("HUBSPOT_RECORD_ARCHIVED");

  let deal: HandoffSource["deal"] = null;
  let dealContacts: HubSpotAssociation[] = [];
  let dealNotes: HubSpotAssociation[] = [];
  if (input.dealId) {
    const [found] = await reader.deals(
      [input.dealId],
      [...hubspotBaseProperties.deal, ...dealProps.map((p) => p.name)],
    );
    if (!found || found.archived)
      throw new HubSpotError("HUBSPOT_RECORD_NOT_FOUND");
    const associated = await reader.associations("deal", found.id, "company");
    // A deal with no company keeps its context on the company chosen for
    // it; one with companies must be associated with the chosen one.
    if (associated.length && !associated.some((item) => item.id === company.id))
      throw new Error("HUBSPOT_NOT_ASSOCIATED");
    const companies = await reader.companies(
      associated.map((item) => item.id),
      ["name"],
    );
    [dealContacts, dealNotes] = await Promise.all([
      reader.associations("deal", found.id, "contact"),
      scope.notes || scope.files
        ? reader.associations("deal", found.id, "note")
        : Promise.resolve([]),
    ]);
    deal = {
      reference: {
        id: found.id,
        url: hubspotRecordUrl(context.portal, "deal", found.id),
        name: cleanHubSpotText(found.name, 200) || found.id,
        ...stageOf(pipelineList, found),
        amount: found.amount,
        currency: found.currency,
        closeDate: found.closeDate,
        owner: ownerRef(found.ownerId, ownerList),
        associatedCompanies: associated.map((item) => ({
          id: item.id,
          name:
            cleanHubSpotText(
              companies.find((c) => c.id === item.id)?.name ?? null,
              200,
            ) || item.id,
          labels: item.labels,
        })),
        updatedAt: found.updatedAt,
      },
      values: sourceValues("deal", dealProps, found.properties),
    };
  }

  const [companyContacts, companyNotes] = await Promise.all([
    reader.associations("company", company.id, "contact"),
    scope.notes || scope.files
      ? reader.associations("company", company.id, "note")
      : Promise.resolve([]),
  ]);
  const people = mergeAssociations([companyContacts, dealContacts]).slice(
    0,
    hubspotLimits.associations,
  );
  const contactRows = await reader.contacts(
    people.map((person) => person.id),
    [...hubspotBaseProperties.contact, ...scope.contact],
  );
  const contacts = people.flatMap((person) => {
    const row = contactRows.find((contact) => contact.id === person.id);
    if (!row) return [];
    return [
      {
        id: row.id,
        // i18n-exempt: a stored placeholder for a HubSpot contact with no name or email
        name: hubspotContactName(row) || `HubSpot ${row.id}`,
        email: hubspotContactEmail(row),
        role: cleanHubSpotText(row.jobTitle, 200),
        labels: person.labels,
      },
    ];
  });

  let notes: HubSpotNoteReference[] | null = null;
  let files: HubSpotFile[] | null = null;
  if (scope.notes || scope.files) {
    const noteIds = mergeAssociations([companyNotes, dealNotes])
      .map((note) => note.id)
      .slice(0, 50);
    const noteRows = (await reader.notes(noteIds))
      .sort((a, b) => (b.timestamp ?? "").localeCompare(a.timestamp ?? ""))
      .slice(0, hubspotLimits.notesPerHandoff);
    if (scope.notes)
      notes = noteRows.map((note) => ({
        id: note.id,
        body: note.body,
        authorName: note.ownerId
          ? (ownerList.find((owner) => owner.id === note.ownerId)?.name ?? null)
          : null,
        timestamp: note.timestamp,
      }));
    if (scope.files) {
      const attachments = noteRows
        .flatMap((note) =>
          note.attachmentIds.map((fileId) => ({ fileId, noteId: note.id })),
        )
        .slice(0, 20);
      files = await Promise.all(
        attachments.map(
          async ({ fileId, noteId }) =>
            (await reader.file(fileId, noteId)) ?? {
              id: fileId,
              name: fileId,
              extension: null,
              size: null,
              updatedAt: null,
              availability: "unreadable" as const,
              noteId,
            },
        ),
      );
    }
  }

  const proposed = {
    name: cleanHubSpotText(company.name, 200),
    website: normalizeHubSpotWebsite(company.website, company.domain),
    region: cleanHubSpotText(company.country, 500),
  };
  const companyValues = sourceValues(
    "company",
    companyProps,
    company.properties,
  );
  const digests: Record<string, string> = {
    company: digest({
      name: company.name,
      domain: company.domain,
      website: company.website,
      country: company.country,
      values: companyValues,
    }),
  };
  if (deal) digests.deal = digest(deal);
  for (const contact of contacts)
    digests[`contact:${contact.id}`] = digest(contact);
  for (const note of notes ?? []) digests[`note:${note.id}`] = digest(note);
  for (const file of files ?? [])
    digests[`file:${file.id}`] = digest({
      name: file.name,
      size: file.size,
      updatedAt: file.updatedAt,
      availability: file.availability,
    });

  return {
    portal: {
      portalId: context.portal.portalId,
      uiDomain: context.portal.uiDomain,
    },
    retrievedAt: new Date().toISOString(),
    company: {
      id: company.id,
      url: hubspotRecordUrl(context.portal, "company", company.id),
      name: cleanHubSpotText(company.name, 200) || company.id,
      domain: cleanHubSpotText(company.domain, 500),
      website: company.website,
      country: company.country,
      updatedAt: company.updatedAt,
      owner: ownerRef(company.ownerId, ownerList),
    },
    proposed,
    companyValues,
    deal,
    contacts,
    notes,
    files,
    digests,
  };
}

/** A deal and its companies, none chosen, for picking the partner. */
export async function loadDealChoice(
  context: HubSpotContext,
  dealId: string,
): Promise<DealCompanyChoice> {
  const [[deal], pipelineList] = await Promise.all([
    context.reader.deals([dealId], [...hubspotBaseProperties.deal]),
    hubspotPipelines(context),
  ]);
  if (!deal || deal.archived)
    throw new HubSpotError("HUBSPOT_RECORD_NOT_FOUND");
  const associated = await context.reader.associations(
    "deal",
    dealId,
    "company",
  );
  const [companies, links] = await Promise.all([
    context.reader.companies(
      associated.map((item) => item.id),
      ["name"],
    ),
    context.store.partnersForCompanies(
      context.connection.portalId,
      associated.map((item) => item.id),
    ),
  ]);
  return {
    deal: {
      id: deal.id,
      name: cleanHubSpotText(deal.name, 200) || deal.id,
      url: hubspotRecordUrl(context.portal, "deal", deal.id),
      stageLabel: stageOf(pipelineList, deal).stage.label,
    },
    companies: associated.map((item) => ({
      id: item.id,
      name:
        cleanHubSpotText(
          companies.find((company) => company.id === item.id)?.name ?? null,
          200,
        ) || item.id,
      labels: item.labels,
      partner: links.get(item.id) ?? null,
    })),
  };
}

export type HubSpotSearch =
  | { kind: "empty" }
  | { kind: "record"; objectType: "company" | "deal"; objectId: string }
  | { kind: "foreign_portal"; portalId: string }
  | {
      kind: "results";
      companies: (HubSpotSearchResult & {
        partner: { id: string; name: string } | null;
      })[];
      deals: HubSpotSearchResult[];
    };

/**
 * Companies and deals by name, or the record a pasted HubSpot URL names. A
 * URL from another portal is explained, never followed.
 */
export async function searchHubSpot(
  context: HubSpotContext,
  rawQuery: string,
): Promise<HubSpotSearch> {
  const query = rawQuery.trim().slice(0, 200);
  if (!query) return { kind: "empty" };
  const reference = parseHubSpotRecordUrl(query);
  if (reference)
    return reference.portalId === context.connection.portalId
      ? {
          kind: "record",
          objectType: reference.objectType,
          objectId: reference.objectId,
        }
      : { kind: "foreign_portal", portalId: reference.portalId };
  const limit = 10;
  const [companies, deals, ownerList, pipelineList] = await Promise.all([
    context.reader.searchCompanies({
      query,
      properties: [...hubspotBaseProperties.company],
      limit,
    }),
    context.reader.searchDeals({
      query,
      properties: [...hubspotBaseProperties.deal],
      limit,
    }),
    hubspotOwners(context),
    hubspotPipelines(context),
  ]);
  const links = await context.store.partnersForCompanies(
    context.connection.portalId,
    companies.map((company) => company.id),
  );
  const ownerName = (id: string | null) =>
    ownerRef(id, ownerList)?.name ?? null;
  return {
    kind: "results",
    companies: companies
      .filter((company) => !company.archived)
      .map((company) => ({
        objectType: "company",
        id: company.id,
        name: cleanHubSpotText(company.name, 200) || company.id,
        detail: cleanHubSpotText(company.domain, 200) || null,
        ownerName: ownerName(company.ownerId),
        updatedAt: company.updatedAt,
        partner: links.get(company.id) ?? null,
      })),
    deals: deals
      .filter((deal) => !deal.archived)
      .map((deal) => ({
        objectType: "deal",
        id: deal.id,
        name: cleanHubSpotText(deal.name, 200) || deal.id,
        detail: stageOf(pipelineList, deal).stage.label,
        ownerName: ownerName(deal.ownerId),
        updatedAt: deal.updatedAt,
      })),
  };
}

// ---------------------------------------------------------------------------
// Pipeline: totals over the full authorized filtered result.
// ---------------------------------------------------------------------------

export interface PipelineView {
  pipelines: readonly HubSpotPipeline[];
  pipeline: HubSpotPipeline;
  owners: readonly HubSpotOwner[];
  /** Every deal that matches the filters, deduplicated. */
  deals: readonly HubSpotPipelineDeal[];
  currencies: readonly string[];
  summary: ReturnType<typeof summarizeHubSpotPipeline>;
  /** False when the pipeline holds more deals than one read covers. */
  complete: boolean;
  total: number;
  checkedAt: string;
  stale: boolean;
}

async function pipelineDeals(
  context: HubSpotContext,
  pipeline: HubSpotPipeline,
  stageIds: readonly string[],
): Promise<{ deals: HubSpotPipelineDeal[]; complete: boolean; total: number }> {
  const deals: HubSpotDeal[] = [];
  let after: string | null = null;
  let total = 0;
  do {
    const page = await context.reader.pipelineDeals({
      pipelineId: pipeline.id,
      stageIds,
      properties: [...hubspotBaseProperties.deal],
      after,
      limit: 100,
    });
    deals.push(...page.deals);
    total = page.total;
    after = page.next;
  } while (after && deals.length < hubspotLimits.pipelineDeals);
  const [associations, ownerList] = await Promise.all([
    context.reader.dealCompanies(deals.map((deal) => deal.id)),
    hubspotOwners(context),
  ]);
  const companyIds = [
    ...new Set([...associations.values()].flat().map((item) => item.id)),
  ];
  const [companies, links] = await Promise.all([
    context.reader.companies(companyIds, ["name"]),
    context.store.partnersForCompanies(context.connection.portalId, companyIds),
  ]);
  const names = new Map(
    companies.map((c) => [c.id, cleanHubSpotText(c.name, 200)]),
  );
  return {
    deals: deals.map((deal) => ({
      id: deal.id,
      name: cleanHubSpotText(deal.name, 200) || deal.id,
      stageId: deal.stageId,
      amount: deal.amount,
      currency: deal.currency,
      closeDate: deal.closeDate,
      ownerId: deal.ownerId,
      ownerName: ownerRef(deal.ownerId, ownerList)?.name ?? null,
      updatedAt: deal.updatedAt,
      companies: (associations.get(deal.id) ?? []).map((item) => ({
        id: item.id,
        name: names.get(item.id) || item.id,
        labels: item.labels,
        partner: links.get(item.id) ?? null,
      })),
    })),
    complete: after === null,
    total,
  };
}

/** The filtered pipeline: table, board, counts and totals share one list. */
export async function loadPipeline(
  context: HubSpotContext,
  query: HubSpotPipelineQuery,
  options: { refresh?: boolean } = {},
): Promise<PipelineView> {
  const [pipelineList, ownerList] = await Promise.all([
    hubspotPipelines(context),
    hubspotOwners(context),
  ]);
  const pipeline =
    pipelineList.find((p) => p.id === query.pipeline) ??
    pipelineList.find((p) => p.id === context.connection.defaultPipelineId) ??
    pipelineList[0];
  if (!pipeline) throw new HubSpotError("HUBSPOT_RECORD_NOT_FOUND");
  const stageIds = pipeline.stages
    .filter((stage) =>
      query.state === "all"
        ? true
        : query.state === "closed"
          ? stage.closed
          : !stage.closed,
    )
    .map((stage) => stage.id);
  const loaded = await cached(
    context.connection,
    `pipeline:${pipeline.id}:${query.state}`,
    () => pipelineDeals(context, pipeline, stageIds),
    options,
  );
  const text = query.q.toLowerCase();
  const deals = loaded.value.deals.filter((deal) => {
    const day = deal.closeDate?.slice(0, 10) ?? null;
    return (
      (!query.stage || deal.stageId === query.stage) &&
      (!query.owner || deal.ownerId === query.owner) &&
      (!query.currency || deal.currency === query.currency) &&
      (!query.closeFrom || (day !== null && day >= query.closeFrom)) &&
      (!query.closeTo || (day !== null && day <= query.closeTo)) &&
      (query.linked === "any" || hubspotDealLinkState(deal) === query.linked) &&
      (!text ||
        deal.name.toLowerCase().includes(text) ||
        deal.companies.some((c) => c.name.toLowerCase().includes(text)))
    );
  });
  const visiblePipeline = {
    ...pipeline,
    stages: pipeline.stages.filter((stage) => stageIds.includes(stage.id)),
  };
  return {
    pipelines: pipelineList,
    pipeline: visiblePipeline,
    owners: ownerList.filter((owner) => !owner.archived),
    deals,
    currencies: [
      ...new Set(
        loaded.value.deals.flatMap((deal) =>
          deal.currency ? [deal.currency] : [],
        ),
      ),
    ].sort(),
    summary: summarizeHubSpotPipeline(visiblePipeline, deals),
    complete: loaded.value.complete,
    total: loaded.value.total,
    checkedAt: loaded.checkedAt,
    stale: loaded.stale,
  };
}

/** One deal's people, read when its detail opens. */
export async function loadDealPeople(context: HubSpotContext, dealId: string) {
  const people = await context.reader.associations("deal", dealId, "contact");
  const rows = await context.reader.contacts(
    people.slice(0, 20).map((person) => person.id),
    [...hubspotBaseProperties.contact],
  );
  return people.slice(0, 20).flatMap((person) => {
    const row = rows.find((contact) => contact.id === person.id);
    return row
      ? [
          {
            id: row.id,
            name: hubspotContactName(row) || row.id,
            role: cleanHubSpotText(row.jobTitle, 200),
            labels: person.labels,
          },
        ]
      : [];
  });
}

// ---------------------------------------------------------------------------
// A partner's HubSpot section.
// ---------------------------------------------------------------------------

export interface PartnerHubSpotView {
  link: HubSpotLinkRecord | null;
  imports: readonly HubSpotImportRecord[];
  /** Live details, or why they are not shown. */
  live:
    | {
        kind: "ready";
        companyName: string;
        companyUrl: string;
        updatedAt: string | null;
        checkedAt: string;
        stale: boolean;
        changedFields: number;
        values: readonly { label: string; value: string | null }[];
        deals: readonly {
          id: string;
          name: string;
          url: string;
          stageLabel: string | null;
          amount: string | null;
          currency: string | null;
          closeDate: string | null;
        }[];
      }
    | { kind: "archived" }
    | { kind: "unavailable"; code: string }
    | { kind: "none" };
}

/**
 * The HubSpot section of a partner page: the link, what changed in HubSpot
 * since the last import, the deals associated with the company and the
 * import history. Imports and the link stay readable when HubSpot is not.
 */
export async function loadPartnerHubSpot(
  partner: { id: string; name: string; website: string; region: string },
  history: HubSpotFieldHistory | null,
): Promise<PartnerHubSpotView | null> {
  let context: HubSpotContext;
  try {
    context = await hubspotContext();
  } catch (error) {
    // Without a connection, show what Commerce holds and say why the live
    // part is missing; without a database there is nothing to show.
    if (!(error instanceof HubSpotUnavailableError)) throw error;
    const store = explicitDemoIdentityEnabled() ? null : hubspotRepository();
    if (!store) return null;
    const [link, imports] = await Promise.all([
      store.linkForPartner(partner.id),
      store.imports(partner.id),
    ]);
    if (!link && !imports.length) return null;
    return { link, imports, live: { kind: "unavailable", code: error.code } };
  }
  const [link, imports, fieldHistory] = await Promise.all([
    context.store.linkForPartner(partner.id, context.connection.portalId),
    context.store.imports(partner.id),
    history ? Promise.resolve(history) : context.store.fieldHistory(partner.id),
  ]);
  if (!link) return { link: null, imports, live: { kind: "none" } };
  try {
    const companyProps = await approvedProperties(context, "company");
    const loaded = await cached(
      context.connection,
      `company:${link.companyId}`,
      async () => {
        const [company] = await context.reader.companies(
          [link.companyId],
          [
            ...hubspotBaseProperties.company,
            ...companyProps.map((p) => p.name),
          ],
        );
        if (!company) return null;
        const dealLinks = (
          await context.reader.associations("company", company.id, "deal")
        ).slice(0, 25);
        const [deals, pipelineList] = await Promise.all([
          context.reader.deals(
            dealLinks.map((item) => item.id),
            [...hubspotBaseProperties.deal],
          ),
          hubspotPipelines(context),
        ]);
        return { company, deals, pipelineList };
      },
    );
    if (!loaded.value)
      return {
        link,
        imports,
        live: { kind: "unavailable", code: "HUBSPOT_RECORD_NOT_FOUND" },
      };
    const { company, deals, pipelineList } = loaded.value;
    if (company.archived) return { link, imports, live: { kind: "archived" } };
    const current = {
      name: cleanHubSpotText(company.name, 200),
      website: normalizeHubSpotWebsite(company.website, company.domain),
      region: cleanHubSpotText(company.country, 500),
    };
    const changedFields = (["name", "website", "region"] as const).filter(
      (field) =>
        fieldHistory[field] !== undefined &&
        fieldHistory[field].lastSource !== current[field],
    ).length;
    return {
      link,
      imports,
      live: {
        kind: "ready",
        companyName: current.name || company.id,
        companyUrl: hubspotRecordUrl(context.portal, "company", company.id),
        updatedAt: company.updatedAt,
        checkedAt: loaded.checkedAt,
        stale: loaded.stale,
        changedFields,
        values: [
          ...sourceValues("company", companyProps, company.properties).map(
            (value) => ({
              label: value.label,
              value: value.value,
            }),
          ),
        ],
        deals: deals
          .filter((deal) => !deal.archived)
          .map((deal) => ({
            id: deal.id,
            name: cleanHubSpotText(deal.name, 200) || deal.id,
            url: hubspotRecordUrl(context.portal, "deal", deal.id),
            stageLabel: stageOf(pipelineList, deal).stage.label,
            amount: deal.amount,
            currency: deal.currency,
            closeDate: deal.closeDate,
          })),
      },
    };
  } catch (error) {
    if (error instanceof HubSpotError)
      return { link, imports, live: { kind: "unavailable", code: error.code } };
    throw error;
  }
}

/** The request as sent, so a retry is recognised and a changed one refused. */
export const requestDigest = (raw: unknown) => digest(raw);
