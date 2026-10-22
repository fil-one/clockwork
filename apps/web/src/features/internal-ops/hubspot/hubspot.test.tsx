import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  HubSpotHandoffInputSchema,
  HubSpotPipelineQuerySchema,
  PartnerTermsSchema,
  withPartnerContactIds,
  type HubSpotConnectionRecord,
  type HubSpotImportRecord,
  type PartnerRecord,
} from "@clockwork/contracts";
import { FakeHubSpotReader } from "@clockwork/integrations/hubspot";

const mocks = vi.hoisted(() => ({
  commit: vi.fn(),
  process: vi.fn(),
  exclude: vi.fn(),
  reuse: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  back: vi.fn(),
}));
vi.mock("./actions", () => ({
  commitHubSpotHandoff: mocks.commit,
  processHubSpotDocument: mocks.process,
  excludeHubSpotDocument: mocks.exclude,
  reuseHubSpotDocument: mocks.reuse,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mocks.push,
    refresh: mocks.refresh,
    back: mocks.back,
  }),
}));
vi.mock("@/src/auth/session", () => ({
  explicitDemoIdentityEnabled: () => false,
}));
vi.mock("@/src/db/service", () => ({
  getOptionalServiceDatabase: () => undefined,
}));

import { translatorFor } from "@/src/i18n/catalogs";

import { buildHubSpotPlan, changedReviewItems } from "./plan";
import { HubSpotSetupGuide, hubspotSetupStage } from "./setup-guide";
import { HubSpotReceipt } from "./receipt";
import { HandoffReview } from "./review";
import {
  loadHandoffSource,
  loadPipeline,
  searchHubSpot,
  type HubSpotContext,
  type HubSpotStore,
} from "./server";

const now = new Date("2026-10-22T15:00:00.000Z");
const partnerId = "019a44ae-0000-7000-8000-00000000e001";
const operationId = "019a44ae-0000-7000-8000-00000000e002";

const connection = (
  scope: Partial<HubSpotConnectionRecord["scope"]> = {},
): HubSpotConnectionRecord => ({
  id: "019a44ae-0000-7000-8000-00000000e003",
  portalId: "4410",
  uiDomain: "app.hubspot.com",
  status: "active",
  audience: "staff_sales_read",
  approvedById: partnerId,
  approvedByName: "Admin",
  approvedAt: now.toISOString(),
  scope: {
    company: ["industry", "partner_tier", "tax_id"],
    deal: ["deal_source"],
    contact: [],
    pipelines: ["default", "renewals"],
    notes: true,
    files: true,
    ...scope,
  },
  defaultPipelineId: "default",
  ownerMappings: [],
  updatedAt: now.toISOString(),
  version: 3,
});

const store = (linked: Record<string, { id: string; name: string }> = {}) =>
  ({
    connection: () => Promise.resolve({ active: null, latest: null }),
    partnersForCompanies: (_portal: string, ids: readonly string[]) =>
      Promise.resolve(
        new Map(
          ids.flatMap((id) => (linked[id] ? [[id, linked[id]] as const] : [])),
        ),
      ),
    linkForPartner: () => Promise.resolve(null),
    imports: () => Promise.resolve([]),
    import: () => Promise.reject(new Error("HUBSPOT_IMPORT_NOT_FOUND")),
    fieldHistory: () => Promise.resolve({}),
    similarPartners: () => Promise.resolve([]),
  }) as unknown as HubSpotStore;

async function context(
  options: {
    scope?: Partial<HubSpotConnectionRecord["scope"]>;
    linked?: Record<string, { id: string; name: string }>;
    reader?: FakeHubSpotReader;
  } = {},
): Promise<HubSpotContext> {
  const reader = options.reader ?? new FakeHubSpotReader(now);
  return {
    // A fresh connection ID per context keeps the display cache apart.
    connection: { ...connection(options.scope), id: crypto.randomUUID() },
    reader,
    portal: await reader.portal(),
    store: store(options.linked),
    demo: false,
  };
}

const partner = (patch: Partial<PartnerRecord> = {}): PartnerRecord => ({
  id: partnerId,
  name: "Northstar Systems",
  website: "https://northstar.example",
  region: "",
  models: ["resale"],
  status: "signed",
  ownerId: null,
  ownerName: null,
  organizationId: null,
  organizationName: null,
  contacts: [],
  nextStep: "",
  nextStepDue: null,
  notes: "",
  terms: PartnerTermsSchema.parse({}),
  createdById: partnerId,
  createdByName: "Seller",
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
  version: 4,
  ...patch,
});

