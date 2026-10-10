// i18n-exempt-file: fictional demo records (counterparties, titles, notes a person typed); never interface copy
import {
  contractExportLimit,
  contractPageSize,
  salesCollateralStatuses,
  type ContractActivity,
  type ContractListQuery,
  type ContractListRow,
  type ContractRecord,
  type SalesCollateralRecord,
} from "@clockwork/contracts";
import type { ContractListResult, ContractListScope } from "@clockwork/db";
import {
  addContractDays,
  addContractMonths,
  contractTermSchedule,
} from "@clockwork/domain/contract-terms";
import { demoMndaRecords, type DemoMndaViewer } from "../mnda/demo-register";

/**
 * The contract register and sales library the guided demo shows. Every
 * counterparty is fictional, and every date is placed relative to the day the
 * page is read, so renewal and notice deadlines always fall where the fixture
 * says (one notice due in two weeks, one already passed). It mirrors the
 * repository's reads and has no writes: the demo cannot record, edit, upload
 * or send a contract.
 */
interface Fixture {
  key: number;
  counterpartyName: string;
  title: string;
  contractType: ContractRecord["contractType"];
  paper: ContractRecord["paper"];
  status: ContractRecord["status"];
  /** The current term ends this many days from today (12-month terms). */
  termEndsInDays?: number;
  initialTermMonths?: number;
  autoRenew?: boolean;
  renewalTermMonths?: number;
  noticePeriodDays?: number;
  value?: { minor: number; currency: "USD" | "EUR" | "GBP" };
  pricingNotes?: string;
  ownerName: string;
  /** Who recorded it, when not the owner. */
  createdBy?: string;
  internalNotes?: string;
  tags?: string[];
  /** Days before today the record was last changed. */
  updatedDaysAgo: number;
}

