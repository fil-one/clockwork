import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { permissionsForRoles } from "@clockwork/contracts";
import type * as Db from "@clockwork/db";

const mocks = vi.hoisted(() => ({
  count: vi.fn(),
  contracts: vi.fn(),
  partners: vi.fn(),
  staff: vi.fn(),
  database: vi.fn(),
  session: vi.fn(),
}));
vi.mock("@clockwork/db", async (importOriginal) => ({
  ...(await importOriginal<typeof Db>()),
  countSalesHomeMndas: mocks.count,
  countSalesHomeContracts: mocks.contracts,
  countPartnerNextSteps: mocks.partners,
}));
vi.mock("@/src/db/service", () => ({
  getOptionalServiceDatabase: mocks.database,
}));
vi.mock("../contracts/server", () => ({ contractStaff: mocks.staff }));
vi.mock("@/src/auth/session", () => ({
  getRequestCommerceSession: mocks.session,
}));

import { contractHomeRows } from "./contract-source";
import { mndaHomeRows, mndaHomeSource } from "./mnda-source";
import { mndaRegisterHref, type SalesHomeSource } from "./model";
import { SalesHome } from "./sales-home";
import { loadSalesHome } from "./server-loader";
import { startGuideStorageKey } from "./start-guide";

const counts = {
  mine: {
    attention: 1,
    waitingPartner: 2,
    waitingFilOne: 0,
    completed: 4,
    drafts: 1,
  },
  team: {
    attention: 2,
    waitingPartner: 5,
    waitingFilOne: 3,
    completed: 9,
    drafts: 6,
  },
};
const contractCounts = {
  awaitingApproval: { mine: 1, team: 2 },
  needsAttention: { mine: 0, team: 3 },
  outForSignature: { mine: 2, team: 5 },
};
const context = {
  userId: "21000000-0000-4000-8000-000000000010",
  permissions: permissionsForRoles(["revenue"], { side: "fil_one" }),
  demo: false,
  now: new Date("2026-10-04T12:00:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  mocks.database.mockReturnValue({});
  mocks.count.mockResolvedValue(counts);
  mocks.contracts.mockResolvedValue(contractCounts);
  mocks.partners.mockResolvedValue({
    overdue: { mine: 0, team: 0 },
    dueThisWeek: { mine: 0, team: 0 },
  });
  mocks.staff.mockResolvedValue({});
});

describe("MNDA register links", () => {
  it("uses the register's own state names and the mine flag", () => {
    expect(mndaRegisterHref(["sent", "viewed"], true)).toBe(
      "/internal/mndas?status=sent,viewed&mine=1",
    );
    expect(mndaRegisterHref(["awaiting_countersignature"], false)).toBe(
      "/internal/mndas?status=awaiting_countersignature",
    );
  });

  it("links each row to exactly the states it counted", () => {
    const rows = mndaHomeRows(counts);
    expect(rows.map(({ href }) => href)).toEqual([
      "/internal/mndas?status=attention&mine=1",
      "/internal/mndas?status=sending,sent,viewed&mine=1",
      "/internal/mndas?status=awaiting_countersignature&mine=1",
      "/internal/mndas?status=completed&mine=1",
      "/internal/mndas?status=draft,preparing,ready&mine=1",
    ]);
    expect(rows.at(-1)).not.toHaveProperty("team");
  });
});

