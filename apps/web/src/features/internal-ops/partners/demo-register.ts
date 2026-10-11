// i18n-exempt-file: fictional demo records (partner names, terms and notes a person typed); never interface copy
import {
  PartnerTermsSchema,
  addPartnerDays,
  partnerDealIsOpen,
  partnerDefaultProtectionDays,
  partnerExportLimit,
  partnerListLimit,
  type PartnerContact,
  type PartnerDealConflict,
  type PartnerDealModel,
  type PartnerDealRecord,
  type PartnerDealStatus,
  type PartnerListQuery,
  type PartnerModel,
  type PartnerRecord,
  type PartnerStatus,
  type PartnerSummary,
  type PartnerTerms,
} from "@clockwork/contracts";
import type {
  PartnerDetail,
  PartnerListResult,
  PartnerReadScope,
} from "@clockwork/db";

/**
 * The partner records the guided demo shows. Every partner and end client is
 * fictional, and each date is placed relative to the day the page is read, so
 * one next step is always overdue and one deal always overlaps another
 * partner's. It mirrors the repository's reads and has no writes.
 */
export interface DemoPartnerViewer {
  id: string;
  name: string;
}

interface DealFixture {
  key: string;
  endClient: string;
  /** Days before today it was registered. */
  registeredDaysAgo: number;
  protectionDays?: number;
  size?: { value: string; unit: PartnerDealRecord["sizeUnit"] };
  model: PartnerDealModel;
  status: PartnerDealStatus;
  notes?: string;
}

interface Fixture {
  key: string;
  name: string;
  website: string;
  region: string;
  models: PartnerModel[];
  status: PartnerStatus;
  /** "viewer" is the signed-in persona; otherwise a named colleague, or none. */
  owner: string | null;
  contacts: PartnerContact[];
  nextStep: string;
  /** Days from today; negative is overdue. */
  nextStepInDays?: number;
  notes: string;
  terms: Partial<PartnerTerms>;
  deals: DealFixture[];
  updatedDaysAgo: number;
}

