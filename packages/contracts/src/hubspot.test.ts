import { describe, expect, it } from "vitest";

import {
  HubSpotConnectionInputSchema,
  HubSpotHandoffInputSchema,
  HubSpotPipelineQuerySchema,
  canonicalHubSpotJson,
  classifyHubSpotDrift,
  countHubSpotPlan,
  defaultHubSpotDecision,
  hubspotDealLinkState,
  hubspotFieldAction,
  hubspotImportStatus,
  hubspotPipelineSearchParams,
  hubspotPlanIsLinkOnly,
  hubspotPropertyAllowed,
  hubspotRecordUrl,
  normalizeHubSpotWebsite,
  parseHubSpotRecordUrl,
  summarizeHubSpotPipeline,
  type HubSpotHandoffPlan,
  type HubSpotPipelineDeal,
} from "./hubspot";
import { PartnerInputSchema } from "./partners";

const operationId = "019a44ae-0000-7000-8000-00000000b001";
const partnerId = "019a44ae-0000-7000-8000-00000000b002";
const digest = "a".repeat(64);

describe("parseHubSpotRecordUrl", () => {
  it("reads company and deal URLs in both HubSpot spellings", () => {
    expect(
      parseHubSpotRecordUrl(
        "https://app.hubspot.com/contacts/4410/company/9001?tab=overview",
      ),
    ).toEqual({ portalId: "4410", objectType: "company", objectId: "9001" });
    expect(
      parseHubSpotRecordUrl(
        " https://app-eu1.hubspot.com/contacts/4410/record/0-3/77/ ",
      ),
    ).toEqual({ portalId: "4410", objectType: "deal", objectId: "77" });
  });

  it("refuses anything that is not a HubSpot record page", () => {
    for (const url of [
      "http://app.hubspot.com/contacts/1/company/2",
      "https://app.hubspot.com.evil.example/contacts/1/company/2",
      "https://evilapp.hubspot.com/contacts/1/company/2",
      "https://app.hubspot.com/contacts/1/record/0-1/2",
      "https://app.hubspot.com/contacts/abc/company/2",
      "northstar",
    ])
      expect(parseHubSpotRecordUrl(url)).toBeNull();
  });

  it("builds record links on the portal's own host only", () => {
    expect(
      hubspotRecordUrl(
        { portalId: "4410", uiDomain: "app-eu1.hubspot.com" },
        "deal",
        "77",
      ),
    ).toBe("https://app-eu1.hubspot.com/contacts/4410/record/0-3/77");
    expect(
      hubspotRecordUrl(
        { portalId: "4410", uiDomain: "evil.example" },
        "company",
        "9",
      ),
    ).toBe("https://app.hubspot.com/contacts/4410/record/0-2/9");
  });
});

describe("normalizeHubSpotWebsite", () => {
  it("prefers the website, falls back to the domain, and validates both", () => {
    expect(normalizeHubSpotWebsite(null, "northstar.example")).toBe(
      "https://northstar.example",
    );
    expect(
      normalizeHubSpotWebsite("http://www.northstar.example/about", null),
    ).toBe("http://www.northstar.example/about");
    expect(normalizeHubSpotWebsite("not a url", "localhost")).toBe("");
    expect(normalizeHubSpotWebsite("javascript:alert(1)", null)).toBe("");
    expect(
      normalizeHubSpotWebsite("https://user:pw@northstar.example", null),
    ).toBe("");
  });
});