describe("sales home loader", () => {
  it("counts the reader's MNDAs from the last 30 days", async () => {
    const [section] = await loadSalesHome(context);
    expect(mocks.count).toHaveBeenCalledWith(
      {},
      {
        ownerId: context.userId,
        completedSince: new Date("2026-09-04T12:00:00.000Z"),
      },
    );
    expect(section?.rows?.map(({ mine }) => mine)).toEqual([1, 2, 0, 4, 1]);
  });

  it("counts the guided demo's fictional register and links to it", async () => {
    const [section] = await loadSalesHome({
      ...context,
      demo: true,
    });
    expect(mocks.count).not.toHaveBeenCalled();
    expect(mocks.database).not.toHaveBeenCalled();
    expect(section?.rows?.map(({ mine }) => mine)).toEqual([1, 1, 1, 1, 1]);
    // A completion older than 30 days is not counted.
    expect(section?.rows?.map(({ team }) => team)).toEqual([
      1,
      3,
      1,
      2,
      undefined,
    ]);
    expect(section?.rows?.[0]?.href).toBe(
      "/internal/mndas?status=attention&mine=1",
    );
  });

  it("marks a failed source unavailable and keeps the others", async () => {
    mocks.count.mockRejectedValue(new Error("connection refused"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const other: SalesHomeSource = {
      id: "renewals",
      heading: "operations.sales.home.cards",
      requiredPermission: "contract:read",
      unavailable: { message: "operations.sales.home.unavailable" },
      load: () => Promise.resolve([]),
    };
    const sections = await loadSalesHome(context, [mndaHomeSource, other]);
    expect(sections.map(({ rows }) => rows)).toEqual([null, []]);
  });

  it("leaves out a source the reader may not use", async () => {
    const sections = await loadSalesHome({
      ...context,
      permissions: permissionsForRoles(["destructive_action_approver"], {
        side: "fil_one",
      }),
    });
    expect(sections).toEqual([]);
  });
});

describe("contract work on the home page", () => {
  it("counts contracts out for signature and needing attention in one read", async () => {
    const sections = await loadSalesHome(context);
    expect(sections.map(({ id }) => id)).toEqual([
      "mndas",
      "contracts",
      "partners",
    ]);
    // The request-cached session, not a second sign-in check.
    expect(mocks.staff).toHaveBeenCalledWith("contract:read", mocks.session);
    expect(mocks.contracts).toHaveBeenCalledExactlyOnceWith(
      {},
      { viewerId: context.userId },
    );
    // A seller cannot approve, so no approval line.
    expect(
      sections[1]?.rows?.map(({ id, mine, team, href, teamHref }) => ({
        id,
        mine,
        team,
        href,
        teamHref,
      })),
    ).toEqual([
      {
        id: "contracts-needsAttention",
        mine: 0,
        team: 3,
        href: "/internal/contracts?status=signing_attention&mine=1",
        teamHref: "/internal/contracts?status=signing_attention",
      },
      {
        id: "contracts-outForSignature",
        mine: 2,
        team: 5,
        href: "/internal/contracts?status=out_for_signature&mine=1",
        teamHref: "/internal/contracts?status=out_for_signature",
      },
    ]);
  });

  it("puts approvals first for someone who can approve", () => {
    const [approvals] = contractHomeRows(contractCounts, true);
    expect(approvals).toMatchObject({
      id: "contracts-awaitingApproval",
      mine: 1,
      teamHref: "/internal/contracts?status=signing_approval",
    });
    // "Mine" here is what others prepared for this reader to decide, which
    // no register filter lists.
    expect(approvals?.href).toBeUndefined();
  });

  it("shows nothing new to a reader without contract permissions", async () => {
    const sections = await loadSalesHome({
      ...context,
      permissions: ["mnda:send", "sales:read"],
    });
    expect(sections.map(({ id }) => id)).toEqual(["mndas", "partners"]);
    expect(mocks.contracts).not.toHaveBeenCalled();
  });

  it("counts the guided demo's contract register and links to it", async () => {
    const sections = await loadSalesHome({ ...context, demo: true });
    expect(mocks.contracts).not.toHaveBeenCalled();
    expect(mocks.staff).not.toHaveBeenCalled();
    expect(
      sections[1]?.rows?.map(({ id, mine, team, href }) => ({
        id,
        mine,
        team,
        href,
      })),
    ).toEqual([
      {
        id: "contracts-needsAttention",
        mine: 0,
        team: 0,
        href: "/internal/contracts?status=signing_attention&mine=1",
      },
      {
        id: "contracts-outForSignature",
        mine: 1,
        team: 1,
        href: "/internal/contracts?status=out_for_signature&mine=1",
      },
    ]);
    render(
      <SalesHome userId={context.userId} sections={sections} canSendMnda />,
    );
    expect(
      screen.getByRole("region", { name: "Your contracts" }),
    ).toBeInTheDocument();
  });

  it("reads as unavailable when the contract check refuses", async () => {
    mocks.staff.mockRejectedValueOnce(new Error("CONTRACT_MFA_REQUIRED"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sections = await loadSalesHome(context);
    expect(sections[1]?.rows).toBeNull();
    expect(mocks.contracts).not.toHaveBeenCalled();
  });

  it("lists contract work under its own heading", () => {
    render(
      <SalesHome
        userId={context.userId}
        sections={[
          {
            id: "contracts",
            heading: "operations.sales.home.contracts.heading",
            unavailable: {
              message: "operations.sales.home.contracts.unavailable",
            },
            rows: contractHomeRows(contractCounts, true),
          },
        ]}
        canSendMnda={false}
      />,
    );
    const region = screen.getByRole("region", { name: "Your contracts" });
    expect(within(region).getAllByRole("listitem")).toHaveLength(3);
    expect(
      within(region).getByRole("link", { name: "Team: 5" }),
    ).toHaveAttribute("href", "/internal/contracts?status=out_for_signature");
  });
});

describe("sales home page", () => {
  const section = {
    id: "mndas",
    heading: "operations.sales.home.cards" as const,
    unavailable: {
      message: "operations.sales.home.unavailable" as const,
      href: "/internal/mndas",
      action: "operations.sales.home.openRegister" as const,
    },
    rows: mndaHomeRows(counts),
  };

  it("lists the reader's MNDAs by what they wait on, with team totals", () => {
    render(
      <SalesHome userId={context.userId} sections={[section]} canSendMnda />,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "My work" }),
    ).toBeInTheDocument();
    const list = within(
      screen.getByRole("region", { name: "Your MNDAs" }),
    ).getByRole("list");
    const rows = within(list).getAllByRole("listitem");
    const [attention, waitingPartner, waitingFilOne] = rows as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];
    expect(rows).toHaveLength(5);
    // What needs the reader comes first. Each count is its own link.
    expect(
      within(attention).getByRole("heading", { name: "Needs attention" }),
    ).toBeInTheDocument();
    expect(
      within(attention).getByRole("link", { name: "Yours: 1" }),
    ).toHaveAttribute("href", "/internal/mndas?status=attention&mine=1");
    expect(
      within(attention).getByRole("link", { name: "Team: 2" }),
    ).toHaveAttribute("href", "/internal/mndas?status=attention");
    expect(
      within(waitingPartner).getByRole("link", { name: "Yours: 2" }),
    ).toHaveAttribute(
      "href",
      "/internal/mndas?status=sending,sent,viewed&mine=1",
    );
    expect(
      within(waitingPartner).getByRole("link", { name: "Team: 5" }),
    ).toHaveAttribute("href", "/internal/mndas?status=sending,sent,viewed");
    // Nothing of the reader's waits on Fil One: say so, and offer no empty list.
    expect(within(waitingFilOne).getByText("Yours: none")).toBeInTheDocument();
    expect(
      within(waitingFilOne).queryByRole("link", { name: /^Yours/ }),
    ).toBeNull();
    expect(screen.getByRole("link", { name: "New MNDA" })).toHaveAttribute(
      "href",
      "/internal/mndas?compose=1",
    );
    expect(screen.getByRole("link", { name: "Pricing" })).toHaveAttribute(
      "href",
      "/internal/pricing",
    );
  });

  it("marks broken work in the danger tone only while the reader has some", () => {
    const quiet = mndaHomeRows({
      ...counts,
      mine: { ...counts.mine, attention: 0 },
    });
    const { unmount } = render(
      <SalesHome userId={context.userId} sections={[section]} canSendMnda />,
    );
    const [attention, waitingPartner] = screen.getAllByRole("listitem");
    expect(attention).toHaveAttribute("data-attention");
    expect(waitingPartner).not.toHaveAttribute("data-attention");
    unmount();
    render(
      <SalesHome
        userId={context.userId}
        sections={[{ ...section, rows: quiet }]}
        canSendMnda
      />,
    );
    expect(screen.getAllByRole("listitem")[0]).not.toHaveAttribute(
      "data-attention",
    );
  });

  it("explains an unavailable section and where to go instead", () => {
    render(
      <SalesHome
        userId={context.userId}
        sections={[{ ...section, rows: null }]}
        canSendMnda={false}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "MNDA counts are not available right now.",
    );
    expect(
      screen.getByRole("link", { name: "Open the MNDA register" }),
    ).toHaveAttribute("href", "/internal/mndas");
    expect(screen.queryByRole("link", { name: "New MNDA" })).toBeNull();
  });

  it("lets the reader hide the start guide and bring it back", async () => {
    const user = userEvent.setup();
    render(
      <SalesHome userId={context.userId} sections={[]} canSendMnda={false} />,
    );
    const guide = screen.getByRole("region", { name: "Send your first MNDA" });
    expect(within(guide).getAllByRole("listitem")).toHaveLength(4);
    await user.click(screen.getByRole("button", { name: "Hide this guide" }));
    expect(
      screen.queryByRole("region", { name: "Send your first MNDA" }),
    ).toBeNull();
    expect(
      window.localStorage.getItem(startGuideStorageKey(context.userId)),
    ).toBe("1");
    await user.click(
      screen.getByRole("button", { name: "New to MNDAs? Show the four steps" }),
    );
    expect(
      screen.getByRole("region", { name: "Send your first MNDA" }),
    ).toBeInTheDocument();
  });

  it("puts the guide after the work, folded once the reader has sent an MNDA", async () => {
    const user = userEvent.setup();
    const reader = "21000000-0000-4000-8000-0000000000aa";
    const { unmount } = render(
      <SalesHome userId={reader} sections={[section]} canSendMnda />,
    );
    expect(
      screen.queryByRole("region", { name: "Send your first MNDA" }),
    ).toBeNull();
    const show = screen.getByRole("button", {
      name: "New to MNDAs? Show the four steps",
    });
    expect(
      screen
        .getByRole("region", { name: "Your MNDAs" })
        .compareDocumentPosition(show) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await user.click(show);
    expect(
      screen.getByRole("region", { name: "Send your first MNDA" }),
    ).toBeInTheDocument();
    unmount();
    // Drafts alone are not a sent MNDA: a newcomer still sees the steps.
    const draftsOnly = mndaHomeRows({
      ...counts,
      mine: {
        attention: 0,
        waitingPartner: 0,
        waitingFilOne: 0,
        completed: 0,
        drafts: 2,
      },
    });
    render(
      <SalesHome
        userId="21000000-0000-4000-8000-0000000000ab"
        sections={[{ ...section, rows: draftsOnly }]}
        canSendMnda
      />,
    );
    expect(
      screen.getByRole("region", { name: "Send your first MNDA" }),
    ).toBeInTheDocument();
  });
});

describe("partner next steps on the home page", () => {
  it("counts the reader's overdue and coming partner steps and links to the same filters", async () => {
    mocks.partners.mockResolvedValue({
      overdue: { mine: 1, team: 2 },
      dueThisWeek: { mine: 2, team: 4 },
    });
    const sections = await loadSalesHome(context);
    const partners = sections.find(({ id }) => id === "partners");
    expect(mocks.staff).toHaveBeenCalledWith("sales:read", mocks.session);
    expect(mocks.partners).toHaveBeenCalledWith(
      {},
      { viewerId: context.userId, today: "2026-10-04" },
    );
    expect(partners?.rows).toEqual([
      expect.objectContaining({
        id: "partners-overdue",
        mine: 1,
        team: 2,
        attention: true,
        href: "/internal/partners?mine=1&due=overdue",
        teamHref: "/internal/partners?due=overdue",
      }),
      expect.objectContaining({
        id: "partners-week",
        mine: 2,
        team: 4,
        href: "/internal/partners?mine=1&due=week",
        teamHref: "/internal/partners?due=week",
      }),
    ]);
  });

  it("leaves the section out when no partner step is due on the team", async () => {
    const sections = await loadSalesHome(context);
    expect(sections.find(({ id }) => id === "partners")?.rows).toEqual([]);
    render(
      <SalesHome userId={context.userId} sections={sections} canSendMnda />,
    );
    expect(
      screen.queryByRole("heading", { name: "Partners" }),
    ).not.toBeInTheDocument();
  });

  it("counts the guided demo's fictional partners", async () => {
    const sections = await loadSalesHome({ ...context, demo: true });
    expect(mocks.partners).not.toHaveBeenCalled();
    const rows = sections.find(({ id }) => id === "partners")?.rows ?? [];
    expect(rows.map(({ id, mine, team }) => ({ id, mine, team }))).toEqual([
      { id: "partners-overdue", mine: 1, team: 1 },
      { id: "partners-week", mine: 2, team: 3 },
    ]);
  });
});
