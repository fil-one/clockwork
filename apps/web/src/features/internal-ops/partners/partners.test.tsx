import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  PartnerListQuerySchema,
  PartnerTermsSchema,
  type PartnerDealWithConflicts,
  type PartnerRecord,
} from "@clockwork/contracts";

import { translatorFor } from "@/src/i18n/catalogs";

const mocks = vi.hoisted(() => ({
  savePartner: vi.fn(),
  saveDeal: vi.fn(),
  conflicts: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("./actions", () => ({
  savePartner: mocks.savePartner,
  savePartnerDeal: mocks.saveDeal,
  findPartnerDealConflicts: mocks.conflicts,
}));
vi.mock("./server", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mocks.push,
    replace: mocks.replace,
    refresh: mocks.refresh,
  }),
}));

import { demoPartnerRegister } from "./demo-register";
import { DealForm } from "./deal-form";
import { PartnerDetail } from "./partner-detail";
import { PartnerForm } from "./partner-form";
import { PartnerList } from "./partner-list";

const t = translatorFor("en");
const today = "2026-10-10";
const viewer = {
  id: "019a44ac-0000-7000-8000-0000000000aa",
  name: "Pat Seller",
};
const partner = (patch: Partial<PartnerRecord> = {}): PartnerRecord => ({
  id: "019a44ac-0000-7000-8000-0000000000b1",
  name: "Northwind Referral Partners",
  website: "https://northwind.example",
  region: "DACH",
  models: ["referral", "teaming"],
  status: "negotiating",
  ownerId: viewer.id,
  ownerName: viewer.name,
  organizationId: null,
  organizationName: null,
  contacts: [{ name: "Ana Ruiz", email: "ana@northwind.example", role: "CEO" }],
  nextStep: "Send the term sheet",
  nextStepDue: "2026-10-08",
  notes: "",
  terms: {
    ...PartnerTermsSchema.parse({}),
    commissionPct: "17.5",
    commissionSteps: [
      { fromMonth: 1, ratePct: "30" },
      { fromMonth: 13, ratePct: "20" },
    ],
    currency: "EUR",
    exclusivity: "none",
    rows: [{ label: "Payment terms", value: "Net 45", notes: "" }],
  },
  createdById: viewer.id,
  createdByName: viewer.name,
  createdAt: "2026-10-01T12:00:00.000Z",
  updatedAt: "2026-10-09T12:00:00.000Z",
  version: 3,
  ...patch,
});
const conflict = {
  dealId: "019a44ac-0000-7000-8000-0000000000d2",
  partnerId: "019a44ac-0000-7000-8000-0000000000b2",
  partnerName: "Southwind Resale",
  endClient: "ACME Inc",
  status: "registered" as const,
  registeredOn: "2026-10-01",
  protectedUntil: "2026-12-30",
};
const deal = (
  patch: Partial<PartnerDealWithConflicts> = {},
): PartnerDealWithConflicts => ({
  id: "019a44ac-0000-7000-8000-0000000000d1",
  partnerId: partner().id,
  endClient: "Acme, Inc.",
  organizationId: null,
  organizationName: null,
  registeredOn: "2026-10-05",
  protectedUntil: "2027-01-03",
  estimatedSize: "250",
  sizeUnit: "TB",
  model: "referral",
  status: "registered",
  notes: "",
  createdByName: viewer.name,
  createdAt: "2026-10-05T12:00:00.000Z",
  updatedAt: "2026-10-05T12:00:00.000Z",
  version: 1,
  conflicts: [conflict],
  ...patch,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the partner list", () => {
  it("shows headline terms, owners and an overdue next step", () => {
    render(
      <PartnerList
        t={t}
        locale="en-US"
        query={PartnerListQuerySchema.parse({})}
        result={{
          rows: [
            {
              id: partner().id,
              name: "Northwind Referral Partners",
              region: "DACH",
              models: ["referral"],
              status: "negotiating",
              ownerId: viewer.id,
              ownerName: viewer.name,
              nextStep: "Send the term sheet",
              nextStepDue: "2026-10-08",
              commissionPct: "17.5",
              marginPct: null,
              currency: "EUR",
              openDeals: 2,
              updatedAt: "2026-10-09T12:00:00.000Z",
            },
          ],
          truncated: false,
        }}
        owners={[viewer]}
        today={today}
        canEdit
        demo={false}
      />,
    );
    const table = screen.getAllByRole("table")[0] as HTMLElement;
    expect(
      within(table).getByRole("link", { name: "Northwind Referral Partners" }),
    ).toHaveAttribute("href", `/internal/partners/${partner().id}`);
    expect(
      within(table).getByText("17.5% commission, EUR"),
    ).toBeInTheDocument();
    expect(
      within(table).getByText("overdue since Oct 8, 2026"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "New partner" })).toHaveAttribute(
      "href",
      "/internal/partners/new",
    );
    expect(screen.getByRole("link", { name: "Export CSV" })).toHaveAttribute(
      "href",
      "/internal/partners/export",
    );
  });

  it("offers no new-partner button to a reader who cannot change partners, and keeps filters on the export", () => {
    render(
      <PartnerList
        t={t}
        locale="en-US"
        query={PartnerListQuerySchema.parse({ status: "active", mine: "1" })}
        result={{ rows: [], truncated: false }}
        owners={[]}
        today={today}
        canEdit={false}
        demo
      />,
    );
    expect(screen.queryByRole("link", { name: "New partner" })).toBeNull();
    expect(screen.getByRole("link", { name: "Export CSV" })).toHaveAttribute(
      "href",
      "/internal/partners/export?status=active&mine=1",
    );
    expect(screen.getByText("No partners match")).toBeInTheDocument();
    expect(
      screen.getByText(/These partners are fictional/u),
    ).toBeInTheDocument();
  });
});

