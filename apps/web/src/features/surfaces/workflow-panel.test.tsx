import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { coreReportNames } from "@clockwork/contracts";

import { catalogs } from "@/src/i18n/catalogs";
import { LanguageProvider } from "@/src/i18n/client";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { surfaceWorkflows } from "./surface-catalog";
import { WorkflowPanel } from "./workflow-panel";

const csrfToken = "12345678901234567890123456789012";

/**
 * The identifiers a route resolves. They are deliberately not the seeded
 * fixture values the panel used to fall back to, so a test only passes when the
 * panel carries what it was handed.
 */
const routeContext = {
  accountId: "10000000-0000-4000-8000-000000000001",
  organizationId: "30000000-0000-4000-8000-000000000001",
  orderId: "50000000-0000-4000-8000-000000000008",
  userId: "20000000-0000-4000-8000-000000000002",
  quoteId: "50000000-0000-4000-8000-000000000004",
  supportOwnerId: "20000000-0000-4000-8000-000000000005",
  partnerAccountId: "10000000-0000-4000-8000-000000000002",
  endClientAccountId: "10000000-0000-4000-8000-000000000004",
  pocId: "60000000-0000-4000-8000-000000000001",
  caseId: "70000000-0000-4000-8000-000000000001",
} as const;

function response(status = 200) {
  return new Response(
    JSON.stringify(
      status === 200
        ? {
            record: {
              id: routeContext.accountId,
              resource: "accounts",
              rowVersion: 8,
              data: {},
              createdAt: "2026-08-16T12:00:00.000Z",
              updatedAt: "2026-08-16T12:00:00.000Z",
            },
            auditEventId: "audit-1",
            outboxMessageId: "outbox-1",
          }
        : { error: "conflict" },
    ),
    { status, headers: { "content-type": "application/json" } },
  );
}

function accountReadResponse(rowVersion = 7) {
  return new Response(
    JSON.stringify({
      items: [
        {
          id: routeContext.accountId,
          resource: "accounts",
          accountId: routeContext.accountId,
          rowVersion,
          data: {},
          createdAt: "2026-08-16T12:00:00.000Z",
          updatedAt: "2026-08-16T12:00:00.000Z",
        },
      ],
      nextCursor: null,
    }),
    { headers: { "content-type": "application/json" } },
  );
}

async function fillAccountUpdate(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Legal name"), "Northstar Ltd");
  await user.type(
    screen.getByLabelText("Invoice delivery email"),
    "ap@northstar.test",
  );
  await user.type(screen.getByLabelText("Billing contact name"), "Maya Chen");
  await user.type(
    screen.getByLabelText("Billing contact email"),
    "maya@northstar.test",
  );
}

beforeEach(() => {
  refresh.mockClear();
  document.cookie = `clockwork-csrf=${csrfToken}; path=/`;
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.cookie = "clockwork-csrf=; Max-Age=0; path=/";
});

