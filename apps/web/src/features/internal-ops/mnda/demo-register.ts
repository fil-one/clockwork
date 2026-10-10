// i18n-exempt-file: fictional demo records (company names, people, reasons typed by a seller); never interface copy
import {
  MndaRegisterQuerySchema,
  mndaSearchableDetailFields,
  type MndaRecord,
  type MndaRegisterPage,
  type MndaRegisterQuery,
  type MndaSigner,
  type MndaState,
} from "@clockwork/contracts";
import type { SalesHomeMndaCounts } from "@clockwork/db";

/**
 * The MNDA register the guided demo shows a revenue persona. Every company and
 * person is fictional and every date is relative to the moment the page is
 * read, so "days outstanding" and "completed on" read the same on any day.
 * Nothing here reaches SignWell or the database; the workspace turns sending,
 * reminding and voiding off in the demo.
 */
export interface DemoMndaViewer {
  id: string;
  name: string;
  email: string;
}

const day = 86_400_000;
const hour = 3_600_000;

export const demoMndaSigners: readonly MndaSigner[] = [
  {
    id: "61000000-0000-4000-8000-000000000001",
    name: "Elena Brooks",
    email: "elena.brooks@fil-one-internal.test",
    title: "Head of Revenue",
    active: true,
    isDefault: true,
  },
  {
    id: "61000000-0000-4000-8000-000000000002",
    name: "Marcus Lindqvist",
    email: "marcus.lindqvist@fil-one-internal.test",
    title: "Chief Operating Officer",
    active: true,
    isDefault: false,
  },
];
export const demoMndaNoticeEmail = "legal@fil-one-internal.test";

const colleagues = {
  jonah: {
    id: "61000000-0000-4000-8000-000000000101",
    name: "Jonah Pike",
    email: "jonah.pike@fil-one-internal.test",
  },
  sofia: {
    id: "61000000-0000-4000-8000-000000000102",
    name: "Sofia Marchetti",
    email: "sofia.marchetti@fil-one-internal.test",
  },
} as const;

interface Fixture {
  key: number;
  owner: "viewer" | keyof typeof colleagues;
  company: string;
  shortName: string;
  entity: string;
  street: string;
  locality: string;
  signer: [name: string, title: string, email: string];
  countersigner?: 1;
  state: MndaState;
  /** Days before now: created, sent, completed (or closed). */
  createdDaysAgo: number;
  sentDaysAgo?: number;
  remindedDaysAgo?: number;
  completedDaysAgo?: number;
  error?: string;
  cancel?: { code: MndaRecord["cancelCode"]; reason: string | null };
  /** Staff left the entity and signer title for the partner, who completed
   * them at signing. */
  partnerCompleted?: true;
}

