import type {
  HubSpotAssociation,
  HubSpotCompany,
  HubSpotContact,
  HubSpotDeal,
  HubSpotFile,
  HubSpotNote,
  HubSpotObjectType,
  HubSpotOwner,
  HubSpotPipeline,
  HubSpotPortal,
  HubSpotPropertyDefinition,
} from "@clockwork/contracts";

import { HubSpotError, type HubSpotReader } from "./client";

/**
 * A fictional HubSpot portal for the guided demo and tests. Every company,
 * person and deal is invented. It behaves like the HTTP reader: it returns
 * only the properties asked for, resolves association labels, and can be told
 * to fail a download or change a record so retries and stale reviews can be
 * exercised.
 */
interface FakePortal {
  portal: HubSpotPortal;
  owners: HubSpotOwner[];
  pipelines: HubSpotPipeline[];
  properties: HubSpotPropertyDefinition[];
  companies: Map<string, Record<string, string | null>>;
  deals: Map<string, Record<string, string | null>>;
  contacts: Map<string, HubSpotContact>;
  notes: Map<string, HubSpotNote>;
  files: Map<
    string,
    Omit<HubSpotFile, "noteId"> & { bytes: Uint8Array | null }
  >;
  /** `${from}:${id}:${to}` → associations. */
  associations: Map<string, HubSpotAssociation[]>;
}

/** A minimal, valid single-page PDF so retention checks pass on real bytes. */
export function fakeHubSpotPdf(title: string): Uint8Array {
  const text = title.replace(/[()\\]/g, "");
  const stream = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets)
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

const property = (
  objectType: HubSpotObjectType,
  name: string,
  label: string,
  extra: Partial<HubSpotPropertyDefinition> = {},
): HubSpotPropertyDefinition => ({
  objectType,
  name,
  label,
  type: "string",
  fieldType: "text",
  options: [],
  sensitive: false,
  hubspotDefined: true,
  calculated: false,
  ...extra,
});

/** Instants relative to `now`, so the demo always reads as current. */
function relative(now: Date) {
  return (days: number) =>
    new Date(now.getTime() + days * 86_400_000).toISOString();
}