const fixtures: readonly Fixture[] = [
  {
    key: "a1",
    name: "Larchmont Data Services",
    website: "https://larchmont.example",
    region: "Benelux and DACH",
    models: ["referral", "other"],
    status: "negotiating",
    owner: "viewer",
    contacts: [
      {
        name: "Marit de Vries",
        email: "marit@larchmont.example",
        role: "Managing director",
      },
      {
        name: "Tobias Kern",
        email: "tobias@larchmont.example",
        role: "Solutions lead",
      },
    ],
    nextStep: "Send the trial term sheet with the three named targets",
    nextStepInDays: 3,
    notes:
      "Referral plus migration services. They want to contract in EUR and keep two accounts for their own lab.",
    terms: {
      commissionPct: "17.5",
      commissionSchedule:
        "15 to 20% depending on volume; 12 months from first invoice",
      exclusivity: "none",
      currency: "EUR",
      nfrAllowance: "Two NFR accounts up to 20 TB each",
      trialPeriod: "6 to 12 months",
      trialTargets:
        "Fernhill Research Institute, Saltmarsh Climate Data and one archive prospect of their choice",
      rows: [
        {
          label: "Services",
          value: "They deliver migration and onboarding",
          notes: "Billed by them to the end client",
        },
      ],
    },
    deals: [
      {
        key: "d1",
        endClient: "Fernhill Research Institute",
        registeredDaysAgo: 12,
        size: { value: "250", unit: "TB" },
        model: "referral",
        status: "registered",
        notes: "Introduced at their research data summit.",
      },
    ],
    updatedDaysAgo: 1,
  },
  {
    key: "a2",
    name: "Brightwater Systems Integrators Ltd",
    website: "https://brightwater.example",
    region: "United Kingdom and Ireland",
    models: ["resale", "distributor"],
    status: "signed",
    owner: "Jonah Pike",
    contacts: [
      {
        name: "Callum Hart",
        email: "callum@brightwater.example",
        role: "Alliances director",
      },
    ],
    nextStep: "Confirm the first two regional resellers",
    nextStepInDays: 9,
    notes:
      "Design partner. Elevated commission while they build the practice; they may onboard sub-tier regional resellers.",
    terms: {
      commissionPct: "32",
      commissionSchedule: "36 months, stepping down each year",
      commissionSteps: [
        { fromMonth: 1, ratePct: "32" },
        { fromMonth: 13, ratePct: "26" },
        { fromMonth: 25, ratePct: "20" },
      ],
      marginPct: "18",
      territory: "UK and Ireland",
      exclusivity: "limited",
      exclusivityNote: "Exclusive for UK public sector for the first 12 months",
      currency: "GBP",
      rows: [
        {
          label: "Sub-tier resellers",
          value: "Allowed, with our approval of each",
          notes: "Their margin comes out of Brightwater's",
        },
      ],
    },
    deals: [
      {
        key: "d2",
        endClient: "Orchard Street Studios Inc.",
        registeredDaysAgo: 40,
        protectionDays: 120,
        size: { value: "1", unit: "PiB" },
        model: "resale",
        status: "accepted",
      },
      {
        key: "d3",
        endClient: "Fernhill Research Institute, Inc.",
        registeredDaysAgo: 4,
        size: { value: "400", unit: "TiB" },
        model: "resale",
        status: "registered",
        notes: "Says they met the research operations lead in September.",
      },
    ],
    updatedDaysAgo: 4,
  },
  {
    key: "a3",
    name: "Kestrelpoint Affiliates",
    website: "https://kestrelpoint.example",
    region: "North America",
    models: ["affiliate", "resale"],
    status: "active",
    owner: "viewer",
    contacts: [
      {
        name: "Dana Whitlock",
        email: "dana@kestrelpoint.example",
        role: "Head of partnerships",
      },
    ],
    nextStep: "",
    notes:
      "Affiliate program for their newsletter audience, plus a resale track for larger accounts.",
    terms: {
      commissionPct: "30",
      commissionSchedule: "Perpetual revenue share on referred accounts",
      marginPct: "32",
      exclusivity: "none",
      currency: "USD",
      rows: [
        {
          label: "Resale price",
          value: "$6.50 per TB per month",
          notes: "Floor for the resale track",
        },
        { label: "Payment", value: "Monthly, net 30", notes: "" },
      ],
    },
    deals: [
      {
        key: "d4",
        endClient: "Pinecrest Mapping Co.",
        registeredDaysAgo: 70,
        size: { value: "80", unit: "TB" },
        model: "referral",
        status: "won",
      },
    ],
    updatedDaysAgo: 10,
  },
  {
    key: "a4",
    name: "Meridian Ridge Infrastructure",
    website: "https://meridianridge.example",
    region: "Nordics",
    models: ["referral"],
    status: "terms_agreed",
    owner: "viewer",
    contacts: [
      {
        name: "Sigrid Holm",
        email: "sigrid@meridianridge.example",
        role: "Partner manager",
      },
    ],
    nextStep: "Get their comments on the referral letter",
    nextStepInDays: -2,
    notes:
      "Two rates: one for deals they source, one for data-center build-outs they bring us into.",
    terms: {
      commissionPct: "20",
      commissionSchedule: "24 months from each deal's first invoice",
      exclusivity: "none",
      currency: "EUR",
      rows: [
        { label: "Sourced deals", value: "20% referral commission", notes: "" },
        {
          label: "Data-center build-out deals",
          value: "10% referral commission",
          notes: "On the storage contract value only",
        },
      ],
    },
    deals: [
      {
        key: "d5",
        endClient: "Halden Archives AS",
        registeredDaysAgo: 20,
        size: { value: "2", unit: "PB" },
        model: "referral",
        status: "registered",
      },
      {
        key: "d6",
        endClient: "Kestrel Bio SAS",
        registeredDaysAgo: 130,
        model: "referral",
        status: "expired",
        notes: "Went quiet after the first call.",
      },
    ],
    updatedDaysAgo: 6,
  },
  {
    key: "a5",
    name: "Copperleaf Federal Teaming",
    website: "https://copperleaf.example",
    region: "United States public sector",
    models: ["teaming"],
    status: "talking",
    owner: "Sofia Marchetti",
    contacts: [{ name: "Ray Okafor", email: "", role: "Capture manager" }],
    nextStep: "Legal to review their teaming agreement",
    nextStepInDays: 5,
    notes: "They want a teaming agreement on their paper for one federal bid.",
    terms: {
      exclusivity: "exclusive",
      exclusivityNote: "Exclusive for the one named bid only",
      currency: "USD",
      rows: [
        {
          label: "Paper",
          value: "Their teaming agreement",
          notes: "Record it in Contracts once legal has it",
        },
      ],
    },
    deals: [],
    updatedDaysAgo: 2,
  },
];

