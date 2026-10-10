import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ContractListQuerySchema,
  type ContractListRow,
} from "@clockwork/contracts";
const mocks = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));
import { translatorFor } from "@/src/i18n/catalogs";
import { RegisterView, registerHref } from "./register-view";
import { RenewalsView } from "./renewals-view";
import { TemplatePicker } from "./template-picker";

const t = translatorFor("en");
beforeEach(() => {
  vi.clearAllMocks();
});
const row = (patch: Partial<ContractListRow> = {}): ContractListRow => ({
  id: "019a44ac-0000-7000-8000-0000000000c1",
  source: "register",
  counterpartyName: "Bluefin Data Co.",
  title: "2026 storage order",
  contractType: "customer_msa",
  paper: "theirs",
  status: "executed",
  effectiveDate: "2026-01-01",
  autoRenew: true,
  noticePeriodDays: 60,
  ownerName: "R.W. Holleman",
  tags: ["enterprise"],
  documentCount: 1,
  signingState: null,
  updatedAt: "2026-10-01T00:00:00.000Z",
  termEndDate: "2026-12-31",
  renewalDate: "2027-01-01",
  noticeDeadline: "2026-11-01",
  ...patch,
});
const query = (patch: Record<string, unknown> = {}) =>
  ContractListQuerySchema.parse(patch);

function renderRegister(
  rows: ContractListRow[],
  patch: {
    q?: string;
    status?: string;
    mine?: string;
    total?: number;
    canWrite?: boolean;
    canOpenMndas?: boolean;
    page?: number;
  } = {},
) {
  return render(
    <RegisterView
      t={t}
      locale="en-US"
      query={query({
        q: patch.q,
        page: patch.page,
        status: patch.status,
        mine: patch.mine,
      })}
      result={{
        rows,
        total: patch.total ?? rows.length,
        page: patch.page ?? 1,
        pageSize: 25,
      }}
      today="2026-10-04"
      canWrite={patch.canWrite ?? true}
      canOpenMndas={patch.canOpenMndas ?? true}
    />,
  );
}

describe("contract register", () => {
  it("leads each row with the counterparty and shows term dates in plain words", () => {
    renderRegister([
      row(),
      row({
        id: "019a44ac-0000-7000-8000-0000000000d2",
        source: "mnda",
        counterpartyName: "Northwind",
        contractType: "mnda",
        title: "",
        tags: [],
        autoRenew: false,
        termEndDate: null,
        renewalDate: null,
        noticeDeadline: null,
      }),
    ]);
    const table = screen.getByRole("table");
    expect(
      within(table).getByRole("link", { name: "Bluefin Data Co." }),
    ).toHaveAttribute(
      "href",
      "/internal/contracts/019a44ac-0000-7000-8000-0000000000c1",
    );
    // An MNDA row opens that counterparty's signed MNDAs.
    expect(
      within(table).getByRole("link", { name: "Northwind" }),
    ).toHaveAttribute("href", "/internal/mndas?status=completed&q=Northwind");
    expect(
      within(table).getByText("From the MNDA register"),
    ).toBeInTheDocument();
    expect(within(table).getByText("In 28 days")).toBeInTheDocument();
    expect(within(table).getByText("Renews")).toBeInTheDocument();
    expect(screen.getByText("2 contracts")).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: "Counterparty legal name, sort ascending",
      }),
    ).toHaveAttribute(
      "href",
      "/internal/contracts?sort=counterparty&direction=asc",
    );
  });

  it("flags an executed contract with no signed copy", () => {
    renderRegister([row({ documentCount: 0 })]);
    expect(screen.getAllByText("No signed copy")[0]).toBeInTheDocument();
  });

  it("explains an empty register, and offers to clear filters that match nothing", () => {
    const { unmount } = renderRegister([]);
    expect(screen.getByText("No contracts recorded yet")).toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: "Record a contract" }).length,
    ).toBeGreaterThan(0);
    unmount();
    renderRegister([], { q: "zzz" });
    expect(
      screen.getByText("No contracts match these filters"),
    ).toBeInTheDocument();
  });

  it("hides recording actions from readers", () => {
    renderRegister([row()], { canWrite: false });
    expect(
      screen.queryByRole("link", { name: "Record a contract" }),
    ).toBeNull();
    expect(
      screen.getByRole("link", { name: "Contract renewal notices" }),
    ).toBeInTheDocument();
  });

  it("pages with links that keep the filters", () => {
    renderRegister([row()], { q: "blue", total: 60, page: 2 });
    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute(
      "href",
      "/internal/contracts?q=blue&page=3",
    );
    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute(
      "href",
      "/internal/contracts?q=blue",
    );
    expect(screen.getByRole("link", { name: "Export CSV" })).toHaveAttribute(
      "href",
      "/internal/contracts/export?q=blue",
    );
  });

  it("keeps the reader's own filter in its form, links and export", () => {
    const { unmount } = renderRegister([row()], {
      status: "out_for_signature",
      mine: "1",
      total: 60,
    });
    expect(
      screen.getByRole("checkbox", { name: "Recorded by me" }),
    ).toBeChecked();
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute(
      "href",
      "/internal/contracts?status=out_for_signature&mine=1&page=2",
    );
    expect(screen.getByRole("link", { name: "Export CSV" })).toHaveAttribute(
      "href",
      "/internal/contracts/export?status=out_for_signature&mine=1",
    );
    unmount();
    // Nothing of the reader's own is a filtered result, not an empty register.
    renderRegister([], { mine: "1" });
    expect(
      screen.getByText("No contracts match these filters"),
    ).toBeInTheDocument();
    expect(query({ mine: "yes" }).mine).toBe(false);
  });

  it("builds short links", () => {
    expect(registerHref({ sort: "updated", page: 1 })).toBe(
      "/internal/contracts",
    );
  });
});