function fixture(now: Date): FakePortal {
  const at = relative(now);
  const day = (days: number) => at(days).slice(0, 10) + "T00:00:00.000Z";
  const companies = new Map<string, Record<string, string | null>>([
    [
      "9001",
      {
        name: "Northstar Systems",
        domain: "northstar.example",
        website: null,
        country: "United States",
        hubspot_owner_id: "101",
        hs_lastmodifieddate: at(-2),
        industry: "Information Technology and Services",
        partner_tier: "gold",
        tax_id: "00-0000000",
      },
    ],
    [
      "9002",
      {
        name: "Halcyon Research Cooperative",
        domain: "halcyon.example",
        website: "https://www.halcyon.example",
        country: "Canada",
        hubspot_owner_id: "102",
        hs_lastmodifieddate: at(-6),
        industry: "Research",
        partner_tier: null,
        tax_id: null,
      },
    ],
    [
      "9003",
      {
        name: "Larchmont Data Services",
        domain: "larchmont.example",
        website: "https://larchmont.example",
        country: "Netherlands",
        hubspot_owner_id: "101",
        hs_lastmodifieddate: at(-1),
        industry: "Information Technology and Services",
        partner_tier: "silver",
        tax_id: null,
      },
    ],
    [
      "9004",
      {
        name: "Brightwater Archives",
        domain: "brightwater.example",
        website: null,
        country: "United Kingdom",
        hubspot_owner_id: "103",
        hs_lastmodifieddate: at(-12),
        industry: "Libraries",
        partner_tier: null,
        tax_id: null,
      },
    ],
    [
      "9005",
      {
        name: "Meridian Cloud GmbH",
        domain: "meridian.example",
        website: "https://meridian.example",
        country: "Germany",
        hubspot_owner_id: "102",
        hs_lastmodifieddate: at(-3),
        industry: "Computer Software",
        partner_tier: "platinum",
        tax_id: null,
      },
    ],
    [
      "9006",
      {
        name: "Northstar Systems Europe",
        domain: "northstar-eu.example",
        website: null,
        country: "Ireland",
        hubspot_owner_id: "101",
        hs_lastmodifieddate: at(-20),
        industry: null,
        partner_tier: null,
        tax_id: null,
      },
    ],
  ]);
  const deal = (
    name: string,
    stage: string,
    amount: string | null,
    currency: string | null,
    closeIn: number,
    owner: string | null,
    pipeline = "default",
  ) => ({
    dealname: name,
    pipeline,
    dealstage: stage,
    amount,
    deal_currency_code: currency,
    closedate: day(closeIn),
    hubspot_owner_id: owner,
    hs_lastmodifieddate: at(-1),
    deal_source: "Partner referral",
  });
  const deals = new Map<string, Record<string, string | null>>([
    [
      "7001",
      deal(
        "Halcyon archive tier via Northstar",
        "closedwon",
        "48000",
        "USD",
        -8,
        "101",
      ),
    ],
    [
      "7002",
      deal(
        "Meridian cold storage expansion",
        "contractsent",
        "125000",
        "EUR",
        21,
        "102",
      ),
    ],
    [
      "7003",
      deal(
        "Brightwater digitization pilot",
        "qualifiedtobuy",
        null,
        "GBP",
        45,
        "103",
      ),
    ],
    [
      "7004",
      deal(
        "Larchmont referral: municipal records",
        "presentationscheduled",
        "30000",
        "USD",
        30,
        "101",
      ),
    ],
    [
      "7005",
      deal(
        "Inbound research data enquiry",
        "appointmentscheduled",
        "15000",
        "USD",
        60,
        null,
      ),
    ],
    [
      "7006",
      deal(
        "Northstar EU distribution",
        "appointmentscheduled",
        "60000",
        "EUR",
        75,
        "101",
      ),
    ],
    [
      "7007",
      deal("Halcyon second site", "closedlost", "22000", "USD", -30, "102"),
    ],
    [
      "7008",
      deal(
        "Meridian renewal",
        "renewal_open",
        "90000",
        "EUR",
        120,
        "102",
        "renewals",
      ),
    ],
  ]);
  const contacts = new Map<string, HubSpotContact>(
    (
      [
        [
          "5001",
          "Ada",
          "Okafor",
          "ada.okafor@northstar.example",
          "VP Partnerships",
        ],
        [
          "5002",
          "Marcus",
          "Hale",
          "marcus.hale@northstar.example",
          "Solutions Architect",
        ],
        [
          "5003",
          "Ines",
          "Albright",
          "ines.albright@halcyon.example",
          "Director of Research Computing",
        ],
        [
          "5004",
          "Joris",
          "Bakker",
          "joris@larchmont.example",
          "Managing Partner",
        ],
      ] as const
    ).map(([id, firstName, lastName, email, jobTitle]) => [
      id,
      { id, firstName, lastName, email, jobTitle, updatedAt: at(-4) },
    ]),
  );
  const notes = new Map<string, HubSpotNote>([
    [
      "6001",
      {
        id: "6001",
        body: "Kickoff call: Northstar will resell the archive tier to Halcyon. Order form attached; Halcyon describes it as signed.",
        ownerId: "101",
        timestamp: at(-9),
        attachmentIds: ["8001"],
      },
    ],
    [
      "6002",
      {
        id: "6002",
        body: "Asked about a not-for-resale allowance for their lab.\nLogo for the co-marketing page attached.",
        ownerId: null,
        timestamp: at(-15),
        attachmentIds: ["8002"],
      },
    ],
  ]);
  const files = new Map<
    string,
    Omit<HubSpotFile, "noteId"> & { bytes: Uint8Array | null }
  >([
    [
      "8001",
      {
        id: "8001",
        name: "Halcyon order form (signed).pdf",
        extension: "pdf",
        size: null,
        updatedAt: at(-9),
        availability: "available",
        bytes: fakeHubSpotPdf("Halcyon order form"),
      },
    ],
    [
      "8002",
      {
        id: "8002",
        name: "northstar-logo.png",
        extension: "png",
        size: 48_211,
        updatedAt: at(-15),
        availability: "unsupported_type",
        bytes: null,
      },
    ],
  ]);
  for (const file of files.values())
    if (file.bytes) file.size = file.bytes.byteLength;
  const associations = new Map<string, HubSpotAssociation[]>([
    [
      "deal:7001:company",
      [
        { id: "9001", labels: ["Reseller"] },
        { id: "9002", labels: ["Primary", "End customer"] },
      ],
    ],
    ["deal:7002:company", [{ id: "9005", labels: ["Primary"] }]],
    ["deal:7003:company", [{ id: "9004", labels: ["Primary"] }]],
    [
      "deal:7004:company",
      [{ id: "9003", labels: ["Primary", "Referral partner"] }],
    ],
    ["deal:7005:company", []],
    [
      "deal:7006:company",
      [
        { id: "9006", labels: ["Primary"] },
        { id: "9001", labels: ["Parent company"] },
      ],
    ],
    ["deal:7007:company", [{ id: "9002", labels: ["Primary"] }]],
    ["deal:7008:company", [{ id: "9005", labels: ["Primary"] }]],
    [
      "deal:7001:contact",
      [
        { id: "5001", labels: ["Decision maker"] },
        { id: "5003", labels: ["Budget holder"] },
      ],
    ],
    ["deal:7001:note", [{ id: "6001", labels: [] }]],
    [
      "company:9001:contact",
      [
        { id: "5001", labels: ["Decision maker"] },
        { id: "5002", labels: [] },
      ],
    ],
    ["company:9002:contact", [{ id: "5003", labels: [] }]],
    ["company:9003:contact", [{ id: "5004", labels: ["Primary"] }]],
    [
      "company:9001:note",
      [
        { id: "6001", labels: [] },
        { id: "6002", labels: [] },
      ],
    ],
    [
      "company:9001:deal",
      [
        { id: "7001", labels: [] },
        { id: "7006", labels: [] },
      ],
    ],
    [
      "company:9002:deal",
      [
        { id: "7001", labels: [] },
        { id: "7007", labels: [] },
      ],
    ],
    ["company:9003:deal", [{ id: "7004", labels: [] }]],
    ["company:9004:deal", [{ id: "7003", labels: [] }]],
    [
      "company:9005:deal",
      [
        { id: "7002", labels: [] },
        { id: "7008", labels: [] },
      ],
    ],
    ["company:9006:deal", [{ id: "7006", labels: [] }]],
  ]);
  return {
    portal: {
      portalId: "4410",
      uiDomain: "app.hubspot.com",
      timeZone: "America/New_York",
      companyCurrency: "USD",
    },
    owners: [
      {
        id: "101",
        name: "Priya Raman",
        email: "priya.raman@filone.example",
        archived: false,
      },
      {
        id: "102",
        name: "Tomás Ferreira",
        email: "tomas.ferreira@filone.example",
        archived: false,
      },
      {
        id: "103",
        name: "Lena Vogt",
        email: "lena.vogt@filone.example",
        archived: true,
      },
    ],
    pipelines: [
      {
        id: "default",
        label: "Partner pipeline",
        displayOrder: 0,
        stages: [
          {
            id: "appointmentscheduled",
            label: "Discovery",
            displayOrder: 0,
            closed: false,
          },
          {
            id: "qualifiedtobuy",
            label: "Qualified",
            displayOrder: 1,
            closed: false,
          },
          {
            id: "presentationscheduled",
            label: "Proposal",
            displayOrder: 2,
            closed: false,
          },
          {
            id: "contractsent",
            label: "Contract sent",
            displayOrder: 3,
            closed: false,
          },
          {
            id: "closedwon",
            label: "Closed won",
            displayOrder: 4,
            closed: true,
          },
          {
            id: "closedlost",
            label: "Closed lost",
            displayOrder: 5,
            closed: true,
          },
        ],
      },
      {
        id: "renewals",
        label: "Renewals",
        displayOrder: 1,
        stages: [
          {
            id: "renewal_open",
            label: "Renewal open",
            displayOrder: 0,
            closed: false,
          },
          {
            id: "renewal_done",
            label: "Renewed",
            displayOrder: 1,
            closed: true,
          },
        ],
      },
    ],
    properties: [
      property("company", "name", "Company name"),
      property("company", "domain", "Company domain name"),
      property("company", "website", "Website URL"),
      property("company", "country", "Country/Region"),
      property("company", "hubspot_owner_id", "Company owner"),
      property("company", "hs_lastmodifieddate", "Last modified date", {
        type: "datetime",
      }),
      property("company", "industry", "Industry", { type: "enumeration" }),
      property("company", "partner_tier", "Partner tier", {
        type: "enumeration",
        fieldType: "select",
        hubspotDefined: false,
        options: [
          { label: "Silver", value: "silver" },
          { label: "Gold", value: "gold" },
          { label: "Platinum", value: "platinum" },
        ],
      }),
      property("company", "tax_id", "Tax ID", {
        hubspotDefined: false,
        sensitive: true,
      }),
      property("deal", "dealname", "Deal name"),
      property("deal", "amount", "Amount", { type: "number" }),
      property("deal", "deal_currency_code", "Currency"),
      property("deal", "closedate", "Close date", { type: "datetime" }),
      property("deal", "pipeline", "Pipeline"),
      property("deal", "dealstage", "Deal stage"),
      property("deal", "hubspot_owner_id", "Deal owner"),
      property("deal", "hs_lastmodifieddate", "Last modified date", {
        type: "datetime",
      }),
      property("deal", "deal_source", "Deal source", { hubspotDefined: false }),
      property("contact", "firstname", "First name"),
      property("contact", "lastname", "Last name"),
      property("contact", "email", "Email"),
      property("contact", "jobtitle", "Job title"),
      property("contact", "lastmodifieddate", "Last modified date", {
        type: "datetime",
      }),
    ],
    companies,
    deals,
    contacts,
    notes,
    files,
    associations,
  };
}