describe("reading a handoff source through the approved scope", () => {
  it("resolves names and labels and keeps the deal's other companies", async () => {
    const source = await loadHandoffSource(await context(), {
      companyId: "9001",
      dealId: "7001",
    });
    expect(source.proposed).toEqual({
      name: "Northstar Systems",
      website: "https://northstar.example",
      region: "United States",
    });
    expect(source.deal?.reference.associatedCompanies).toEqual([
      { id: "9001", name: "Northstar Systems", labels: ["Reseller"] },
      {
        id: "9002",
        name: "Halcyon Research Cooperative",
        labels: ["Primary", "End customer"],
      },
    ]);
    expect(source.deal?.reference.stage).toEqual({
      id: "closedwon",
      label: "Closed won",
      closed: true,
    });
    expect(source.contacts.map((c) => [c.name, c.labels])).toEqual([
      ["Ada Okafor", ["Decision maker"]],
      ["Marcus Hale", []],
      ["Ines Albright", ["Budget holder"]],
    ]);
    expect(source.notes?.find((n) => n.id === "6002")?.authorName).toBeNull();
    expect(source.files?.map((f) => [f.name, f.availability])).toEqual([
      ["Halcyon order form (signed).pdf", "available"],
      ["northstar-logo.png", "unsupported_type"],
    ]);
  });

  it("never reads a property HubSpot marks sensitive, even if approved", async () => {
    const source = await loadHandoffSource(await context(), {
      companyId: "9001",
      dealId: null,
    });
    expect(source.companyValues.map((v) => v.property)).toEqual([
      "industry",
      "partner_tier",
    ]);
  });

  it("leaves notes and files out entirely when they are not approved", async () => {
    const reader = new FakeHubSpotReader(now);
    const source = await loadHandoffSource(
      await context({ scope: { notes: false, files: false }, reader }),
      { companyId: "9001", dealId: null },
    );
    expect(source.notes).toBeNull();
    expect(source.files).toBeNull();
    expect(reader.calls.some((call) => call.startsWith("notes:"))).toBe(false);
  });

  it("refuses a company that is not on the deal", async () => {
    await expect(
      loadHandoffSource(await context(), { companyId: "9004", dealId: "7001" }),
    ).rejects.toThrow("HUBSPOT_NOT_ASSOCIATED");
  });

  it("opens a pasted link from its own portal and explains another portal's", async () => {
    const ctx = await context();
    await expect(
      searchHubSpot(ctx, "https://app.hubspot.com/contacts/4410/deal/7001"),
    ).resolves.toEqual({
      kind: "record",
      objectType: "deal",
      objectId: "7001",
    });
    await expect(
      searchHubSpot(ctx, "https://app.hubspot.com/contacts/999/company/1"),
    ).resolves.toEqual({ kind: "foreign_portal", portalId: "999" });
  });
});

