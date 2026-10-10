import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { permissionsForRoles } from "@clockwork/contracts";
import type * as Db from "@clockwork/db";

const mocks = vi.hoisted(() => ({
  count: vi.fn(),
  contracts: vi.fn(),
  staff: vi.fn(),
  database: vi.fn(),
}));
vi.mock("@clockwork/db", async (importOriginal) => ({
  ...(await importOriginal<typeof Db>()),
  countSalesHomeMndas: mocks.count,
  countSalesHomeContracts: mocks.contracts,
}));
vi.mock("@/src/db/service", () => ({
  getOptionalServiceDatabase: mocks.database,
}));
vi.mock("../contracts/server", () => ({ contractStaff: mocks.staff }));

import { contractHomeRows } from "./contract-source";
import { mndaHomeRows, mndaHomeSource } from "./mnda-source";
import { mndaRegisterHref, type SalesHomeSource } from "./model";
import { SalesHome } from "./sales-home";
import { loadSalesHome } from "./server-loader";
import { startGuideStorageKey } from "./start-guide";

const counts = {
  mine: { waitingPartner: 2, waitingFilOne: 0, completed: 4, drafts: 1 },
  team: { waitingPartner: 5, waitingFilOne: 3, completed: 9, drafts: 6 },
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
      "/internal/mndas?status=sent,viewed&mine=1",
      "/internal/mndas?status=awaiting_countersignature&mine=1",
      "/internal/mndas?status=completed&mine=1",
      "/internal/mndas?status=draft,preparing,ready,sending&mine=1",
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
    expect(section?.rows?.map(({ mine }) => mine)).toEqual([2, 0, 4, 1]);
  });

  it("counts the guided demo's fictional register and links to it", async () => {
    const [section] = await loadSalesHome({
      ...context,
      demo: true,
    });
    expect(mocks.count).not.toHaveBeenCalled();
    expect(mocks.database).not.toHaveBeenCalled();
    expect(section?.rows?.map(({ mine }) => mine)).toEqual([1, 1, 1, 1]);
    // A completion older than 30 days is not counted.
    expect(section?.rows?.map(({ team }) => team)).toEqual([
      3,
      1,
      2,
      undefined,
    ]);
    expect(section?.rows?.[0]?.href).toBe(
      "/internal/mndas?status=sent,viewed&mine=1",
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
    expect(sections.map(({ id }) => id)).toEqual(["mndas", "contracts"]);
    expect(mocks.staff).toHaveBeenCalledWith("contract:read");
    expect(mocks.contracts).toHaveBeenCalledExactlyOnceWith(
      {},
      { viewerId: context.userId },
    );
    // A seller cannot approve, so no approval line.
    expect(
      sections[1]?.rows?.map(({ id, mine, team, teamHref }) => ({
        id,
        mine,
        team,
        teamHref,
      })),
    ).toEqual([
      {
        id: "contracts-needsAttention",
        mine: 0,
        team: 3,
        teamHref: "/internal/contracts?status=signing_attention",
      },
      {
        id: "contracts-outForSignature",
        mine: 2,
        team: 5,
        teamHref: "/internal/contracts?status=out_for_signature",
      },
    ]);
  });

  it("puts approvals first for someone who can approve", () => {
    expect(contractHomeRows(contractCounts, true)[0]).toMatchObject({
      id: "contracts-awaitingApproval",
      mine: 1,
      teamHref: "/internal/contracts?status=signing_approval",
    });
  });

  it("shows nothing new to a reader without contract permissions", async () => {
    const sections = await loadSalesHome({
      ...context,
      permissions: ["mnda:send", "sales:read"],
    });
    expect(sections.map(({ id }) => id)).toEqual(["mndas"]);
    expect(mocks.contracts).not.toHaveBeenCalled();
  });

  it("leaves the guided demo without a contract section", async () => {
    const sections = await loadSalesHome({ ...context, demo: true });
    expect(sections[1]?.rows).toEqual([]);
    expect(mocks.contracts).not.toHaveBeenCalled();
    render(
      <SalesHome userId={context.userId} sections={sections} canSendMnda />,
    );
    expect(screen.queryByRole("region", { name: "Your contracts" })).toBeNull();
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
      within(region).getByRole("link", { name: "5 across the team" }),
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
    const [waitingPartner, waitingFilOne] = rows as [HTMLElement, HTMLElement];
    expect(rows).toHaveLength(4);
    expect(within(waitingPartner).getByText("2")).toBeInTheDocument();
    expect(
      within(waitingPartner).getByRole("link", {
        name: "View in the register",
      }),
    ).toHaveAttribute("href", "/internal/mndas?status=sent,viewed&mine=1");
    expect(
      within(waitingPartner).getByRole("link", { name: "5 across the team" }),
    ).toHaveAttribute("href", "/internal/mndas?status=sent,viewed");
    // Nothing of the reader's waits on Fil One: say so, and offer no empty list.
    expect(
      within(waitingFilOne).getByText("None right now"),
    ).toBeInTheDocument();
    expect(
      within(waitingFilOne).queryByRole("link", {
        name: "View in the register",
      }),
    ).toBeNull();
    expect(screen.getByRole("link", { name: "Send an MNDA" })).toHaveAttribute(
      "href",
      "/internal/mndas",
    );
    expect(
      screen.getByRole("link", { name: "Indicative pricing" }),
    ).toHaveAttribute("href", "/internal/pricing");
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
    expect(screen.queryByRole("link", { name: "Send an MNDA" })).toBeNull();
  });

  it("lets the reader hide the start guide and bring it back", async () => {
    const user = userEvent.setup();
    render(
      <SalesHome userId={context.userId} sections={[]} canSendMnda={false} />,
    );
    const guide = screen.getByRole("region", { name: "Start here" });
    expect(within(guide).getAllByRole("listitem")).toHaveLength(4);
    await user.click(screen.getByRole("button", { name: "Hide this guide" }));
    expect(screen.queryByRole("region", { name: "Start here" })).toBeNull();
    expect(
      window.localStorage.getItem(startGuideStorageKey(context.userId)),
    ).toBe("1");
    await user.click(
      screen.getByRole("button", { name: "Show the start guide" }),
    );
    expect(
      screen.getByRole("region", { name: "Start here" }),
    ).toBeInTheDocument();
  });
});