const pick = (
  values: Record<string, string | null>,
  properties: readonly string[],
) =>
  Object.fromEntries(
    properties
      .filter((name) => Object.hasOwn(values, name))
      .map((name) => [name, values[name] ?? null]),
  );

const companyBase = new Set([
  "name",
  "domain",
  "website",
  "country",
  "hubspot_owner_id",
  "hs_lastmodifieddate",
]);
const dealBase = new Set([
  "dealname",
  "amount",
  "deal_currency_code",
  "closedate",
  "pipeline",
  "dealstage",
  "hubspot_owner_id",
  "hs_lastmodifieddate",
]);

export class FakeHubSpotReader implements HubSpotReader {
  private readonly data: FakePortal;
  private failures = new Map<string, number>();
  /** Every request, by method, so tests can assert what was read. */
  public readonly calls: string[] = [];

  public constructor(now: Date = new Date("2026-10-22T15:00:00.000Z")) {
    this.data = fixture(now);
  }

  /** The next `times` downloads of a file fail as unavailable. */
  public failDownload(fileId: string, times = 1): void {
    this.failures.set(fileId, times);
  }

  /** Changes a company property, as a HubSpot user would. */
  public updateCompany(id: string, values: Record<string, string | null>) {
    const company = this.data.companies.get(id);
    if (!company) throw new Error("FAKE_COMPANY_MISSING");
    Object.assign(company, values, {
      hs_lastmodifieddate: new Date().toISOString(),
    });
  }