const fixtures: readonly Fixture[] = [
  {
    key: 1,
    counterpartyName: "Fernhill Research Institute",
    title: "Master services agreement",
    contractType: "customer_msa",
    paper: "ours",
    status: "executed",
    termEndsInDays: 75,
    initialTermMonths: 12,
    autoRenew: true,
    renewalTermMonths: 12,
    noticePeriodDays: 60,
    value: { minor: 4_800_000, currency: "USD" },
    pricingNotes: "Committed 400 TiB at the published research rate.",
    ownerName: "Priya Raman",
    internalNotes: "Renewal call booked with their research operations lead.",
    tags: ["research", "renewal"],
    updatedDaysAgo: 3,
  },
  {
    key: 2,
    counterpartyName: "Orchard Street Studios Inc.",
    title: "Order form 2026-01",
    contractType: "order_form",
    paper: "ours",
    status: "executed",
    termEndsInDays: 50,
    initialTermMonths: 12,
    autoRenew: true,
    renewalTermMonths: 12,
    noticePeriodDays: 30,
    value: { minor: 9_600_000, currency: "USD" },
    pricingNotes: "Archive tier, 1 PiB committed, monthly invoicing.",
    ownerName: "Sofia Marchetti",
    tags: ["media"],
    updatedDaysAgo: 12,
  },
  {
    key: 3,
    counterpartyName: "Orchard Street Studios Inc.",
    title: "Data processing agreement",
    contractType: "dpa",
    paper: "ours",
    status: "executed",
    ownerName: "Sofia Marchetti",
    tags: ["media", "privacy"],
    updatedDaysAgo: 40,
  },
  {
    key: 4,
    counterpartyName: "Brightwater Systems Integrators Ltd",
    title: "Channel partnership agreement",
    contractType: "channel_partnership",
    paper: "theirs",
    status: "executed",
    termEndsInDays: 80,
    initialTermMonths: 24,
    autoRenew: true,
    renewalTermMonths: 12,
    noticePeriodDays: 90,
    ownerName: "Jonah Pike",
    internalNotes:
      "Notice window has closed; the agreement renews for 12 months unless both sides agree otherwise.",
    tags: ["partner", "uk"],
    updatedDaysAgo: 20,
  },
  {
    key: 5,
    counterpartyName: "Halden Archives AS",
    title: "Master services agreement (their paper)",
    contractType: "customer_msa",
    paper: "theirs",
    status: "in_negotiation",
    ownerName: "Sofia Marchetti",
    internalNotes: "Second round of redlines on liability caps.",
    tags: ["nordics"],
    updatedDaysAgo: 1,
  },
  {
    key: 6,
    counterpartyName: "Pinecrest Mapping Co.",
    title: "Technology partner agreement",
    contractType: "technology_partner",
    paper: "ours",
    status: "executed",
    termEndsInDays: 40,
    initialTermMonths: 12,
    autoRenew: false,
    ownerName: "Jonah Pike",
    createdBy: "Priya Raman",
    tags: ["integration"],
    updatedDaysAgo: 30,
  },
  {
    key: 7,
    counterpartyName: "Saltmarsh Climate Data Ltd",
    title: "Pilot order form",
    contractType: "order_form",
    paper: "ours",
    status: "out_for_signature",
    initialTermMonths: 6,
    autoRenew: false,
    value: { minor: 1_200_000, currency: "GBP" },
    ownerName: "Priya Raman",
    tags: ["pilot"],
    updatedDaysAgo: 2,
  },
  {
    key: 8,
    counterpartyName: "Tidewater Media Group LLC",
    title: "Statement of work: archive migration",
    contractType: "sow",
    paper: "ours",
    status: "draft",
    ownerName: "Priya Raman",
    tags: ["media", "migration"],
    updatedDaysAgo: 0,
  },
  {
    key: 9,
    counterpartyName: "Fernhill Research Institute",
    title: "Security annex",
    contractType: "security_annex",
    paper: "ours",
    status: "executed",
    ownerName: "Priya Raman",
    tags: ["research"],
    updatedDaysAgo: 90,
  },
  {
    key: 10,
    counterpartyName: "Ashgrove Digital Library",
    title: "Master services agreement",
    contractType: "customer_msa",
    paper: "ours",
    status: "terminated",
    ownerName: "Jonah Pike",
    internalNotes: "Ended by mutual agreement after data export.",
    tags: ["library"],
    updatedDaysAgo: 120,
  },
];

/** Who recorded each fixture, for "recorded by me": the seller persona and
 * the colleagues the demo MNDA register names. */
const creatorIds: Readonly<Record<string, string>> = {
  "Priya Raman": "21000000-0000-4000-8000-000000000010",
  "Jonah Pike": "61000000-0000-4000-8000-000000000101",
  "Sofia Marchetti": "61000000-0000-4000-8000-000000000102",
};

const day = 86_400_000;
const contractId = (key: number) =>
  `62000000-0000-4000-8000-${String(key).padStart(12, "0")}`;
const stamp = (now: Date, daysAgo: number) =>
  new Date(now.getTime() - daysAgo * day).toISOString();