const fixtures: readonly Fixture[] = [
  {
    key: 1,
    owner: "viewer",
    company: "Larkspur Genomics, Inc.",
    shortName: "Larkspur",
    entity: "Delaware corporation",
    street: "1 Example Pier, Suite 410",
    locality: "Fictional City, CA 00001, United States",
    signer: [
      "Dana Whitfield",
      "VP Research Operations",
      "dana.whitfield@larkspur-genomics.test",
    ],
    state: "draft",
    createdDaysAgo: 0,
  },
  {
    key: 2,
    owner: "viewer",
    company: "Tidewater Media Group LLC",
    shortName: "Tidewater",
    entity: "New York limited liability company",
    street: "2 Example Lane, Floor 5",
    locality: "Fictional City, NY 00002, United States",
    signer: [
      "Rafael Ortega",
      "Head of Archives",
      "rafael.ortega@tidewater-media.test",
    ],
    state: "sent",
    createdDaysAgo: 3,
    sentDaysAgo: 3,
  },
  {
    key: 3,
    owner: "jonah",
    company: "Quarry Lane Robotics GmbH",
    shortName: "Quarry Lane",
    entity: "German limited liability company (GmbH)",
    street: "Beispielweg 3",
    locality: "00003 Musterstadt, Germany",
    signer: [
      "Katrin Vogel",
      "Managing Director",
      "katrin.vogel@quarrylane-robotics.test",
    ],
    state: "viewed",
    createdDaysAgo: 9,
    sentDaysAgo: 9,
    remindedDaysAgo: 4,
  },
  {
    key: 4,
    owner: "viewer",
    company: "Saltmarsh Climate Data Ltd",
    shortName: "Saltmarsh",
    entity: "private limited company registered in England and Wales",
    street: "4 Example Wharf",
    locality: "Fictional Town XX0 0XX, United Kingdom",
    signer: [
      "Owen Pritchard",
      "Chief Technology Officer",
      "owen.pritchard@saltmarsh-climate.test",
    ],
    state: "awaiting_countersignature",
    createdDaysAgo: 6,
    sentDaysAgo: 5,
  },
  {
    key: 5,
    owner: "viewer",
    company: "Fernhill Research Institute",
    shortName: "Fernhill",
    entity: "Massachusetts nonprofit corporation",
    street: "5 Example Avenue",
    locality: "Fictional City, MA 00005, United States",
    signer: [
      "Grace Adeyemi",
      "Director of Partnerships",
      "grace.adeyemi@fernhill-research.test",
    ],
    countersigner: 1,
    state: "completed",
    createdDaysAgo: 8,
    sentDaysAgo: 7,
    completedDaysAgo: 2,
  },
  {
    key: 6,
    owner: "viewer",
    company: "Copperline Logistics Corp.",
    shortName: "Copperline",
    entity: "Texas corporation",
    street: "6 Example Parkway",
    locality: "Fictional City, TX 00006, United States",
    signer: [
      "Luis Navarro",
      "Director of IT",
      "luis.navarro@copperline-logistics.test",
    ],
    state: "attention",
    createdDaysAgo: 2,
    sentDaysAgo: 2,
    error: "recipient_bounced",
  },
  {
    key: 7,
    owner: "sofia",
    company: "Orchard Street Studios Inc.",
    shortName: "Orchard Street",
    entity: "California corporation",
    street: "7 Example Boulevard",
    locality: "Fictional City, CA 00007, United States",
    signer: [
      "Mina Park",
      "Head of Post-Production",
      "mina.park@orchardstreet-studios.test",
    ],
    state: "completed",
    createdDaysAgo: 24,
    sentDaysAgo: 23,
    completedDaysAgo: 19,
  },
  {
    key: 8,
    owner: "jonah",
    company: "Kestrel Bio SAS",
    shortName: "Kestrel Bio",
    entity: "French simplified joint-stock company (SAS)",
    street: "8 rue de l’Exemple",
    locality: "00008 Ville-Fictive, France",
    signer: [
      "Camille Durand",
      "Chief Data Officer",
      "camille.durand@kestrel-bio.test",
    ],
    state: "canceled",
    createdDaysAgo: 15,
    sentDaysAgo: 14,
    completedDaysAgo: 12,
    cancel: {
      code: "voided",
      reason: "Partner asked to sign their own NDA through procurement.",
    },
  },
  {
    key: 9,
    owner: "sofia",
    company: "Halden Archives AS",
    shortName: "Halden",
    entity: "Norwegian private limited company (AS)",
    street: "Eksempelgata 9",
    locality: "0009 Fiktivby, Norway",
    signer: [
      "Ingrid Solberg",
      "Chief Executive Officer",
      "ingrid.solberg@halden-archives.test",
    ],
    state: "sent",
    createdDaysAgo: 16,
    sentDaysAgo: 16,
    remindedDaysAgo: 6,
  },
  {
    key: 10,
    owner: "jonah",
    company: "Pinecrest Mapping Co.",
    shortName: "Pinecrest",
    entity: "Colorado corporation",
    street: "10 Example Street",
    locality: "Fictional City, CO 00010, United States",
    signer: ["Theo Brandt", "Founder", "theo.brandt@pinecrest-mapping.test"],
    countersigner: 1,
    state: "completed",
    createdDaysAgo: 52,
    sentDaysAgo: 51,
    completedDaysAgo: 47,
    partnerCompleted: true,
  },
];

const ago = (now: Date, days: number) =>
  new Date(now.getTime() - days * day - 2 * hour).toISOString();