describe("the handoff plan", () => {
  const input = (overrides: Record<string, unknown> = {}) =>
    HubSpotHandoffInputSchema.parse({
      operationId,
      connection: { id: partnerId, version: 3 },
      source: { companyId: "9001", dealId: "7001" },
      reviewed: {},
      destination: {
        kind: "new_partner",
        partnerId,
        name: "Northstar Systems",
        website: "https://northstar.example",
      },
      ...overrides,
    });

  it("creates exactly what was selected and records what was left out", async () => {
    const source = await loadHandoffSource(await context(), {
      companyId: "9001",
      dealId: "7001",
    });
    const { plan, snapshot } = buildHubSpotPlan({
      source,
      handoff: input({
        contacts: [{ hubspotId: "5001" }],
        primaryContact: { kind: "hubspot", id: "5001" },
        includeDeal: true,
        endCustomerCompanyId: "9002",
        documents: [{ fileId: "8001", title: "Order form", kind: "agreement" }],
        referenceProperties: [{ objectType: "company", name: "partner_tier" }],
      }),
      destination: null,
      history: {},
      ownerName: null,
      newId: () => "019a44ae-0000-7000-8000-00000000e009",
    });
    expect(plan.fields.map((f) => [f.field, f.action, f.result])).toEqual([
      ["name", "add", "Northstar Systems"],
      ["website", "add", "https://northstar.example"],
      ["region", "keep", ""],
    ]);
    expect(plan.primaryContactId).toBe("019a44ae-0000-7000-8000-00000000e009");
    expect(plan.deal?.endCustomer?.name).toBe("Halcyon Research Cooperative");
    expect(plan.deal?.amount).toBe("48000");
    expect(plan.omitted).toEqual({
      contacts: 2,
      notes: 2,
      documents: 0,
      properties: 2,
    });
    expect(snapshot.values.map((v) => v.property)).toContain("partner_tier");
    expect(snapshot.company.owner).toEqual({ id: "101", name: "Priya Raman" });
  });

  it("keeps Commerce values unless a change is chosen and never clears a name", async () => {
    const source = await loadHandoffSource(await context(), {
      companyId: "9001",
      dealId: null,
    });
    const existing = (fields: Record<string, string>) =>
      input({
        source: { companyId: "9001", dealId: null },
        destination: {
          kind: "existing_partner",
          partnerId,
          expectedVersion: 4,
          fields,
        },
      });
    const { plan } = buildHubSpotPlan({
      source,
      handoff: existing({ region: "use_hubspot", website: "clear" }),
      destination: partner(),
      history: {},
      ownerName: null,
      newId: () => operationId,
    });
    expect(plan.fields.map((f) => [f.field, f.action, f.result])).toEqual([
      ["name", "keep", "Northstar Systems"],
      ["website", "clear", ""],
      ["region", "add", "United States"],
    ]);
    expect(() =>
      buildHubSpotPlan({
        source,
        handoff: existing({ name: "clear" }),
        destination: partner(),
        history: {},
        ownerName: null,
        newId: () => operationId,
      }),
    ).toThrow("HUBSPOT_DECISION_REQUIRED");
  });

  it("refuses a document HubSpot cannot provide instead of dropping it", async () => {
    const source = await loadHandoffSource(await context(), {
      companyId: "9001",
      dealId: null,
    });
    expect(() =>
      buildHubSpotPlan({
        source,
        handoff: input({
          source: { companyId: "9001", dealId: null },
          documents: [{ fileId: "8002", title: "Logo", kind: "other" }],
        }),
        destination: null,
        history: {},
        ownerName: null,
        newId: () => operationId,
      }),
    ).toThrow("HUBSPOT_DOCUMENT_UNAVAILABLE");
  });

  it("notices changes to what was selected, and only to that", async () => {
    const reader = new FakeHubSpotReader(now);
    const ctx = await context({ reader });
    const before = await loadHandoffSource(ctx, {
      companyId: "9001",
      dealId: null,
    });
    reader.updateCompany("9001", { name: "Northstar Systems Inc." });
    const after = await loadHandoffSource(ctx, {
      companyId: "9001",
      dealId: null,
    });
    const selection = {
      source: { dealId: null },
      includeDeal: false,
      endCustomerCompanyId: null,
      contacts: [{ hubspotId: "5001", matchContactId: null }],
      notes: [],
      documents: [],
    };
    expect(
      changedReviewItems(before.digests, after.digests, selection),
    ).toEqual(["company"]);
    expect(changedReviewItems(after.digests, after.digests, selection)).toEqual(
      [],
    );
  });
});

describe("the pipeline read model", () => {
  it("totals every matching deal by currency and counts missing amounts", async () => {
    const view = await loadPipeline(
      await context({
        linked: { "9003": { id: partnerId, name: "Larchmont" } },
      }),
      HubSpotPipelineQuerySchema.parse({}),
    );
    expect(view.deals.map((d) => d.id).sort()).toEqual([
      "7002",
      "7003",
      "7004",
      "7005",
      "7006",
    ]);
    expect(view.summary.totals).toEqual([
      { currency: "EUR", amount: "185000", deals: 2 },
      { currency: "USD", amount: "45000", deals: 2 },
    ]);
    expect(view.summary.missingAmounts).toBe(1);
    expect(view.complete).toBe(true);
  });

  it("filters by link state with the same list the totals use", async () => {
    const ctx = await context({
      linked: { "9001": { id: partnerId, name: "Northstar" } },
    });
    const partly = await loadPipeline(
      ctx,
      HubSpotPipelineQuerySchema.parse({ linked: "partly" }),
    );
    expect(partly.deals.map((d) => d.id)).toEqual(["7006"]);
    expect(partly.summary.deals).toBe(1);
    const closed = await loadPipeline(
      ctx,
      HubSpotPipelineQuerySchema.parse({ state: "closed", linked: "partly" }),
    );
    expect(closed.deals.map((d) => d.id)).toEqual(["7001"]);
  });
});