  public archiveCompany(id: string) {
    this.updateCompany(id, { __archived: "true" });
  }

  portal() {
    this.calls.push("portal");
    return Promise.resolve({ ...this.data.portal });
  }

  properties(objectType: HubSpotObjectType) {
    this.calls.push(`properties:${objectType}`);
    return Promise.resolve(
      this.data.properties.filter((p) => p.objectType === objectType),
    );
  }

  owners() {
    this.calls.push("owners");
    return Promise.resolve([...this.data.owners]);
  }

  pipelines() {
    this.calls.push("pipelines");
    return Promise.resolve(this.data.pipelines);
  }

  private company(
    id: string,
    properties: readonly string[],
  ): HubSpotCompany | null {
    const values = this.data.companies.get(id);
    if (!values) return null;
    const picked = pick(values, properties);
    return {
      id,
      name: values.name ?? null,
      domain: values.domain ?? null,
      website: values.website ?? null,
      country: values.country ?? null,
      ownerId: values.hubspot_owner_id ?? null,
      updatedAt: values.hs_lastmodifieddate ?? null,
      archived: values.__archived === "true",
      properties: Object.fromEntries(
        Object.entries(picked).filter(([name]) => !companyBase.has(name)),
      ),
    };
  }

  private deal(id: string, properties: readonly string[]): HubSpotDeal | null {
    const values = this.data.deals.get(id);
    if (!values) return null;
    const picked = pick(values, properties);
    return {
      id,
      name: values.dealname ?? null,
      pipelineId: values.pipeline ?? null,
      stageId: values.dealstage ?? null,
      amount: values.amount ?? null,
      currency: values.deal_currency_code ?? null,
      closeDate: values.closedate ?? null,
      ownerId: values.hubspot_owner_id ?? null,
      updatedAt: values.hs_lastmodifieddate ?? null,
      archived: false,
      properties: Object.fromEntries(
        Object.entries(picked).filter(([name]) => !dealBase.has(name)),
      ),
    };
  }

  searchCompanies(input: {
    query: string;
    properties: readonly string[];
    limit: number;
  }) {
    this.calls.push(`searchCompanies:${input.query}`);
    const query = input.query.trim().toLowerCase();
    return Promise.resolve(
      [...this.data.companies.entries()]
        .filter(
          ([, values]) =>
            values.__archived !== "true" &&
            `${values.name ?? ""} ${values.domain ?? ""}`
              .toLowerCase()
              .includes(query),
        )
        .slice(0, input.limit)
        .flatMap(([id]) => {
          const company = this.company(id, input.properties);
          return company ? [company] : [];
        }),
    );
  }