function contract(fixture: Fixture, now: Date, today: string): ContractRecord {
  const months = fixture.initialTermMonths ?? null;
  // An executed term ending on a chosen day began that many months earlier.
  const effectiveDate =
    fixture.status === "draft" ||
    fixture.status === "in_negotiation" ||
    fixture.status === "out_for_signature"
      ? null
      : fixture.termEndsInDays !== undefined && months
        ? addContractMonths(
            addContractDays(today, fixture.termEndsInDays + 1),
            -months,
          )
        : addContractDays(today, -fixture.updatedDaysAgo - 14);
  const term = {
    effectiveDate,
    initialTermMonths: months,
    autoRenew: fixture.autoRenew ?? false,
    renewalTermMonths: fixture.renewalTermMonths ?? null,
    noticePeriodDays: fixture.noticePeriodDays ?? null,
  };
  const updatedAt = stamp(now, fixture.updatedDaysAgo);
  return {
    id: contractId(fixture.key),
    source: "register",
    counterpartyName: fixture.counterpartyName,
    title: fixture.title,
    contractType: fixture.contractType,
    paper: fixture.paper,
    status: fixture.status,
    ...term,
    valueMinor: fixture.value?.minor ?? null,
    currency: fixture.value?.currency ?? null,
    pricingNotes: fixture.pricingNotes ?? "",
    ownerName: fixture.ownerName,
    internalNotes: fixture.internalNotes ?? "",
    tags: fixture.tags ?? [],
    executedAt:
      fixture.status === "executed" && effectiveDate
        ? `${effectiveDate}T16:00:00.000Z`
        : null,
    createdByName: fixture.createdBy ?? fixture.ownerName,
    createdAt: stamp(now, fixture.updatedDaysAgo + 21),
    updatedAt,
    version: fixture.status === "executed" ? 2 : 1,
    ...contractTermSchedule(term, today),
  };
}

function listRow(record: ContractRecord): ContractListRow {
  return {
    id: record.id,
    source: record.source,
    counterpartyName: record.counterpartyName,
    title: record.title,
    contractType: record.contractType,
    paper: record.paper,
    status: record.status,
    effectiveDate: record.effectiveDate,
    autoRenew: record.autoRenew,
    noticePeriodDays: record.noticePeriodDays,
    ownerName: record.ownerName,
    tags: record.tags,
    documentCount: 0,
    signingState: null,
    updatedAt: record.updatedAt,
    termEndDate: record.termEndDate,
    renewalDate: record.renewalDate,
    noticeDeadline: record.noticeDeadline,
  };
}

/** Completed demo MNDAs, read-only in the register as in production. The
 * reader's own MNDAs carry the reader's name, as in the MNDA register. */
function mndaRows(now: Date, viewer: DemoMndaViewer): ContractListRow[] {
  return demoMndaRecords(viewer, now)
    .filter((record) => record.state === "completed")
    .map((record) => ({
      id: record.id,
      source: "mnda",
      counterpartyName: record.input.company,
      title: "",
      contractType: "mnda",
      paper: "ours",
      status: "executed",
      effectiveDate: record.input.effectiveDate,
      autoRenew: false,
      noticePeriodDays: null,
      ownerName: record.ownerName,
      tags: [],
      documentCount: 1,
      signingState: null,
      updatedAt: record.completedAt ?? record.updatedAt,
      termEndDate: null,
      renewalDate: null,
      noticeDeadline: null,
    }));
}

type SortKey = ContractListQuery["sort"];
const sortValue: Record<SortKey, (row: ContractListRow) => string | null> = {
  counterparty: (row) => row.counterpartyName.toLowerCase(),
  type: (row) => row.contractType,
  status: (row) => row.status,
  effective: (row) => row.effectiveDate,
  renewal: (row) => row.renewalDate ?? row.termEndDate,
  notice: (row) => row.noticeDeadline,
  updated: (row) => row.updatedAt,
};

/** The repository's ordering: the chosen column, nulls last, then id. */
function ordered(
  rows: ContractListRow[],
  query: Pick<ContractListQuery, "sort" | "direction">,
) {
  const direction =
    (query.direction ?? (query.sort === "updated" ? "desc" : "asc")) === "desc"
      ? -1
      : 1;
  const value = sortValue[query.sort];
  return [...rows].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    if (x !== y) {
      if (x === null) return 1;
      if (y === null) return -1;
      return x < y ? -direction : direction;
    }
    return a.id < b.id ? -1 : 1;
  });
}