function record(fixture: Fixture, viewer: DemoMndaViewer, now: Date) {
  const owner = fixture.owner === "viewer" ? viewer : colleagues[fixture.owner];
  const countersigner = demoMndaSigners[fixture.countersigner ?? 0];
  if (!countersigner) throw new Error("demo countersigner missing");
  const [signerName, signerTitle, signerEmail] = fixture.signer;
  const id = `61000000-0000-4000-8000-${String(fixture.key).padStart(12, "0")}`;
  const createdAt = ago(now, fixture.createdDaysAgo);
  const sentAt =
    fixture.sentDaysAgo === undefined ? null : ago(now, fixture.sentDaysAgo);
  const closedAt =
    fixture.completedDaysAgo === undefined
      ? null
      : ago(now, fixture.completedDaysAgo);
  const remindedAt =
    fixture.remindedDaysAgo === undefined
      ? null
      : ago(now, fixture.remindedDaysAgo);
  return {
    id,
    input: {
      id,
      detailsMode: fixture.partnerCompleted ? "mixed" : "team",
      company: fixture.company,
      shortName: fixture.shortName,
      entityDescription: fixture.partnerCompleted ? "" : fixture.entity,
      streetAddress: fixture.street,
      locality: fixture.locality,
      noticesContact: signerName,
      noticesEmail: signerEmail,
      signerName,
      signerEmail,
      signerTitle: fixture.partnerCompleted ? "" : signerTitle,
      countersignerId: countersigner.id,
      effectiveDate: createdAt.slice(0, 10),
    },
    countersigner,
    noticeEmail: demoMndaNoticeEmail,
    ownerId: owner.id,
    ownerName: owner.name,
    ownerEmail: owner.email,
    correctedSignerEmail: null,
    pendingSignerEmail: null,
    state: fixture.state,
    providerId: sentAt ? `demo-${fixture.key}` : null,
    testMode: false,
    templateHash: "0".repeat(64),
    createdAt,
    updatedAt: closedAt ?? remindedAt ?? sentAt ?? createdAt,
    sentAt,
    remindedAt,
    completedAt: fixture.state === "completed" ? closedAt : null,
    cancelCode: fixture.cancel?.code ?? null,
    cancelReason: fixture.cancel?.reason ?? null,
    partnerDetails: fixture.partnerCompleted
      ? { entity: fixture.entity, signer_title: signerTitle }
      : null,
    error: fixture.error ?? null,
    version: 1,
  } satisfies MndaRecord;
}

/** Every demo request, newest first, as the register orders them. */
export function demoMndaRecords(
  viewer: DemoMndaViewer,
  now: Date,
): MndaRecord[] {
  return fixtures
    .map((fixture) => record(fixture, viewer, now))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** The repository's register filter, over the demo records. */
function matches(
  record: MndaRecord,
  query: MndaRegisterQuery,
  viewerId: string,
) {
  if (query.status.length > 0) {
    if (!query.status.includes(record.state)) return false;
  } else if (record.state === "canceled" && !record.providerId) return false;
  if (query.mine && record.ownerId !== viewerId) return false;
  if (!query.q) return true;
  const needle = query.q.toLowerCase();
  return [
    record.input.company,
    record.input.signerName,
    record.input.signerEmail,
    record.correctedSignerEmail ?? "",
    record.ownerName,
    ...mndaSearchableDetailFields.map(
      (id) => record.partnerDetails?.[id] ?? "",
    ),
  ].some((value) => value.toLowerCase().includes(needle));
}

export function demoMndaRows(
  raw: Partial<MndaRegisterQuery>,
  viewer: DemoMndaViewer,
  now: Date,
): MndaRecord[] {
  const query = MndaRegisterQuerySchema.parse(raw);
  return demoMndaRecords(viewer, now).filter((record) =>
    matches(record, query, viewer.id),
  );
}

export function demoMndaRegister(
  raw: Partial<MndaRegisterQuery>,
  viewer: DemoMndaViewer,
  now: Date,
): MndaRegisterPage {
  const query = MndaRegisterQuerySchema.parse(raw);
  const rows = demoMndaRows(query, viewer, now);
  const start = (query.page - 1) * query.pageSize;
  return {
    records: rows.slice(start, start + query.pageSize),
    total: rows.length,
    page: query.page,
    pageSize: query.pageSize,
  };
}

/** The staff home tallies, counted the way the database query counts them. */
export function demoMndaHomeCounts(
  viewer: DemoMndaViewer,
  now: Date,
  completedSince: Date,
): SalesHomeMndaCounts {
  const tally = () => ({
    attention: 0,
    waitingPartner: 0,
    waitingFilOne: 0,
    completed: 0,
    drafts: 0,
  });
  const counts = { mine: tally(), team: tally() };
  for (const r of demoMndaRecords(viewer, now)) {
    const group =
      r.state === "sent" || r.state === "viewed"
        ? "waitingPartner"
        : r.state === "awaiting_countersignature"
          ? "waitingFilOne"
          : r.state === "completed"
            ? r.completedAt &&
              Date.parse(r.completedAt) >= completedSince.getTime()
              ? "completed"
              : null
            : ["draft", "preparing", "ready", "sending"].includes(r.state)
              ? "drafts"
              : r.state === "attention"
                ? "attention"
                : null;
    if (!group) continue;
    counts.team[group] += 1;
    if (r.ownerId === viewer.id) counts.mine[group] += 1;
  }
  return counts;
}
