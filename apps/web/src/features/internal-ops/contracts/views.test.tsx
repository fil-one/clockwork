import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  ContractListQuerySchema,
  type ContractListRow,
} from "@clockwork/contracts";
import { translatorFor } from "@/src/i18n/catalogs";
import { RegisterView, registerHref } from "./register-view";
import { RenewalsView } from "./renewals-view";
import { TemplatePicker } from "./template-picker";

const t = translatorFor("en");
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
      query={query({ q: patch.q, page: patch.page, status: patch.status })}
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
    expect(
      within(table).getByRole("link", { name: "Northwind" }),
    ).toHaveAttribute("href", "/internal/mndas");
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
      screen.getByRole("link", { name: "Renewal notices" }),
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
  it("shows pending templates as coming from legal and never selectable", () => {
    render(
      <TemplatePicker
        t={t}
        canWrite
        templates={[
          {
            id: "channel-partnership",
            contractType: "channel_partnership",
            status: "pending_legal",
          },
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
    const pending = screen.getByRole("article", {
      name: "Channel partnership agreement",
    });
    expect(
      within(pending).getByText("Template pending from legal"),
    ).toBeInTheDocument();
    expect(
      within(pending).queryByRole("link", { name: /^Prepare/ }),
    ).toBeNull();
    expect(
      within(pending).getByRole("link", {
        name: "Record a Channel partnership agreement manually",
      }),
    ).toHaveAttribute(
      "href",
      "/internal/contracts/new?type=channel_partnership",
    );
    const ready = screen.getByRole("article", { name: "Other" });
    expect(
      within(ready).getByRole("link", { name: "Prepare Other" }),
    ).toHaveAttribute("href", "/internal/contracts/templates/test-fixture");
  });
});

describe("register signing outcomes, MNDA links and export limit", () => {
  it("shows a declined signing beside the draft status and offers it as a filter", () => {
    renderRegister([
      row({ status: "draft", signingState: "declined", documentCount: 1 }),
    ]);
    expect(screen.getAllByText("Declined")[0]).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Draft: signer declined" }),
    ).toBeInTheDocument();
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