describe("the partner record", () => {
  const detail = (canEdit: boolean) => (
    <PartnerDetail
      t={t}
      locale="en-US"
      partner={partner()}
      deals={[deal()]}
      activity={[
        {
          id: "e1",
          eventType: "partner.updated",
          actorName: "Pat Seller",
          dealEndClient: null,
          changes: { commissionPct: { from: "15", to: "17.5" } },
          occurredAt: "2026-10-09T12:00:00.000Z",
        },
      ]}
      links={{
        mndas: [
          {
            id: "m1",
            company: "Northwind Referral Partners",
            state: "completed",
            createdAt: "2026-09-01T00:00:00.000Z",
            completedAt: "2026-09-03T00:00:00.000Z",
            ownerName: "Pat Seller",
          },
        ],
        contracts: [],
      }}
      today={today}
      protectionDays={90}
      organizations={[]}
      canEdit={canEdit}
      demo={false}
    />
  );

  it("shows terms, the step-down schedule, the overlap warning, linked MNDAs and history", () => {
    render(detail(true));
    expect(screen.getByText("17.5%")).toBeInTheDocument();
    expect(screen.getByText("From month 13: 20%")).toBeInTheDocument();
    expect(screen.getByText("Net 45")).toBeInTheDocument();
    expect(screen.getByText("Non-exclusive")).toBeInTheDocument();
    expect(
      screen.getByText("Another partner has registered this end client"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Southwind Resale: Registered/u }),
    ).toHaveAttribute("href", `/internal/partners/${conflict.partnerId}`);
    expect(
      screen.getByText(/^MNDA: .+, sent by Pat Seller/u),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Pat Seller changed Commission or revenue share (%)"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Edit partner" })).toHaveAttribute(
      "href",
      `/internal/partners/${partner().id}/edit`,
    );
    expect(
      screen.getByRole("button", { name: "Register a deal" }),
    ).toBeInTheDocument();
  });

  it("renders read-only for a reader who cannot change partners", () => {
    render(detail(false));
    expect(screen.queryByRole("link", { name: "Edit partner" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Register a deal" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit deal" })).toBeNull();
    // The warning is still there for a reader.
    expect(
      screen.getByText("Another partner has registered this end client"),
    ).toBeInTheDocument();
  });
});