describe("generated-client commerce workflows", () => {
  /**
   * Eight workflows left this panel for purpose-built, record-bound surfaces:
   * quote (`/quotes/new`, `/partner/quotes/new`), agreement
   * (`/agreements/execute`), order (`/orders/accept`), offboarding
   * (`/account/offboarding`), payment (`PaymentHandoff` on `/billing/[id]`),
   * pricebook (`/internal/price-books`), assisted (`startAssistedSession`,
   * after which the operator works the customer surfaces) and collections
   * (`CorrectionDialog` and `ProjectionActionButtons` on
   * `/internal/collections`). Registration left for `/partner/registrations`,
   * and `admin` was never an implementation at all. None may come back here: a
   * second form for a write that already has an owner is a second set of rules
   * for the same record.
   *
   * `collections` is the one that had to be removed rather than merely moved.
   * Its credit-note and refund payloads were rejected outright by the
   * `.strict()` command schemas -- wrong key names and two unrecognized keys
   * each -- so leaving the branch mounted anywhere would have shipped two
   * controls that fail at the boundary every time.
   */
  it("keeps no branch for a workflow a record-bound surface owns", () => {
    const superseded = [
      "quote",
      "agreement",
      "order",
      "offboarding",
      "payment",
      "pricebook",
      "assisted",
      "registration",
      "collections",
      "admin",
    ];
    for (const workflow of superseded)
      expect(surfaceWorkflows as readonly string[]).not.toContain(workflow);
  });

  /**
   * `admin` was a `SurfaceWorkflow` with a title, no fields, and no command.
   * The panel rendered an empty form and its Submit announced "the server
   * record is now the source of truth" having posted nothing. Every member of
   * the inventory has to render an actual control, so a title-only member
   * fails here rather than in front of a reader.
   */
  it("renders a real form for every workflow in the inventory", () => {
    for (const workflow of surfaceWorkflows) {
      const { unmount } = render(
        <WorkflowPanel
          context={routeContext}
          workflow={workflow}
          surface="dashboard"
        />,
      );
      expect(
        screen.getByRole("heading", { level: 2 }).textContent,
      ).toBeTruthy();
      expect(
        document.querySelectorAll("form input, form select, form textarea")
          .length,
      ).toBeGreaterThan(0);
      unmount();
    }
  });

  it("surfaces a concurrent-write conflict and moves focus to recovery guidance", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(response(409))),
    );
    const user = userEvent.setup();
    render(
      <WorkflowPanel
        context={{
          accountId: routeContext.accountId,
          orderId: routeContext.orderId,
        }}
        workflow="renewal"
        surface="services"
      />,
    );

    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Submit" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("changed while you were working");
    await waitFor(() => expect(alert).toHaveFocus());
  });

  it("renews an order in one submission and confirms a decline first", async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(response()));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(
      <WorkflowPanel
        context={{
          accountId: routeContext.accountId,
          orderId: routeContext.orderId,
        }}
        workflow="renewal"
        surface="services"
      />,
    );

    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      await screen.findByText(/server record is now the source of truth/i),
    ).toBeVisible();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect((fetchMock.mock.calls[0]?.[0] as Request).url).toContain(
      "/requests",
    );

    await user.selectOptions(
      screen.getByLabelText("Renewal action"),
      "decline",
    );
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(fetchMock).toHaveBeenCalledOnce();

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Confirm this decision");
    await user.click(
      within(dialog).getByRole("button", { name: "Keep the record unchanged" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(fetchMock).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Submit" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Confirm and submit",
      }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Submit" })).toHaveFocus();
    expect(refresh).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[1]?.[0] as Request).url).toContain(
      "/declines",
    );
  });

  it("loads and downloads each report through the generated report operation", async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const request = input as Request;
      if (request.url.includes("format=csv"))
        return Promise.resolve(
          new Response("report,source_record_id\nweekly_scorecard,order-1\n", {
            headers: { "content-type": "text/csv" },
          }),
        );
      return Promise.resolve(
        new Response(
          JSON.stringify({
            items: [{ id: "order-1", resource: "orders" }],
            nextCursor: null,
          }),
          { headers: { "content-type": "application/json" } },
        ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:report");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      () => undefined,
    );
    const user = userEvent.setup();
    render(<WorkflowPanel context={{}} workflow="reports" surface="reports" />);

    const report = screen.getByLabelText("Report");
    expect(report.querySelectorAll("option")).toHaveLength(
      coreReportNames.length,
    );
    await user.selectOptions(report, "weekly_scorecard");
    await user.click(screen.getByRole("button", { name: "View report" }));
    expect(
      await screen.findByText("Report loaded from source records."),
    ).toBeVisible();
    expect(screen.getByLabelText("Report result")).toHaveTextContent("order-1");

    await user.click(screen.getByRole("button", { name: "Download CSV" }));
    expect(
      await screen.findByText("CSV downloaded from source records."),
    ).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondCall = fetchMock.mock.calls.at(1);
    expect(secondCall).toBeDefined();
    if (!secondCall) throw new Error("CSV request was not captured.");
    expect((secondCall[0] as Request).url).toContain("format=csv");
  });
});