function filtered(
  rows: ContractListRow[],
  query: Omit<ContractListQuery, "page">,
  today: string,
  mine: (row: ContractListRow) => boolean,
) {
  const needle = query.q.toLowerCase();
  return rows.filter((row) => {
    if (query.mine && !mine(row)) return false;
    if (
      needle &&
      ![row.counterpartyName, row.title, row.ownerName, ...row.tags].some(
        (value) => value.toLowerCase().includes(needle),
      )
    )
      return false;
    if (query.type && row.contractType !== query.type) return false;
    if (query.status?.startsWith("signing_"))
      return (
        row.status === "draft" &&
        row.signingState === query.status.slice("signing_".length)
      );
    if (query.status && row.status !== query.status) return false;
    if (query.window) {
      const end = row.renewalDate ?? row.termEndDate;
      if (!end || end < today || end > addContractDays(today, query.window))
        return false;
    }
    return true;
  });
}

/** The read side of `ContractRepository`, over the demo fixtures. */
export function demoContractRegister(now: Date, viewer: DemoMndaViewer) {
  const today = now.toISOString().slice(0, 10);
  const records = () => fixtures.map((f) => contract(f, now, today));
  const rows = (scope: ContractListScope) => [
    ...records().map(listRow),
    ...(scope.includeMndas ? mndaRows(now, viewer) : []),
  ];
  // Who recorded each row: a fixture's owner, or the MNDA's sender.
  const creators = new Map<string, string>([
    ...records().map(
      (record) => [record.id, creatorIds[record.createdByName] ?? ""] as const,
    ),
    ...demoMndaRecords(viewer, now).map(
      (record) => [record.id, record.ownerId] as const,
    ),
  ]);
  const matching = (
    query: Omit<ContractListQuery, "page">,
    scope: ContractListScope,
  ) =>
    ordered(
      filtered(
        rows(scope),
        query,
        today,
        (row) => creators.get(row.id) === scope.viewerId,
      ),
      query,
    );
  const executedNotices = () =>
    records()
      .map(listRow)
      .filter((row) => row.status === "executed" && row.noticeDeadline);
  return {
    list(
      query: ContractListQuery,
      _asOf: string,
      scope: ContractListScope,
    ): Promise<ContractListResult> {
      const found = matching(query, scope);
      const start = (query.page - 1) * contractPageSize;
      return Promise.resolve({
        rows: found.slice(start, start + contractPageSize),
        total: found.length,
        page: query.page,
        pageSize: contractPageSize,
      });
    },
    exportRows(
      query: Omit<ContractListQuery, "page">,
      _asOf: string,
      scope: ContractListScope,
    ) {
      const found = matching(query, scope);
      return Promise.resolve({
        rows: found.slice(0, contractExportLimit),
        truncated: found.length > contractExportLimit,
      });
    },
    noticesPassed(_asOf: string) {
      return Promise.resolve(
        executedNotices()
          .filter((row) => (row.noticeDeadline ?? "") < today)
          .sort((a, b) =>
            (a.renewalDate ?? "").localeCompare(b.renewalDate ?? ""),
          ),
      );
    },
    renewalsDue(_asOf: string, days: number) {
      const until = addContractDays(today, days);
      return Promise.resolve(
        executedNotices()
          .filter(
            (row) =>
              (row.noticeDeadline ?? "") >= today &&
              (row.noticeDeadline ?? "") <= until,
          )
          .sort((a, b) =>
            (a.noticeDeadline ?? "").localeCompare(b.noticeDeadline ?? ""),
          ),
      );
    },
    renewalSummary(_asOf: string) {
      const deadlines = executedNotices().map(
        (row) => row.noticeDeadline ?? "",
      );
      const within = (days: number) =>
        deadlines.filter((d) => d >= today && d <= addContractDays(today, days))
          .length;
      const upcoming = deadlines.filter((d) => d >= today).sort();
      return Promise.resolve({
        within30: within(30),
        within60: within(60),
        within90: within(90),
        passed: deadlines.filter((d) => d < today).length,
        nextDeadline: upcoming[0] ?? null,
      });
    },
    get(id: string, _asOf: string) {
      const record = records().find((candidate) => candidate.id === id);
      if (!record) return Promise.reject(new Error("CONTRACT_NOT_FOUND"));
      const activity: ContractActivity[] = [
        ...(record.status === "executed"
          ? [
              {
                id: `${record.id}-2`,
                eventType: "contract.updated",
                actorName: record.ownerName,
                changes: {
                  status: { from: "out_for_signature", to: "executed" },
                },
                occurredAt: record.updatedAt,
              },
            ]
          : []),
        {
          id: `${record.id}-1`,
          eventType: "contract.created",
          actorName: record.createdByName,
          changes: {},
          occurredAt: record.createdAt,
        },
      ];
      return Promise.resolve({
        contract: record,
        files: [],
        activity,
        signing: null,
      });
    },
  };
}