describe("field decisions", () => {
  it("classifies three-way drift since the last import", () => {
    const base = { lastSource: "A", lastResult: "A" };
    expect(classifyHubSpotDrift({ ...base, commerce: "A", hubspot: "A" })).toBe(
      "unchanged",
    );
    expect(classifyHubSpotDrift({ ...base, commerce: "A", hubspot: "B" })).toBe(
      "hubspot_changed",
    );
    expect(classifyHubSpotDrift({ ...base, commerce: "C", hubspot: "A" })).toBe(
      "commerce_changed",
    );
    expect(classifyHubSpotDrift({ ...base, commerce: "C", hubspot: "B" })).toBe(
      "both_changed",
    );
    expect(
      classifyHubSpotDrift({
        lastSource: undefined,
        lastResult: undefined,
        commerce: "",
        hubspot: "B",
      }),
    ).toBe("never_imported");
  });

  it("keeps Commerce values unless a change is clearly safe to propose", () => {
    expect(
      defaultHubSpotDecision({
        drift: "never_imported",
        commerce: "",
        hubspot: "B",
      }),
    ).toBe("use_hubspot");
    expect(
      defaultHubSpotDecision({
        drift: "never_imported",
        commerce: "A",
        hubspot: "B",
      }),
    ).toBe("keep");
    expect(
      defaultHubSpotDecision({
        drift: "hubspot_changed",
        commerce: "A",
        hubspot: "B",
      }),
    ).toBe("use_hubspot");
    expect(
      defaultHubSpotDecision({
        drift: "commerce_changed",
        commerce: "C",
        hubspot: "A",
      }),
    ).toBe("keep");
    expect(
      defaultHubSpotDecision({
        drift: "both_changed",
        commerce: "C",
        hubspot: "B",
      }),
    ).toBeNull();
  });

  it("never lets an empty source value clear a Commerce value", () => {
    expect(hubspotFieldAction("use_hubspot", "Acme", "")).toEqual({
      action: "keep",
      result: "Acme",
    });
    expect(hubspotFieldAction("use_hubspot", "", "Acme")).toEqual({
      action: "add",
      result: "Acme",
    });
    expect(hubspotFieldAction("use_hubspot", "A", "B")).toEqual({
      action: "replace",
      result: "B",
    });
    expect(hubspotFieldAction("clear", "A", "B")).toEqual({
      action: "clear",
      result: "",
    });
    expect(hubspotFieldAction("clear", "", "B")).toEqual({
      action: "keep",
      result: "",
    });
  });
});

const handoff = (overrides: Record<string, unknown> = {}) => ({
  operationId,
  connection: { id: partnerId, version: 1 },
  source: { companyId: "9001", dealId: "77" },
  reviewed: { company: digest },
  destination: { kind: "new_partner", partnerId, name: "Northstar Systems" },
  ...overrides,
});

describe("HubSpotHandoffInputSchema", () => {
  it("starts with nothing optional selected and Prospect as status", () => {
    const parsed = HubSpotHandoffInputSchema.parse(handoff());
    expect(parsed).toMatchObject({
      contacts: [],
      notes: [],
      documents: [],
      includeDeal: false,
      endCustomerCompanyId: null,
      primaryContact: null,
      destination: { status: "prospect", ownerId: null, models: [] },
    });
  });

  it("refuses a primary contact that was not selected", () => {
    expect(
      HubSpotHandoffInputSchema.safeParse(
        handoff({ primaryContact: { kind: "hubspot", id: "5" } }),
      ).success,
    ).toBe(false);
  });

  it("needs the deal for an end customer, which cannot be the partner", () => {
    expect(
      HubSpotHandoffInputSchema.safeParse(
        handoff({ endCustomerCompanyId: "9002" }),
      ).success,
    ).toBe(false);
    expect(
      HubSpotHandoffInputSchema.safeParse(
        handoff({ includeDeal: true, endCustomerCompanyId: "9001" }),
      ).success,
    ).toBe(false);
    expect(
      HubSpotHandoffInputSchema.safeParse(
        handoff({ includeDeal: true, endCustomerCompanyId: "9002" }),
      ).success,
    ).toBe(true);
  });

  it("refuses duplicate selections", () => {
    expect(
      HubSpotHandoffInputSchema.safeParse(
        handoff({ contacts: [{ hubspotId: "5" }, { hubspotId: "5" }] }),
      ).success,
    ).toBe(false);
  });
});

describe("HubSpotConnectionInputSchema", () => {
  it("requires the audience to be accepted explicitly", () => {
    const base = { portalId: "4410", scope: {} };
    expect(HubSpotConnectionInputSchema.safeParse(base).success).toBe(false);
    expect(
      HubSpotConnectionInputSchema.parse({ ...base, audienceAccepted: true })
        .scope,
    ).toEqual({
      company: [],
      deal: [],
      contact: [],
      notes: false,
      files: false,
    });
  });

  it("allows base properties and approved ones only", () => {
    const scope = {
      company: ["industry"],
      deal: [],
      contact: [],
      notes: false,
      files: false,
    };
    expect(hubspotPropertyAllowed(scope, "company", "name")).toBe(true);
    expect(hubspotPropertyAllowed(scope, "company", "industry")).toBe(true);
    expect(hubspotPropertyAllowed(scope, "company", "annualrevenue")).toBe(
      false,
    );
  });
});

const deal = (
  id: string,
  stageId: string,
  amount: string | null,
  currency: string | null,
): HubSpotPipelineDeal => ({
  id,
  name: `Deal ${id}`,
  stageId,
  amount,
  currency,
  closeDate: null,
  ownerId: null,
  ownerName: null,
  updatedAt: null,
  companies: [],
});