describe("renewal notices", () => {
  it("lists deadlines with the chosen window selected", () => {
    render(
      <RenewalsView
        t={t}
        locale="en-US"
        days={60}
        rows={[row()]}
        today="2026-10-04"
      />,
    );
    expect(screen.getByRole("link", { name: "Next 60 days" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByText("1 notice due")).toBeInTheDocument();
    expect(screen.getAllByText("60 days")[0]).toBeInTheDocument();
  });

  it("says when nothing is due", () => {
    render(
      <RenewalsView
        t={t}
        locale="en-US"
        days={30}
        rows={[]}
        today="2026-10-04"
      />,
    );
    expect(
      screen.getByText("No notices due in the next 30 days"),
    ).toBeInTheDocument();
  });
});

describe("template picker", () => {
  const pending = {
    id: "channel-partnership",
    contractType: "channel_partnership",
    status: "pending_legal",
  } as const;

  it("lists ready templates and names the pending ones in one line", () => {
    render(
      <TemplatePicker
        t={t}
        canWrite
        templates={[
          pending,
          {
            id: "test-fixture",
            contractType: "other",
            status: "available",
            version: "fixture-1",
            requiresApproval: true,
          },
        ]}
      />,
    );
    expect(
      screen.queryByRole("article", { name: "Channel partnership agreement" }),
    ).toBeNull();
    expect(
      screen.getByText(
        "Not yet supplied by legal: Channel partnership agreement. Record these manually once signed.",
      ),
    ).toBeInTheDocument();
    const ready = screen.getByRole("article", { name: "Other" });
    expect(
      within(ready).getByRole("link", { name: "Prepare Other" }),
    ).toHaveAttribute("href", "/internal/contracts/templates/test-fixture");
    expect(
      within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole(
        "link",
        { name: "Contracts" },
      ),
    ).toHaveAttribute("href", "/internal/contracts");
  });

  it("points to recording a signed agreement while legal has supplied none", () => {
    render(<TemplatePicker t={t} canWrite templates={[pending]} />);
    expect(
      screen.getByRole("heading", {
        name: "Legal has not supplied contract templates yet",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Record a signed agreement instead. Coming from legal: Channel partnership agreement.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Record a contract" }),
    ).toHaveAttribute("href", "/internal/contracts/new");
    expect(screen.queryByRole("link", { name: /^Prepare/ })).toBeNull();
  });
});

describe("register signing outcomes, MNDA links and export limit", () => {
  it("shows a declined signing beside the draft status and offers it as a filter", () => {
    renderRegister([
      row({ status: "draft", signingState: "declined", documentCount: 1 }),
    ]);
    expect(screen.getAllByText("Declined")[0]).toBeInTheDocument();
    // Signing outcomes sit in their own group of the status filter.
    const group = screen.getByRole("group", { name: "Signing" });
    expect(
      within(group).getByRole("option", { name: "Signer declined" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Signed" }).parentElement?.tagName,
    ).toBe("SELECT");
  });

  it("applies a filter as soon as it changes, keeping the sort", () => {
    render(
      <RegisterView
        t={t}
        locale="en-US"
        query={query({ sort: "counterparty", direction: "asc" })}
        result={{ rows: [row()], total: 1, page: 1, pageSize: 25 }}
        today="2026-10-04"
        canWrite
        canOpenMndas
      />,
    );
    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "Status" }), {
      target: { value: "signing_declined" },
    });
    expect(mocks.replace).toHaveBeenLastCalledWith(
      "/internal/contracts?status=signing_declined&sort=counterparty&direction=asc",
      { scroll: false },
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Recorded by me" }));
    expect(mocks.replace).toHaveBeenLastCalledWith(
      "/internal/contracts?status=signing_declined&mine=1&sort=counterparty&direction=asc",
      { scroll: false },
    );
  });

  it("runs a search when typing pauses, and folds the filters behind a counted button", () => {
    vi.useFakeTimers();
    try {
      renderRegister([row()], { status: "executed", mine: "1" });
      const toggle = screen.getByRole("button", { name: "Filters (2)" });
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      fireEvent.change(screen.getByRole("searchbox", { name: "Search" }), {
        target: { value: "blue " },
      });
      expect(mocks.replace).not.toHaveBeenCalled();
      vi.advanceTimersByTime(400);
      expect(mocks.replace).toHaveBeenCalledWith(
        "/internal/contracts?q=blue&status=executed&mine=1",
        { scroll: false },
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not link MNDA rows for readers who cannot open the MNDA register", () => {
    renderRegister(
      [
        row({
          source: "mnda",
          contractType: "mnda",
          counterpartyName: "Northwind",
        }),
      ],
      { canOpenMndas: false },
    );
    expect(screen.queryByRole("link", { name: "Northwind" })).toBeNull();
  });

  it("warns before an export that would stop at the row limit", () => {
    renderRegister([row()], { total: 5001 });
    expect(
      screen.getByText(
        /The CSV export includes the first 5,000 matching contracts/,
      ),
    ).toBeInTheDocument();
  });
});

it("lists contracts whose notice deadline passed, with their renewal date", () => {
  render(
    <RenewalsView
      t={t}
      locale="en-US"
      days={30}
      rows={[]}
      passed={[
        row({
          counterpartyName: "Harbor Media",
          noticeDeadline: "2026-10-01",
          renewalDate: "2026-11-01",
        }),
      ]}
      today="2026-10-04"
    />,
  );
  expect(
    screen.getByRole("heading", { name: "Notice deadline passed" }),
  ).toBeInTheDocument();
  expect(
    screen.getByText("Notice deadline Oct 1, 2026, renews on Nov 1, 2026"),
  ).toBeInTheDocument();
});