/** The demo sales library: a few fictional collateral items, no files. */
export function demoSalesLibrary(now: Date = new Date()) {
  const date = (daysAgo: number) =>
    new Date(now.getTime() - daysAgo * day).toISOString().slice(0, 10);
  const item = (
    key: number,
    fields: Pick<
      SalesCollateralRecord,
      "title" | "description" | "kind" | "audience" | "status"
    > & { daysAgo: number; fileName: string; sizeBytes: number },
  ): SalesCollateralRecord => ({
    id: `63000000-0000-4000-8000-${String(key).padStart(12, "0")}`,
    title: fields.title,
    description: fields.description,
    kind: fields.kind,
    audience: fields.audience,
    status: fields.status,
    contentUpdatedOn: date(fields.daysAgo),
    linkUrl: null,
    file: {
      fileName: fields.fileName,
      sizeBytes: fields.sizeBytes,
      sha256: "0".repeat(64),
    },
    updatedByName: "Elena Brooks",
    updatedAt: new Date(now.getTime() - fields.daysAgo * day).toISOString(),
    version: 1,
  });
  const items = [
    item(1, {
      title: "Fil One overview deck",
      description:
        "First-call deck: storage tiers, regions and how pricing works.",
      kind: "pitch_deck",
      audience: "customer",
      status: "current",
      daysAgo: 6,
      fileName: "Fil-One-overview.pdf",
      sizeBytes: 4_812_000,
    }),
    item(2, {
      title: "Archive tier one-pager",
      description:
        "One page on retention, retrieval times and committed capacity.",
      kind: "one_pager",
      audience: "customer",
      status: "current",
      daysAgo: 14,
      fileName: "Archive-tier-one-pager.pdf",
      sizeBytes: 612_000,
    }),
    item(3, {
      title: "Partner pricing sheet",
      description: "Transfer prices and margin bands for resale partners.",
      kind: "pricing_sheet",
      audience: "partner",
      status: "current",
      daysAgo: 21,
      fileName: "Partner-pricing-sheet.pdf",
      sizeBytes: 288_000,
    }),
    item(4, {
      title: "Case study: research archive migration",
      description:
        "How a fictional research institute moved 400 TiB in six weeks.",
      kind: "case_study",
      audience: "customer",
      status: "current",
      daysAgo: 35,
      fileName: "Case-study-research-archive.pdf",
      sizeBytes: 1_904_000,
    }),
    item(5, {
      title: "Overview deck (spring edition)",
      description: "Replaced by the current overview deck.",
      kind: "pitch_deck",
      audience: "customer",
      status: "archived",
      daysAgo: 160,
      fileName: "Fil-One-overview-spring.pdf",
      sizeBytes: 4_120_000,
    }),
  ];
  // The repository's order: current first, newest content, then title.
  const rank = (item: SalesCollateralRecord) =>
    salesCollateralStatuses.indexOf(item.status);
  return {
    list: () =>
      Promise.resolve(
        [...items].sort(
          (a, b) =>
            rank(a) - rank(b) ||
            b.contentUpdatedOn.localeCompare(a.contentUpdatedOn) ||
            a.title.localeCompare(b.title),
        ),
      ),
  };
}