describe("summarizeHubSpotPipeline", () => {
  const pipeline = {
    stages: [
      { id: "s2", label: "Proposal", displayOrder: 2, closed: false },
      { id: "s1", label: "Discovery", displayOrder: 1, closed: false },
    ],
  };

  it("counts each deal once and keeps currencies apart", () => {
    const summary = summarizeHubSpotPipeline(pipeline, [
      deal("1", "s1", "1000.10", "USD"),
      deal("1", "s1", "1000.10", "USD"),
      deal("2", "s1", "250", "EUR"),
      deal("3", "s2", "0.2", "USD"),
      deal("4", "s2", null, "USD"),
      deal("5", "s2", "12", null),
    ]);
    expect(summary.deals).toBe(5);
    expect(summary.missingAmounts).toBe(2);
    expect(summary.totals).toEqual([
      { currency: "EUR", amount: "250", deals: 1 },
      { currency: "USD", amount: "1000.3", deals: 2 },
    ]);
    expect(summary.stages.map((stage) => [stage.id, stage.deals])).toEqual([
      ["s1", 2],
      ["s2", 3],
    ]);
    expect(summary.stages[1]?.missingAmounts).toBe(2);
  });

  it("reports how many of a deal's companies are linked", () => {
    const company = (partner: boolean) => ({
      id: "1",
      name: "A",
      labels: [],
      partner: partner ? { id: partnerId, name: "A" } : null,
    });
    expect(hubspotDealLinkState({ companies: [] })).toBe("none");
    expect(
      hubspotDealLinkState({ companies: [company(true), company(false)] }),
    ).toBe("partly");
    expect(hubspotDealLinkState({ companies: [company(true)] })).toBe("linked");
  });
});

describe("HubSpotPipelineQuerySchema", () => {
  it("falls back to defaults for unknown values and round-trips", () => {
    const query = HubSpotPipelineQuerySchema.parse({
      state: "weird",
      linked: "partly",
      owner: "x",
      view: "board",
      currency: "usd",
    });
    expect(query).toMatchObject({
      state: "open",
      linked: "partly",
      owner: undefined,
      view: "board",
      currency: undefined,
    });
    expect(hubspotPipelineSearchParams(query).toString()).toBe(
      "linked=partly&view=board",
    );
  });
});

describe("plans and imports", () => {
  const plan: HubSpotHandoffPlan = {
    operationId,
    destination: {
      kind: "existing_partner",
      partnerId,
      name: "Northstar",
      expectedVersion: 2,
    },
    fields: [
      {
        field: "website",
        action: "keep",
        current: "https://a.example",
        hubspot: "https://a.example",
        result: "https://a.example",
        drift: "unchanged",
        source: { property: "website", label: "Website", value: "a.example" },
      },
    ],
    contacts: [],
    primaryContactId: null,
    deal: null,
    notes: [],
    references: [],
    documents: [],
    dismissedSuggestions: [],
  };

  it("knows when a handoff only records the link", () => {
    expect(hubspotPlanIsLinkOnly(plan)).toBe(true);
    expect(countHubSpotPlan(plan)).toMatchObject({ create: false, kept: 1 });
  });

  it("is never complete while an item is open", () => {
    expect(hubspotImportStatus([])).toBe("complete");
    expect(
      hubspotImportStatus([{ status: "attached" }, { status: "failed" }]),
    ).toBe("needs_attention");
    expect(
      hubspotImportStatus([{ status: "attached" }, { status: "excluded" }]),
    ).toBe("completed_with_exclusions");
  });

  it("spells equal values once", () => {
    expect(canonicalHubSpotJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      '{"a":{"c":3,"d":2},"b":1}',
    );
  });
});

describe("partner contact identity", () => {
  const contact = {
    id: "019a44ae-0000-7000-8000-00000000c001",
    name: "Ada",
    source: {
      provider: "hubspot",
      portalId: "4410",
      objectId: "5",
      labels: ["Decision maker"],
    },
  };

  it("keeps a HubSpot identity through a partner save", () => {
    const parsed = PartnerInputSchema.parse({
      id: partnerId,
      name: "Northstar",
      contacts: [contact],
    });
    expect(parsed.contacts[0]).toMatchObject(contact);
  });

  it("allows one primary and no duplicate IDs", () => {
    expect(
      PartnerInputSchema.safeParse({
        id: partnerId,
        name: "N",
        contacts: [
          { ...contact, primary: true },
          { name: "B", primary: true },
        ],
      }).success,
    ).toBe(false);
    expect(
      PartnerInputSchema.safeParse({
        id: partnerId,
        name: "N",
        contacts: [contact, contact],
      }).success,
    ).toBe(false);
    expect(
      PartnerInputSchema.safeParse({
        id: partnerId,
        name: "N",
        contacts: [{ name: "B", source: contact.source }],
      }).success,
    ).toBe(false);
  });
});