describe("HandoffReview", () => {
  beforeEach(() => {
    mocks.commit.mockReset();
    mocks.push.mockReset();
  });

  async function renderReview(
    props: Partial<Parameters<typeof HandoffReview>[0]> = {},
  ) {
    const source = await loadHandoffSource(await context(), {
      companyId: "9001",
      dealId: "7001",
    });
    render(
      <HandoffReview
        source={source}
        connection={{ id: partnerId, version: 3 }}
        destination={null}
        history={{}}
        suggestions={[]}
        owners={[{ id: partnerId, name: "Pat Seller" }]}
        ownerProposal={{
          kind: "viewer",
          ownerId: partnerId,
          hubspotOwner: "Priya Raman",
        }}
        linkedElsewhere={null}
        canImport
        demo={false}
        {...props}
      />,
    );
    return source;
  }

  it("starts with nothing optional selected and says what it will create", async () => {
    await renderReview();
    for (const name of ["Ada Okafor", "Marcus Hale", "Ines Albright"])
      expect(screen.getByRole("checkbox", { name })).not.toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: /Halcyon order form/u }),
    ).not.toBeChecked();
    expect(screen.getByLabelText("Commerce relationship status")).toHaveValue(
      "prospect",
    );
    expect(
      screen.getByText(/independent of the deal’s sales stage \(Closed won\)/u),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Create Northstar Systems as a partner with 1 deal reference.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /the HubSpot owner, Priya Raman, has no Commerce mapping/u,
      ),
    ).toBeInTheDocument();
  });

  it("commits the selection as one reviewed plan and opens the receipt", async () => {
    mocks.commit.mockResolvedValue({
      ok: true,
      value: {
        kind: "committed",
        partnerId,
        importId: operationId,
        pendingDocuments: 1,
      },
    });
    await renderReview();
    fireEvent.click(screen.getByRole("checkbox", { name: "Ada Okafor" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Halcyon order form/u }),
    );
    expect(
      screen.getByText(
        "Create Northstar Systems as a partner with 1 contact, 1 deal reference, and 1 document.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create partner" }));
    await waitFor(() => expect(mocks.commit).toHaveBeenCalledTimes(1));
    const sent = HubSpotHandoffInputSchema.parse(
      mocks.commit.mock.calls[0]?.[0],
    );
    expect(sent).toMatchObject({
      contacts: [{ hubspotId: "5001", matchContactId: null }],
      includeDeal: true,
      endCustomerCompanyId: null,
      documents: [{ fileId: "8001", kind: "other" }],
      destination: {
        kind: "new_partner",
        status: "prospect",
        ownerId: partnerId,
      },
    });
    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith(
        `/internal/partners/${partnerId}?handoff=${operationId}&start=1#hubspot-receipt`,
      ),
    );
  });

  it("asks for a choice on a field both sides changed before committing", async () => {
    await renderReview({
      destination: partner({ region: "Canada" }),
      history: { region: { lastSource: "Mexico", lastResult: "Mexico" } },
    });
    expect(screen.getByText("Changed on both sides")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Import selected changes" }),
    );
    expect(
      await screen.findByText(/Choose what happens to Region/u),
    ).toBeInTheDocument();
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it("resolves to the winning partner when another handoff linked the company first", async () => {
    mocks.commit.mockResolvedValue({
      ok: true,
      value: {
        kind: "already_linked",
        partnerId,
        partnerName: "Northstar (theirs)",
      },
    });
    await renderReview();
    fireEvent.click(screen.getByRole("button", { name: "Create partner" }));
    expect(
      await screen.findByText(
        "This company was just linked to Northstar (theirs)",
      ),
    ).toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();
  });
});