/**
 * These identifiers are never shown anywhere a customer can read them, so a
 * self-service form that asks for one is a form nobody outside a seeded
 * environment can submit. The route already holds them; the panel has to carry
 * what it is given, and has to keep accepting typed input where no route
 * supplies anything.
 */
describe("route-resolved record identifiers", () => {
  it("renews the order the route resolved, without asking the reader for it", async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(response()));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(
      <WorkflowPanel
        context={{
          accountId: routeContext.accountId,
          orderId: routeContext.orderId,
        }}
        workflow="renewal"
        surface="services"
      />,
    );

    const account = screen.getByLabelText("Account ID");
    const order = screen.getByLabelText("Order ID");
    expect(account).toHaveValue(routeContext.accountId);
    expect(account).toHaveAttribute("readonly");
    expect(order).toHaveValue(routeContext.orderId);
    expect(order).toHaveAttribute("readonly");

    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(
      await screen.findByText(/server record is now the source of truth/i),
    ).toBeVisible();
    const firstCall = fetchMock.mock.calls.at(0);
    if (!firstCall) throw new Error("Renewal request was not captured.");
    const request = firstCall[0] as Request;
    expect(request.url).toContain(`/renewals/${routeContext.orderId}/requests`);
    await expect(request.clone().json()).resolves.toMatchObject({
      accountId: routeContext.accountId,
    });
  });

  it("invites against the organization and account the route resolved", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ id: "invite-1", status: "pending" }), {
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(
      <WorkflowPanel
        context={{
          accountId: routeContext.accountId,
          organizationId: routeContext.organizationId,
        }}
        workflow="invite"
        surface="users"
      />,
    );

    expect(screen.getByLabelText("Organization ID")).toHaveValue(
      routeContext.organizationId,
    );
    expect(screen.getByLabelText("Account ID")).toHaveValue(
      routeContext.accountId,
    );
    await user.type(
      screen.getByLabelText("Invitee email"),
      "new@northstar.test",
    );
    await user.type(
      screen.getByLabelText("Invitation expires"),
      "2026-09-30T17:00",
    );
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(
      await screen.findByText(/server record is now the source of truth/i),
    ).toBeVisible();
    expect(refresh).toHaveBeenCalledOnce();

    const firstCall = fetchMock.mock.calls.at(0);
    if (!firstCall) throw new Error("Invite request was not captured.");
    const request = firstCall[0] as Request;
    expect(request.url).toContain(
      `/organizations/${routeContext.organizationId}/invites`,
    );
    await expect(request.clone().json()).resolves.toMatchObject({
      accountId: routeContext.accountId,
      email: "new@northstar.test",
    });
  });

  it("reads the core account version and never asks the reader to guess it", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(accountReadResponse(7))
      .mockResolvedValueOnce(response());
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(
      <WorkflowPanel
        context={{ accountId: routeContext.accountId }}
        workflow="account"
        surface="account"
      />,
    );

    expect(screen.queryByLabelText("Current row version")).toBeNull();
    await fillAccountUpdate(user);
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByText("Account details saved.")).toBeVisible();
    expect(screen.queryByText(routeContext.accountId)).toBeNull();
    expect(screen.queryByText(/row version/iu)).toBeNull();
    expect(refresh).toHaveBeenCalledOnce();

    const firstCall = fetchMock.mock.calls.at(1);
    if (!firstCall) throw new Error("Account update was not captured.");
    await expect(
      (firstCall[0] as Request).clone().json(),
    ).resolves.toMatchObject({
      id: routeContext.accountId,
      accountId: routeContext.accountId,
      expectedVersion: 7,
    });
  });

  it("reuses one account command key when an uncertain attempt is retried", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(accountReadResponse(7))
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(accountReadResponse(7))
      .mockResolvedValueOnce(response());
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(
      <WorkflowPanel
        context={{ accountId: routeContext.accountId }}
        workflow="account"
        surface="account"
      />,
    );

    await fillAccountUpdate(user);
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByRole("alert")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByText("Account details saved.")).toBeVisible();

    expect(fetchMock).toHaveBeenCalledTimes(4);
    const first = fetchMock.mock.calls[1]?.[0] as Request;
    const second = fetchMock.mock.calls[3]?.[0] as Request;
    expect(first.headers.get("idempotency-key")).toBeTruthy();
    expect(second.headers.get("idempotency-key")).toBe(
      first.headers.get("idempotency-key"),
    );
  });

  it("starts a new account command key after a successful command", async () => {
    const fetchMock = vi.fn<typeof fetch>((input) =>
      Promise.resolve(
        (input as Request).method === "GET"
          ? accountReadResponse(7)
          : response(),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(
      <WorkflowPanel
        context={{ accountId: routeContext.accountId }}
        workflow="account"
        surface="account"
      />,
    );

    await fillAccountUpdate(user);
    await user.click(screen.getByRole("button", { name: "Submit" }));
    await screen.findByText("Account details saved.");
    await user.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));

    const first = fetchMock.mock.calls[1]?.[0] as Request;
    const second = fetchMock.mock.calls[3]?.[0] as Request;
    expect(first.headers.get("idempotency-key")).toBeTruthy();
    expect(second.headers.get("idempotency-key")).not.toBe(
      first.headers.get("idempotency-key"),
    );
  });

  it("disables a destructive confirmation while its submission is pending", async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          }),
      ),
    );
    const user = userEvent.setup();
    render(
      <WorkflowPanel
        context={{ caseId: routeContext.caseId }}
        workflow="approval"
        surface="approvals"
      />,
    );

    await user.selectOptions(screen.getByLabelText("Decision"), "rejected");
    await user.type(
      screen.getByLabelText("Reason for the decision"),
      "Policy evidence conflicts with the request.",
    );
    await user.type(
      screen.getByLabelText("Evidence document ID"),
      "90000000-0000-4000-8000-000000000001",
    );
    const submit = screen.getByRole("button", { name: "Submit" });
    await user.click(submit);
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", {
      name: "Confirm and submit",
    });
    const form = submit.closest("form");
    if (!form) throw new Error("Workflow form was not rendered.");

    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(confirm).toBeDisabled());
    expect(fetch).toHaveBeenCalledOnce();

    resolveFetch?.(
      Response.json({
        caseId: routeContext.caseId,
        status: "rejected",
      }),
    );
    await waitFor(() => expect(screen.queryByText("Submitting…")).toBeNull());
  });

  /**
   * The shape `/partner/portfolio/[id]` shipped: a required identifier the
   * surface does not carry, rendered as an empty editable box, so Submit failed
   * local validation and posted nothing while looking like a working form. An
   * identifier nobody can read is not one anybody can type, so the panel now
   * states the gap and refuses, and the refusal is visible before a reader
   * fills anything in.
   */
  it("refuses to submit when a required identifier is not on the surface", async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(response()));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(
      <WorkflowPanel
        context={{ accountId: routeContext.accountId }}
        workflow="renewal"
        surface="partnerRenewals"
      />,
    );

    const order = screen.getByLabelText("Order ID");
    expect(order).toHaveValue("");
    expect(order).toBeDisabled();
    expect(
      screen.getByText(
        /binds to identifiers this page does not carry: Order ID\./,
      ),
    ).toBeVisible();

    const submit = screen.getByRole("button", { name: "Submit" });
    expect(submit).toBeDisabled();
    await user.click(submit);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /**
   * The complement, and the reason the field is not unconditionally read-only:
   * an identifier the command can be built without stays typeable, because a
   * POC that is not being converted has no paid quote or order to carry.
   */
  it("leaves an optional unresolved identifier editable", () => {
    render(
      <WorkflowPanel
        context={{ accountId: routeContext.accountId }}
        workflow="poc"
        surface="pocs"
      />,
    );

    for (const label of [
      "Paid quote ID",
      "Paid order ID",
      "Support owner ID",
    ]) {
      const field = screen.getByLabelText(label);
      expect(field).toHaveValue("");
      expect(field).toBeEnabled();
    }
    expect(screen.getByRole("button", { name: "Submit" })).toBeEnabled();
  });

  /**
   * The seeded identifiers used to appear whenever `NODE_ENV` was development
   * or test -- which is every environment a test runs in, and none that a
   * customer uses. Nothing may reintroduce them.
   */
  it("never falls back to a seeded identifier", () => {
    render(
      <WorkflowPanel context={{}} workflow="renewal" surface="services" />,
    );
    for (const label of ["Account ID", "Order ID"])
      expect(screen.getByLabelText(label)).toHaveValue("");
  });

  /**
   * The brand form's domain, DNS token and brand name were pre-filled with a
   * fixture partner's values whenever the runtime environment was development
   * or test, so the form every test drove was not the form production renders.
   */
  it("renders the brand form with no seeded partner values", () => {
    render(
      <WorkflowPanel
        context={{ partnerAccountId: routeContext.accountId }}
        workflow="brand"
        surface="brand"
      />,
    );

    expect(screen.getByLabelText("Partner account ID")).toHaveValue(
      routeContext.accountId,
    );
    for (const label of [
      "Custom domain",
      "DNS verification token",
      "Brand name",
    ])
      expect(screen.getByLabelText(label)).toHaveValue("");
  });

  /**
   * An unreachable command used to render as "Development simulation accepted"
   * in exactly the environments every test and local drive runs in, which is
   * how a panel that posts real commands could look green while posting
   * nothing. A failure now reads as a failure everywhere.
   */
  it("reports an unavailable command as a failure, not a simulated success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: "unavailable" }), {
            status: 503,
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
    );
    const user = userEvent.setup();
    render(
      <WorkflowPanel
        context={{
          accountId: routeContext.accountId,
          orderId: routeContext.orderId,
        }}
        workflow="renewal"
        surface="services"
      />,
    );

    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.queryByText(/Development simulation accepted/i)).toBeNull();
    expect(
      screen.queryByText(/server record is now the source of truth/i),
    ).toBeNull();
  });
});