  searchDeals(input: {
    query: string;
    properties: readonly string[];
    limit: number;
  }) {
    this.calls.push(`searchDeals:${input.query}`);
    const query = input.query.trim().toLowerCase();
    return Promise.resolve(
      [...this.data.deals.entries()]
        .filter(([, values]) =>
          (values.dealname ?? "").toLowerCase().includes(query),
        )
        .slice(0, input.limit)
        .flatMap(([id]) => {
          const deal = this.deal(id, input.properties);
          return deal ? [deal] : [];
        }),
    );
  }

  companies(ids: readonly string[], properties: readonly string[]) {
    this.calls.push(`companies:${ids.join(",")}`);
    return Promise.resolve(
      ids.flatMap((id) => {
        const company = this.company(id, properties);
        return company ? [company] : [];
      }),
    );
  }

  deals(ids: readonly string[], properties: readonly string[]) {
    this.calls.push(`deals:${ids.join(",")}`);
    return Promise.resolve(
      ids.flatMap((id) => {
        const deal = this.deal(id, properties);
        return deal ? [deal] : [];
      }),
    );
  }

  contacts(ids: readonly string[]) {
    this.calls.push(`contacts:${ids.join(",")}`);
    return Promise.resolve(
      ids.flatMap((id) => {
        const contact = this.data.contacts.get(id);
        return contact ? [{ ...contact }] : [];
      }),
    );
  }

  associations(
    from: "company" | "deal",
    id: string,
    to: "company" | "deal" | "contact" | "note",
  ) {
    this.calls.push(`associations:${from}:${id}:${to}`);
    if (from === "company" && !this.data.companies.has(id))
      return Promise.reject(new HubSpotError("HUBSPOT_RECORD_NOT_FOUND"));
    if (from === "deal" && !this.data.deals.has(id))
      return Promise.reject(new HubSpotError("HUBSPOT_RECORD_NOT_FOUND"));
    return Promise.resolve([
      ...(this.data.associations.get(`${from}:${id}:${to}`) ?? []),
    ]);
  }

  dealCompanies(dealIds: readonly string[]) {
    this.calls.push(`dealCompanies:${dealIds.length}`);
    return Promise.resolve(
      new Map(
        dealIds.map((id) => [
          id,
          [...(this.data.associations.get(`deal:${id}:company`) ?? [])],
        ]),
      ),
    );
  }

  notes(ids: readonly string[]) {
    this.calls.push(`notes:${ids.join(",")}`);
    return Promise.resolve(
      ids.flatMap((id) => {
        const note = this.data.notes.get(id);
        return note ? [{ ...note }] : [];
      }),
    );
  }

  file(id: string, noteId: string) {
    this.calls.push(`file:${id}`);
    const file = this.data.files.get(id);
    if (!file) return Promise.resolve(null);
    return Promise.resolve({
      id: file.id,
      name: file.name,
      extension: file.extension,
      size: file.size,
      updatedAt: file.updatedAt,
      availability: file.availability,
      noteId,
    });
  }

  download(id: string, maxBytes: number) {
    this.calls.push(`download:${id}`);
    const remaining = this.failures.get(id) ?? 0;
    if (remaining > 0) {
      this.failures.set(id, remaining - 1);
      return Promise.reject(new HubSpotError("HUBSPOT_DOCUMENT_UNAVAILABLE"));
    }
    const file = this.data.files.get(id);
    if (!file?.bytes)
      return Promise.reject(new HubSpotError("HUBSPOT_DOCUMENT_UNAVAILABLE"));
    if (file.bytes.byteLength > maxBytes)
      return Promise.reject(new HubSpotError("HUBSPOT_DOCUMENT_INVALID"));
    return Promise.resolve(new Uint8Array(file.bytes));
  }

  pipelineDeals(input: {
    pipelineId: string;
    stageIds: readonly string[];
    properties: readonly string[];
    after: string | null;
    limit: number;
  }) {
    this.calls.push(`pipelineDeals:${input.pipelineId}:${input.after ?? ""}`);
    const matching = [...this.data.deals.entries()]
      .filter(
        ([, values]) =>
          values.pipeline === input.pipelineId &&
          (input.stageIds.length === 0 ||
            input.stageIds.includes(values.dealstage ?? "")),
      )
      .map(([id]) => id)
      .sort();
    const start = input.after ? Number(input.after) : 0;
    const page = matching.slice(start, start + input.limit);
    const next =
      start + input.limit < matching.length
        ? String(start + input.limit)
        : null;
    return Promise.resolve({
      deals: page.flatMap((id) => {
        const deal = this.deal(id, input.properties);
        return deal ? [deal] : [];
      }),
      next,
      total: matching.length,
    });
  }
}
