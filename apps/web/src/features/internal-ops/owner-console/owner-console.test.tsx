import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  markRead: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("./actions", () => ({ markNoticesRead: mocks.markRead }));
vi.mock("../team/actions", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

import { demoOwnerConsole, type OwnerConsoleView } from "./model";
import { OwnerConsole } from "./owner-console";

const viewer = "21000000-0000-4000-8000-000000000020";
const demo = demoOwnerConsole(viewer);
const live: OwnerConsoleView = { ...demo, mode: "live" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.markRead.mockResolvedValue({ ok: true, marked: 1 });
});

function section(name: string) {
  return screen.getByRole("region", { name: new RegExp(`^${name}`) });
}

it("says what each notice is about and lets the reader mark it read", async () => {
  render(<OwnerConsole view={live} />);
  const notices = section("Notices for you");
  expect(
    within(notices).getByText(
      "Ada Mercer gave theo.lindqvist@fil-one-internal.test the Finance approver role",
    ),
  ).toBeInTheDocument();
  expect(
    within(notices).getByText("Reason: Quarter close cover"),
  ).toBeInTheDocument();
  fireEvent.click(
    within(notices).getByRole("button", { name: "Mark as read" }),
  );
  await waitFor(() =>
    expect(mocks.markRead).toHaveBeenCalledExactlyOnceWith({
      noticeIds: ["demo-notice-1"],
    }),
  );
  expect(await within(notices).findByText(/Nothing new/)).toBeInTheDocument();
  expect(mocks.refresh).toHaveBeenCalled();
});

it("marks every notice read at once and words a refusal", async () => {
  mocks.markRead.mockResolvedValueOnce({
    ok: false,
    code: "DIRECT_SESSION_REQUIRED",
  });
  render(<OwnerConsole view={live} />);
  const notices = section("Notices for you");
  fireEvent.click(
    within(notices).getByRole("button", { name: "Mark all as read" }),
  );
  expect(await within(notices).findByRole("alert")).toHaveTextContent(
    /Sign in as yourself/,
  );
  expect(mocks.markRead).toHaveBeenCalledWith({ noticeIds: "all" });
});

it("lists requests waiting for a second person, read only, with a link to decide each", () => {
  render(<OwnerConsole view={live} />);
  const approvals = section("Waiting for approval");
  const own = within(approvals)
    .getByText("North America standard, version 4")
    .closest("li");
  if (!own) throw new Error("No request row");
  expect(within(own).getByText("Price book activation")).toBeInTheDocument();
  expect(
    within(own).getByText("Your request: needs a second approver"),
  ).toBeInTheDocument();
  expect(within(own).getByText("Requested by Noor Haddad")).toBeVisible();
  expect(
    within(own).getByRole("link", { name: "Open request" }),
  ).toHaveAttribute("href", "/internal/price-books");
  const theirs = within(approvals).getByText("Partners").closest("li");
  if (!theirs) throw new Error("No request row");
  expect(
    within(theirs).queryByText("Your request: needs a second approver"),
  ).not.toBeInTheDocument();
  // Deciding happens on each control's page, never here.
  expect(within(approvals).queryByRole("button")).not.toBeInTheDocument();
});

it("words every control's request and says when one has no page", () => {
  render(
    <OwnerConsole
      view={{
        ...live,
        approvals: {
          unavailable: [],
          items: [
            {
              id: "a",
              control: "payg_offer",
              name: "S3-STD",
              version: 2,
              detail: "eu-central",
              requestedBy: "Ada Mercer",
              requestedAt: "2026-10-01T12:00:00Z",
              href: "/internal/payg-offers",
              ownRequest: false,
            },
            {
              id: "b",
              control: "exception_case",
              name: "Meridian Archive",
              version: null,
              detail: "legal",
              requestedBy: null,
              requestedAt: "2026-10-01T12:00:00Z",
              href: "/internal/queues/queue-legal-meridian",
              ownRequest: false,
            },
            {
              id: "c",
              control: "channel_policy",
              name: null,
              version: 3,
              detail: "2026-11-01",
              requestedBy: "Theo Lindqvist",
              requestedAt: "2026-10-01T12:00:00Z",
              href: "/internal/channel-policy",
              ownRequest: false,
            },
            {
              id: "d",
              control: "termination",
              name: "Cobalt Orchard Media",
              version: null,
              detail: null,
              requestedBy: "Ada Mercer",
              requestedAt: "2026-10-01T12:00:00Z",
              href: null,
              ownRequest: false,
            },
          ],
        },
      }}
    />,
  );
  const approvals = section("Waiting for approval");
  expect(
    within(approvals).getByText("S3-STD in eu-central, version 2"),
  ).toBeInTheDocument();
  expect(
    within(approvals).getByText("Legal: Meridian Archive"),
  ).toBeInTheDocument();
  expect(
    within(approvals).getByText("Raised by Fil One Commerce"),
  ).toBeInTheDocument();
  expect(
    within(approvals).getByText("Version 3, effective Nov 1, 2026"),
  ).toBeInTheDocument();
  const closure = within(approvals)
    .getByText("Cobalt Orchard Media")
    .closest("li");
  if (!closure) throw new Error("No request row");
  expect(within(closure).getByText("Account closure")).toBeInTheDocument();
  expect(
    within(closure).getByText("Decided outside the portal"),
  ).toBeInTheDocument();
  expect(within(closure).queryByRole("link")).not.toBeInTheDocument();
});