/**
 * The panel used to be English in every language: its titles, labels, options
 * and outcomes were literals, and the unbindable-action sentence lowercased the
 * field labels and joined them with an English "and" -- "binds to the account
 * id and order id" in the middle of a German page. The reader's language now
 * governs all of it, including how the missing identifiers are listed.
 */
describe("the reader's language", () => {
  it("renders a renewal a surface cannot bind entirely in German", () => {
    render(
      <LanguageProvider locale="de" catalog={catalogs.de}>
        <WorkflowPanel context={{}} workflow="renewal" surface="services" />
      </LanguageProvider>,
    );

    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "Verlängerungsentscheidung",
    );
    expect(screen.getByLabelText("Aktion zur Verlängerung")).toBeVisible();
    expect(screen.getByLabelText("Auftrags-ID")).toBeDisabled();
    // Labels keep German noun capitalization and are joined by German's own
    // list format, not by a lowercased English "and".
    expect(
      screen.getByText(
        "Diese Aktion ist an Kennungen gebunden, die diese Seite nicht enthält: Konto-ID und Auftrags-ID. Von hier aus kann nichts übermittelt werden, und es wurde nichts gesendet.",
      ),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Absenden" })).toBeDisabled();
    expect(document.body.textContent).not.toMatch(
      /Server-backed action|Renewal action|Submit|binds to|Decline renewal|Chief Operating/u,
    );
  });

  it("names every report in Arabic instead of printing its contract key", () => {
    render(
      <LanguageProvider locale="ar" catalog={catalogs.ar}>
        <WorkflowPanel context={{}} workflow="reports" surface="reports" />
      </LanguageProvider>,
    );

    const options = [
      ...screen.getByLabelText("التقرير").querySelectorAll("option"),
    ].map((option) => option.textContent ?? "");
    expect(options).toHaveLength(coreReportNames.length);
    expect(options).toContain("بطاقة الأداء الأسبوعية");
    for (const label of options) expect(label).not.toMatch(/[A-Za-z_]{4,}/u);
    expect(screen.getByRole("button", { name: "عرض التقرير" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "تنزيل CSV" })).toBeEnabled();
  });
});