describe("registering a deal", () => {
  it("warns while the end client is typed and saves anyway", async () => {
    mocks.conflicts.mockResolvedValue({ ok: true, value: [conflict] });
    mocks.saveDeal.mockResolvedValue({
      ok: true,
      value: {
        id: "d9",
        version: 1,
        status: "registered",
        conflicts: [conflict],
      },
    });
    render(
      <DealForm
        partnerId={partner().id}
        deal={null}
        today={today}
        protectionDays={90}
        organizations={[]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Register a deal" }));
    expect(
      screen.getByText(
        "Leave empty for 90 days from registration, the channel policy's protection.",
      ),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: /^End client/u }), {
      target: { value: "ACME Inc" },
    });
    expect(
      await screen.findByText("Another partner has registered this end client"),
    ).toBeInTheDocument();
    expect(mocks.conflicts).toHaveBeenCalledWith({
      endClient: "ACME Inc",
      partnerId: partner().id,
    });
    fireEvent.change(screen.getByLabelText(/Estimated size/u), {
      target: { value: "1.5" },
    });
    fireEvent.change(screen.getByLabelText(/^Unit/u), {
      target: { value: "PiB" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save deal" }));
    await waitFor(() => expect(mocks.saveDeal).toHaveBeenCalledOnce());
    expect(mocks.saveDeal.mock.calls[0]?.[0]).toMatchObject({
      partnerId: partner().id,
      endClient: "ACME Inc",
      registeredOn: today,
      protectedUntil: "",
      estimatedSize: "1.5",
      sizeUnit: "PiB",
      model: "referral",
      status: "registered",
    });
    expect(mocks.saveDeal.mock.calls[0]?.[0]).not.toHaveProperty(
      "expectedVersion",
    );
    expect(
      await screen.findByText(
        "Saved. Another partner has an open registration for this end client.",
      ),
    ).toBeInTheDocument();
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("edits a deal at the version it opened with", async () => {
    mocks.saveDeal.mockResolvedValue({
      ok: true,
      value: { id: deal().id, version: 2, status: "won", conflicts: [] },
    });
    render(
      <DealForm
        partnerId={partner().id}
        deal={deal()}
        today={today}
        protectionDays={90}
        organizations={[]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit deal" }));
    fireEvent.change(screen.getByLabelText(/^Status/u), {
      target: { value: "won" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save deal" }));
    await waitFor(() => expect(mocks.saveDeal).toHaveBeenCalledOnce());
    expect(mocks.saveDeal.mock.calls[0]?.[0]).toMatchObject({
      id: deal().id,
      expectedVersion: 1,
      status: "won",
      protectedUntil: "2027-01-03",
    });
    expect(await screen.findAllByText("Deal saved.")).not.toHaveLength(0);
  });
});

describe("the partner form", () => {
  it("sends the record, contacts, step-down rows and free-form terms", async () => {
    mocks.savePartner.mockResolvedValue({
      ok: true,
      value: { id: "019a44ac-0000-7000-8000-0000000000b9", version: 1 },
    });
    render(
      <PartnerForm
        partner={null}
        owners={[
          viewer,
          { id: "019a44ac-0000-7000-8000-0000000000ab", name: "Jo" },
        ]}
        organizations={[]}
        viewer={viewer}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Partner name/u), {
      target: { value: "Kestrel Affiliates" },
    });
    fireEvent.click(screen.getByLabelText("Affiliate"));
    fireEvent.click(screen.getByLabelText("Resale"));
    fireEvent.change(screen.getByLabelText(/Commission or revenue share/u), {
      target: { value: "30" },
    });
    fireEvent.change(screen.getByLabelText(/Partner margin or discount/u), {
      target: { value: "32" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add a contact" }));
    fireEvent.change(screen.getByLabelText(/^Name/u), {
      target: { value: "Dana" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add a step" }));
    fireEvent.change(screen.getByLabelText(/From month/u), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText(/^Rate/u), {
      target: { value: "30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add a term" }));
    fireEvent.change(screen.getByLabelText("Term"), {
      target: { value: "Resale price" },
    });
    fireEvent.change(screen.getByLabelText(/^Agreed/u), {
      target: { value: "$6.50 per TB" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save partner" }));
    await waitFor(() => expect(mocks.savePartner).toHaveBeenCalledOnce());
    const input: unknown = mocks.savePartner.mock.calls[0]?.[0];
    expect(input).toMatchObject({
      name: "Kestrel Affiliates",
      models: ["resale", "affiliate"],
      status: "prospect",
      // A new partner is the author's unless they pick someone else.
      ownerId: viewer.id,
      contacts: [{ name: "Dana", email: "", role: "" }],
      terms: {
        commissionPct: "30",
        marginPct: "32",
        commissionSteps: [{ fromMonth: "1", ratePct: "30" }],
        rows: [{ label: "Resale price", value: "$6.50 per TB", notes: "" }],
      },
    });
    expect(input).not.toHaveProperty("expectedVersion");
    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith(
        "/internal/partners/019a44ac-0000-7000-8000-0000000000b9",
      ),
    );
  });

  it("marks the field the server refused and keeps the form", async () => {
    mocks.savePartner.mockResolvedValue({
      ok: false,
      code: "INVALID_INPUT",
      fields: { "terms.commissionPct": "percent_range" },
    });
    render(
      <PartnerForm
        partner={partner()}
        owners={[viewer]}
        organizations={[]}
        viewer={viewer}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save partner" }));
    expect(
      await screen.findByText(
        "Enter a percentage from 0 to 100, with up to four decimals.",
      ),
    ).toBeInTheDocument();
    expect(mocks.savePartner.mock.calls[0]?.[0]).toMatchObject({
      id: partner().id,
      expectedVersion: 3,
    });
    expect(mocks.push).not.toHaveBeenCalled();
  });
});

describe("the demo partners", () => {
  const now = new Date("2026-10-10T12:00:00.000Z");
  const register = demoPartnerRegister(now, viewer);
  const scope = { viewerId: viewer.id, today };

  it("covers referral, design-partner, affiliate, two-rate and teaming deals", async () => {
    const { rows } = await register.list(
      PartnerListQuerySchema.parse({}),
      scope,
    );
    expect(rows).toHaveLength(5);
    expect(rows.map(({ commissionPct }) => commissionPct)).toEqual(
      expect.arrayContaining(["17.5", "32", "30", "20", null]),
    );
    const mine = await register.list(
      PartnerListQuerySchema.parse({ mine: "1" }),
      scope,
    );
    expect(mine.rows.every(({ ownerId }) => ownerId === viewer.id)).toBe(true);
    expect(
      (
        await register.list(
          PartnerListQuerySchema.parse({ due: "overdue" }),
          scope,
        )
      ).rows,
    ).toHaveLength(1);
  });

  it("flags the end client two partners registered, and nothing else", async () => {
    const { rows } = await register.list(
      PartnerListQuerySchema.parse({}),
      scope,
    );
    const overlaps = await Promise.all(
      rows.map(async ({ id }) =>
        (await register.get(id, today)).deals.flatMap(
          ({ conflicts }) => conflicts,
        ),
      ),
    );
    expect(
      overlaps
        .flat()
        .map(({ endClient }) => endClient)
        .sort(),
    ).toEqual([
      "Fernhill Research Institute",
      "Fernhill Research Institute, Inc.",
    ]);
    await expect(
      register.get("019a44ac-0000-7000-8000-000000000000", today),
    ).rejects.toThrow("PARTNER_NOT_FOUND");
  });
});