describe("HubSpotReceipt", () => {
  const record = (status: "pending" | "failed"): HubSpotImportRecord => ({
    id: operationId,
    partnerId,
    portalId: "4410",
    companyId: "9001",
    dealId: "7001",
    status: "needs_attention",
    createdPartner: true,
    plan: {
      operationId,
      destination: {
        kind: "new_partner",
        partnerId,
        name: "Northstar Systems",
        status: "prospect",
        ownerId: null,
        ownerName: null,
        models: [],
      },
      fields: [],
      contacts: [],
      primaryContactId: null,
      deal: null,
      notes: [],
      references: [],
      documents: [],
      dismissedSuggestions: [],
      omitted: { contacts: 1, notes: 0, documents: 0, properties: 0 },
    },
    snapshot: {
      portalId: "4410",
      uiDomain: "app.hubspot.com",
      retrievedAt: now.toISOString(),
      company: {
        id: "9001",
        url: "https://app.hubspot.com/contacts/4410/record/0-2/9001",
        name: "Northstar Systems",
        updatedAt: null,
        owner: null,
      },
      values: [],
      deal: null,
      notes: [],
    },
    items: [
      {
        id: "019a44ae-0000-7000-8000-00000000e00a",
        importId: operationId,
        fileId: "8001",
        noteId: "6001",
        fileName: "Order form.pdf",
        title: "Order form",
        documentKind: "agreement",
        status,
        errorCode: status === "failed" ? "HUBSPOT_DOCUMENT_UNAVAILABLE" : null,
        attachmentId: null,
        existingAttachment: null,
        excludedReason: null,
        attempts: status === "failed" ? 1 : 0,
        updatedAt: now.toISOString(),
      },
    ],
    createdById: partnerId,
    createdByName: "Pat Seller",
    createdAt: now.toISOString(),
    completedAt: null,
  });

  it("separates the saved record from the unfinished handoff", () => {
    render(
      <HubSpotReceipt
        record={record("failed")}
        canEdit
        autoStart={false}
        focus={false}
      />,
    );
    expect(
      screen.getByText("Partner created · 1 document still needs attention"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "HubSpot would not provide this file. Retry, or exclude it.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Retry document" }),
    ).toBeInTheDocument();
    expect(screen.getByText("1 contact")).toBeInTheDocument();
  });

  it("excludes an item only with a reason, as an explicit amendment", async () => {
    const [item] = record("failed").items;
    if (!item) throw new Error("fixture item missing");
    const excluded = {
      ...record("failed"),
      status: "completed_with_exclusions" as const,
      items: [
        {
          ...item,
          status: "excluded" as const,
          excludedReason: "Not the signed copy",
        },
      ],
    };
    mocks.exclude.mockResolvedValue({ ok: true, value: excluded });
    render(
      <HubSpotReceipt
        record={record("failed")}
        canEdit
        autoStart={false}
        focus={false}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Exclude this item and finish" }),
    );
    const confirm = screen.getByRole("button", { name: "Exclude" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Why leave it out?"), {
      target: { value: "Not the signed copy" },
    });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(
        screen.getByText("Partner created · Completed with 1 item excluded"),
      ).toBeInTheDocument(),
    );
    expect(mocks.exclude).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "Not the signed copy" }),
    );
  });

  it("brings pending documents across one at a time right after the commit", async () => {
    mocks.process.mockResolvedValue({
      ok: false,
      code: "HUBSPOT_DOCUMENT_UNAVAILABLE",
    });
    render(
      <HubSpotReceipt record={record("pending")} canEdit autoStart focus />,
    );
    await waitFor(() => expect(mocks.process).toHaveBeenCalledTimes(1));
    const heading = screen.getByRole("heading", {
      name: "HubSpot import receipt",
    });
    expect(heading).toHaveFocus();
    const section = heading.closest("section");
    if (!section) throw new Error("receipt section missing");
    expect(
      within(section).getByText("Continue in Commerce"),
    ).toBeInTheDocument();
  });
});