const demoId = (key: string) => `019a44af-0000-7000-8000-0000000000${key}`;
const ownerIds: Readonly<Record<string, string>> = {
  "Jonah Pike": "019a44af-0000-7000-8000-0000000000f1",
  "Sofia Marchetti": "019a44af-0000-7000-8000-0000000000f2",
};
const emptyTerms = PartnerTermsSchema.parse({});

/** The register's normalizer, close enough for the fictional names here. */
function normalizeCompany(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  const suffixes = [
    "inc",
    "ltd",
    "llc",
    "co",
    "corp",
    "as",
    "sas",
    "gmbh",
    "plc",
  ];
  while (words.length > 1 && suffixes.includes(words[words.length - 1] ?? ""))
    words.pop();
  return words.join(" ");
}

function records(now: Date, viewer: DemoPartnerViewer) {
  const today = now.toISOString().slice(0, 10);
  const instant = (daysAgo: number) =>
    new Date(now.getTime() - daysAgo * 86_400_000).toISOString();
  return fixtures.map((fixture) => {
    const ownerName = fixture.owner === "viewer" ? viewer.name : fixture.owner;
    const ownerId =
      fixture.owner === "viewer"
        ? viewer.id
        : fixture.owner
          ? (ownerIds[fixture.owner] ?? null)
          : null;
    const partner: PartnerRecord = {
      id: demoId(fixture.key),
      name: fixture.name,
      website: fixture.website,
      region: fixture.region,
      models: fixture.models,
      status: fixture.status,
      ownerId,
      ownerName,
      organizationId: null,
      organizationName: null,
      contacts: fixture.contacts,
      nextStep: fixture.nextStep,
      nextStepDue:
        fixture.nextStepInDays === undefined
          ? null
          : addPartnerDays(today, fixture.nextStepInDays),
      notes: fixture.notes,
      terms: { ...emptyTerms, ...fixture.terms },
      createdById: ownerId ?? viewer.id,
      createdByName: ownerName ?? viewer.name,
      createdAt: instant(fixture.updatedDaysAgo + 30),
      updatedAt: instant(fixture.updatedDaysAgo),
      version: 2,
    };
    const deals: PartnerDealRecord[] = fixture.deals.map((deal) => {
      const registeredOn = addPartnerDays(today, -deal.registeredDaysAgo);
      return {
        id: demoId(deal.key.replace("d", "e")),
        partnerId: partner.id,
        endClient: deal.endClient,
        organizationId: null,
        organizationName: null,
        registeredOn,
        protectedUntil: addPartnerDays(
          registeredOn,
          deal.protectionDays ?? partnerDefaultProtectionDays,
        ),
        estimatedSize: deal.size?.value ?? null,
        sizeUnit: deal.size?.unit ?? null,
        model: deal.model,
        status: deal.status,
        notes: deal.notes ?? "",
        createdByName: partner.createdByName,
        createdAt: instant(deal.registeredDaysAgo),
        updatedAt: instant(deal.registeredDaysAgo),
        version: 1,
      };
    });
    return { partner, deals };
  });
}