it("keeps every other control's requests when one control cannot be read", () => {
  render(
    <OwnerConsole
      view={{
        ...live,
        approvals: { ...demo.approvals, unavailable: ["channel_policy"] },
      }}
    />,
  );
  const approvals = section("Waiting for approval");
  expect(within(approvals).getByRole("status")).toHaveTextContent(
    "Requests of type Channel policy could not be loaded right now.",
  );
  expect(
    within(approvals).getByText("North America standard, version 4"),
  ).toBeInTheDocument();
  expect(within(approvals).getByText("Partners")).toBeInTheDocument();
  expect(
    within(approvals).queryByText("Nothing is waiting for approval."),
  ).not.toBeInTheDocument();
});

it("shows the demo read-only", () => {
  render(<OwnerConsole view={demo} />);
  expect(
    screen.getByText(/This demo shows sample records/),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Mark as read" }),
  ).not.toBeInTheDocument();
});

it("explains a section that could not be read and one that is empty", () => {
  render(
    <OwnerConsole
      view={{
        ...live,
        capabilities: { state: "unavailable" },
        approvals: { items: [], unavailable: [] },
        assistedSessions: { state: "ready", items: [] },
      }}
    />,
  );
  expect(
    within(section("Capability switches")).getByRole("status"),
  ).toHaveTextContent(/could not be loaded right now/);
  expect(
    within(section("Waiting for approval")).getByText(
      "Nothing is waiting for approval.",
    ),
  ).toBeInTheDocument();
  expect(
    within(section("Open assisted sessions")).getByText(
      "No one is in an assisted session.",
    ),
  ).toBeInTheDocument();
});

it("lists switches, staff, assisted sessions and the security record", () => {
  render(<OwnerConsole view={live} />);
  const switches = section("Capability switches");
  expect(within(switches).getByText("New business")).toBeInTheDocument();
  expect(
    within(switches).getByText("Switch-on request waiting"),
  ).toBeInTheDocument();
  expect(
    within(switches).getByRole("link", { name: /Open capabilities/ }),
  ).toHaveAttribute("href", "/internal/capabilities");
  const staff = section("Staff and roles");
  const theo = within(staff).getByText("Theo Lindqvist").closest("li");
  if (!theo) throw new Error("No staff row");
  expect(within(theo).getByText("Legal approver")).toBeInTheDocument();
  expect(
    within(section("Open assisted sessions")).getByText(
      "Ada Mercer in Cobalt Orchard Media",
    ),
  ).toBeInTheDocument();
  const security = section("Recent security events");
  expect(
    within(security).getByText(
      "Noor Haddad added priya.raman@fil-one-internal.test to the team as Revenue",
    ),
  ).toBeInTheDocument();
  expect(
    within(security).getByText(
      "Noor Haddad changed the MNDA notice email to legal@fil-one-internal.test",
    ),
  ).toBeInTheDocument();
});

it("shows which roles allow what, with staff management for administrators alone", () => {
  render(<OwnerConsole view={live} />);
  const matrix = section("Who can do what");
  const table = within(matrix).getByRole("table");
  const staffRow = within(table)
    .getByRole("rowheader", {
      name: "Add staff, change their roles and remove their access",
    })
    .closest("tr");
  if (!staffRow) throw new Error("No staff row");
  expect(within(staffRow).getAllByText("Allowed")).toHaveLength(1);
  const mndaRow = within(table)
    .getByRole("rowheader", { name: "Send MNDAs" })
    .closest("tr");
  if (!mndaRow) throw new Error("No MNDA row");
  // Operator, finance, legal, seller and administrator.
  expect(within(mndaRow).getAllByText("Allowed")).toHaveLength(5);
  expect(
    screen.getByText(/Referral partners hold the same roles/),
  ).toBeInTheDocument();
});