describe("HubSpotSetupGuide", () => {
  it("names the next step from where this environment stands", () => {
    expect(
      hubspotSetupStage({
        tokenConfigured: false,
        portalReachable: false,
        active: false,
      }),
    ).toBe("token");
    expect(
      hubspotSetupStage({
        tokenConfigured: true,
        portalReachable: false,
        active: false,
      }),
    ).toBe("deploy");
    expect(
      hubspotSetupStage({
        tokenConfigured: true,
        portalReachable: true,
        active: false,
      }),
    ).toBe("approve");
    expect(
      hubspotSetupStage({
        tokenConfigured: true,
        portalReachable: true,
        active: true,
      }),
    ).toBe("use");
  });

  it("shows the read-only scopes and where the token goes, never a token", () => {
    render(<HubSpotSetupGuide t={translatorFor("en")} stage="token" />);
    expect(screen.getByText("crm.objects.deals.read")).toBeInTheDocument();
    expect(
      screen.getByText(/HUBSPOT_ACCESS_TOKEN to production/u),
    ).toBeInTheDocument();
    expect(screen.getByText("Next")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});

describe("review findings stay fixed", () => {
  const existing = (fields: Record<string, string>, extra = {}) =>
    HubSpotHandoffInputSchema.parse({
      operationId,
      connection: { id: partnerId, version: 3 },
      source: { companyId: "9001", dealId: null },
      reviewed: {},
      destination: {
        kind: "existing_partner",
        partnerId,
        expectedVersion: 4,
        fields,
      },
      ...extra,
    });

  it("refuses a field changed on both sides when no choice was sent", async () => {
    const source = await loadHandoffSource(await context(), {
      companyId: "9001",
      dealId: null,
    });
    const build = (fields: Record<string, string>) =>
      buildHubSpotPlan({
        source,
        handoff: existing(fields),
        destination: partner({ region: "Canada" }),
        history: { region: { lastSource: "Mexico", lastResult: "Mexico" } },
        ownerName: null,
        newId: () => operationId,
      });
    expect(() => build({})).toThrow("HUBSPOT_DECISION_REQUIRED");
    expect(build({ region: "keep" }).plan.fields[2]?.result).toBe("Canada");
  });

  it("matches a hand-typed contact by its derived ID and never re-links another person", async () => {
    const source = await loadHandoffSource(await context(), {
      companyId: "9001",
      dealId: null,
    });
    const typed = withPartnerContactIds(partnerId, [
      { name: "Ada", email: "ada.okafor@northstar.example", role: "" },
    ]);
    const { plan } = buildHubSpotPlan({
      source,
      handoff: existing(
        {},
        { contacts: [{ hubspotId: "5001", matchContactId: typed[0]?.id }] },
      ),
      destination: partner({ contacts: typed }),
      history: {},
      ownerName: null,
      newId: () => operationId,
    });
    expect(plan.contacts[0]).toMatchObject({
      id: typed[0]?.id,
      matchedExisting: true,
    });
    // A list that shifted under the review cannot pair Ada with someone else.
    const shifted = withPartnerContactIds(partnerId, [
      { name: "Bob", email: "bob@northstar.example", role: "" },
    ]);
    expect(() =>
      buildHubSpotPlan({
        source,
        handoff: existing(
          {},
          { contacts: [{ hubspotId: "5001", matchContactId: shifted[0]?.id }] },
        ),
        destination: partner({ contacts: shifted }),
        history: {},
        ownerName: null,
        newId: () => operationId,
      }),
    ).toThrow("HUBSPOT_CONTACT_NOT_FOUND");
    const [first] = typed;
    if (!first) throw new Error("fixture contact missing");
    const linked = [
      {
        ...first,
        source: {
          provider: "hubspot" as const,
          portalId: "4410",
          objectId: "5002",
          labels: [],
        },
      },
    ];
    expect(() =>
      buildHubSpotPlan({
        source,
        handoff: existing(
          {},
          { contacts: [{ hubspotId: "5001", matchContactId: typed[0]?.id }] },
        ),
        destination: partner({ contacts: linked }),
        history: {},
        ownerName: null,
        newId: () => operationId,
      }),
    ).toThrow("HUBSPOT_CONTACT_NOT_FOUND");
  });

  it("reads no deal outside the approved pipelines", async () => {
    const ctx = await context({ scope: { pipelines: ["renewals"] } });
    await expect(
      loadHandoffSource(ctx, { companyId: "9001", dealId: "7001" }),
    ).rejects.toThrow("HUBSPOT_SCOPE_DENIED");
    const view = await loadPipeline(ctx, HubSpotPipelineQuerySchema.parse({}));
    expect(view.pipelines.map((p) => p.id)).toEqual(["renewals"]);
    expect(view.deals.map((d) => d.id)).toEqual(["7008"]);
    await expect(
      loadPipeline(
        await context({ scope: { pipelines: [] } }),
        HubSpotPipelineQuerySchema.parse({}),
      ),
    ).rejects.toThrow("HUBSPOT_NO_PIPELINES");
  });
});