function matches(
  partner: PartnerRecord,
  deals: readonly PartnerDealRecord[],
  query: PartnerListQuery,
  scope: PartnerReadScope,
): boolean {
  if (query.status && partner.status !== query.status) return false;
  if (query.model && !partner.models.includes(query.model)) return false;
  if (query.owner && partner.ownerId !== query.owner) return false;
  if (query.mine && partner.ownerId !== scope.viewerId) return false;
  if (query.due) {
    if (!partner.nextStepDue || partner.status === "ended") return false;
    if (query.due === "overdue" && partner.nextStepDue >= scope.today)
      return false;
    if (
      query.due === "week" &&
      partner.nextStepDue > addPartnerDays(scope.today, 7)
    )
      return false;
  }
  if (query.q) {
    const q = query.q.toLowerCase();
    const haystack = [
      partner.name,
      partner.region,
      partner.terms.territory,
      ...partner.contacts.map((contact) => contact.name),
      ...deals.map((deal) => deal.endClient),
    ]
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  return true;
}

function summary(
  partner: PartnerRecord,
  deals: readonly PartnerDealRecord[],
  today: string,
): PartnerSummary {
  return {
    id: partner.id,
    name: partner.name,
    region: partner.region,
    models: partner.models,
    status: partner.status,
    ownerId: partner.ownerId,
    ownerName: partner.ownerName,
    nextStep: partner.nextStep,
    nextStepDue: partner.nextStepDue,
    commissionPct: partner.terms.commissionPct,
    marginPct: partner.terms.marginPct,
    currency: partner.terms.currency,
    openDeals: deals.filter((deal) => partnerDealIsOpen(deal, today)).length,
    updatedAt: partner.updatedAt,
  };
}

/** The read side of `PartnerRepository`, over the demo fixtures. */
export function demoPartnerRegister(now: Date, viewer: DemoPartnerViewer) {
  const all = () => records(now, viewer);
  const conflicts = (
    endClient: string,
    excludePartnerId: string | undefined,
    today: string,
  ): PartnerDealConflict[] => {
    const key = normalizeCompany(endClient);
    if (!key) return [];
    return all()
      .filter(({ partner }) => partner.id !== excludePartnerId)
      .flatMap(({ partner, deals }) =>
        deals
          .filter(
            (deal) =>
              normalizeCompany(deal.endClient) === key &&
              partnerDealIsOpen(deal, today),
          )
          .map((deal) => ({
            dealId: deal.id,
            partnerId: partner.id,
            partnerName: partner.name,
            endClient: deal.endClient,
            status: deal.status,
            registeredOn: deal.registeredOn,
            protectedUntil: deal.protectedUntil,
          })),
      );
  };
  const filtered = (query: PartnerListQuery, scope: PartnerReadScope) =>
    all()
      .filter(({ partner, deals }) => matches(partner, deals, query, scope))
      .sort((a, b) => b.partner.updatedAt.localeCompare(a.partner.updatedAt));
  return {
    list(
      query: PartnerListQuery,
      scope: PartnerReadScope,
    ): Promise<PartnerListResult> {
      const found = filtered(query, scope);
      return Promise.resolve({
        rows: found
          .slice(0, partnerListLimit)
          .map(({ partner, deals }) => summary(partner, deals, scope.today)),
        truncated: found.length > partnerListLimit,
      });
    },
    exportRows(query: PartnerListQuery, scope: PartnerReadScope) {
      const found = filtered(query, scope);
      return Promise.resolve({
        rows: found.slice(0, partnerExportLimit).map(({ partner, deals }) => ({
          ...summary(partner, deals, scope.today),
          website: partner.website,
          terms: partner.terms,
        })),
        truncated: found.length > partnerExportLimit,
      });
    },
    get(id: string, today: string): Promise<PartnerDetail> {
      const found = all().find(({ partner }) => partner.id === id);
      if (!found) return Promise.reject(new Error("PARTNER_NOT_FOUND"));
      return Promise.resolve({
        partner: found.partner,
        deals: found.deals.map((deal) => ({
          ...deal,
          conflicts: partnerDealIsOpen(deal, today)
            ? conflicts(deal.endClient, found.partner.id, today)
            : [],
        })),
        // The demo keeps no audit trail.
        activity: [],
      });
    },
    dealConflicts(
      endClient: string,
      options: { excludePartnerId?: string; today: string },
    ) {
      return Promise.resolve(
        conflicts(endClient, options.excludePartnerId, options.today),
      );
    },
    owners() {
      return Promise.resolve([
        { id: viewer.id, name: viewer.name },
        ...Object.entries(ownerIds).map(([name, id]) => ({ id, name })),
      ]);
    },
    organizations() {
      return Promise.resolve([]);
    },
    protectionDays() {
      return Promise.resolve(partnerDefaultProtectionDays);
    },
  };
}
