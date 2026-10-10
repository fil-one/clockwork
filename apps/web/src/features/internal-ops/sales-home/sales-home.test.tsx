import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { permissionsForRoles } from "@clockwork/contracts";
import type * as Db from "@clockwork/db";

const mocks = vi.hoisted(() => ({ count: vi.fn(), database: vi.fn() }));
vi.mock("@clockwork/db", async (importOriginal) => ({
  ...(await importOriginal<typeof Db>()),
  countSalesHomeMndas: mocks.count,
}));
vi.mock("@/src/db/service", () => ({
  getOptionalServiceDatabase: mocks.database,
}));

import { mndaHomeRows, mndaHomeSource } from "./mnda-source";
import { mndaRegisterHref, type SalesHomeSource } from "./model";
import { SalesHome } from "./sales-home";
import { loadSalesHome } from "./server-loader";
import { startGuideStorageKey } from "./start-guide";

const counts = {
  mine: { waitingPartner: 2, waitingFilOne: 0, completed: 4, drafts: 1 },
  team: { waitingPartner: 5, waitingFilOne: 3, completed: 9, drafts: 6 },
};
const context = {
  userId: "21000000-0000-4000-8000-000000000010",
  permissions: permissionsForRoles(["revenue"], { side: "fil_one" }),
  providerBacked: true,
  now: new Date("2026-10-04T12:00:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  mocks.database.mockReturnValue({});
  mocks.count.mockResolvedValue(counts);
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
      providerBacked: false,
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
