import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  priceBookId: "40000000-0000-4000-8000-000000000007",
  orderId: "50000000-0000-4000-8000-000000000008",
  invoiceId: "50000000-0000-4000-8000-000000000014",
  userId: "20000000-0000-4000-8000-000000000002",
  quoteId: "50000000-0000-4000-8000-000000000004",
  agreementId: "50000000-0000-4000-8000-000000000001",
} as const;

function response(status = 200) {
  return new Response(
    JSON.stringify(
      status === 200
        ? {
            record: {
              id: "88888888-8888-4888-8888-888888888888",
              resource: "quotes",
              rowVersion: 1,
              data: {},
            },
            auditEventId: "audit-1",
            outboxEventId: "outbox-1",
          }
        : { error: "conflict" },
    ),
    { status, headers: { "content-type": "application/json" } },
  );
}

beforeEach(() => {
  document.cookie = `clockwork-csrf=${csrfToken}; path=/`;
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.cookie = "clockwork-csrf=; Max-Age=0; path=/";
});

describe("generated-client commerce workflows", () => {
  it("validates the quote locally and restores focus to the invalid field", async () => {
    const user = userEvent.setup();
    render(
      <WorkflowPanel
        context={{
          accountId: routeContext.accountId,
          priceBookId: routeContext.priceBookId,
        }}
        workflow="quote"
        surface="quoteBuilder"
      />,
    );
    const capacity = screen.getByLabelText("Committed capacity");
    await user.clear(capacity);
    await user.type(capacity, "4");
    await user.click(screen.getByRole("button", { name: "Submit securely" }));
    expect(screen.getByRole("alert")).toHaveTextContent("at least 10 TB");
    expect(capacity).toHaveFocus();
  });

  it("submits a direct quote through the generated command with CSRF and idempotency", async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(response()));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(
      <WorkflowPanel
        context={{
          accountId: routeContext.accountId,
          priceBookId: routeContext.priceBookId,
        }}
        workflow="quote"
        surface="quoteBuilder"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Submit securely" }));
    expect(
      await screen.findByText(/server record is now the source of truth/i),
    ).toHaveAttribute("role", "status");

    expect(fetchMock).toHaveBeenCalledOnce();
    const firstCall = fetchMock.mock.calls.at(0);
    expect(firstCall).toBeDefined();
    if (!firstCall) throw new Error("Quote request was not captured.");
    const request = firstCall[0] as Request;
    expect(request.url).toContain("/api/v1/core/commands/quotes");
    expect(request.headers.get("x-csrf-token")).toBe(csrfToken);
    expect(request.headers.get("idempotency-key")).toBeTruthy();
    await expect(request.clone().json()).resolves.toMatchObject({
      action: "create",
      payload: { route: "direct" },
    });
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
          priceBookId: routeContext.priceBookId,
        }}
        workflow="quote"
        surface="quoteBuilder"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Submit securely" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("changed while you were working");
    await waitFor(() => expect(alert).toHaveFocus());
  });

  it("creates a Stripe-hosted invoice payment session without claiming payment", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            provider: "stripe",
            sessionId: "in_demo",
            invoiceId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            url: "https://invoice.stripe.com/i/acct_demo/in_demo",
            status: "requires_customer_action",
          }),
          { headers: { "content-type": "application/json" } },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(
      <WorkflowPanel
        context={{
          accountId: routeContext.accountId,
          invoiceId: routeContext.invoiceId,
        }}
        workflow="payment"
        surface="billing"
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Open secure payment" }),
    );
    expect(
      await screen.findByText(/Invoice status changes only after Stripe/i),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Continue to secure Stripe payment" }),
    ).toHaveAttribute("href", "https://invoice.stripe.com/i/acct_demo/in_demo");
    const firstCall = fetchMock.mock.calls.at(0);
    expect(firstCall).toBeDefined();
    if (!firstCall) throw new Error("Payment request was not captured.");
    const request = firstCall[0] as Request;
    expect(request.url).toContain("/api/v1/core/payment-sessions");
    await expect(request.clone().json()).resolves.toEqual({
      accountId: routeContext.accountId,
      invoiceId: routeContext.invoiceId,
    });
  });

  it("executes assisted quote creation through the same command contract", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      capturedBody = (await (input as Request).clone().json()) as Record<
        string,
        unknown
      >;
      return response();
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(
      <WorkflowPanel
        context={{
          accountId: routeContext.accountId,
          priceBookId: routeContext.priceBookId,
        }}
        workflow="assisted"
        surface="assisted"
      />,
    );

    expect(
      screen.getByText(/assisted session supplies the staff actor/i),
    ).toBeVisible();
    await user.click(
      screen.getByRole("checkbox", { name: /active assisted session/i }),
    );
    await user.click(
      screen.getByRole("button", { name: "Create assisted quote" }),
    );
    expect(
      await screen.findByText(/server record is now the source of truth/i),
    ).toBeVisible();
    const firstCall = fetchMock.mock.calls.at(0);
    expect(firstCall).toBeDefined();
    if (!firstCall) throw new Error("Assisted request was not captured.");
    const request = firstCall[0] as Request;
    expect(request.url).toContain("/api/v1/core/commands/quotes");
    expect(capturedBody).toMatchObject({
      accountId: routeContext.accountId,
      action: "create",
      payload: { route: "direct" },
    });
    expect(capturedBody).not.toHaveProperty("actor");
    expect(capturedBody).not.toHaveProperty("assistedActionReason");
  });

  it("loads immutable active agreement text before click-through acceptance", async () => {
    const exactText = "Cloud Service Agreement\nVersion 1.0.0\n";
    const exactTextHash = createHash("sha256")
      .update(exactText, "utf8")
      .digest("hex");
    let acceptanceBody: Record<string, unknown> | undefined;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const request = input as Request;
      if (request.method === "GET")
        return new Response(
          JSON.stringify({
            id: "55555555-5555-4555-8555-555555555555",
            type: "csa",
            semanticVersion: "1.0.0",
            jurisdiction: "US",
            effectiveOn: "2026-01-01",
            canonicalDocumentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            exactText,
            exactTextHash,
            executionMode: "click_through",
          }),
          { headers: { "content-type": "application/json" } },
        );
      acceptanceBody = (await request.clone().json()) as Record<
        string,
        unknown
      >;
      return new Response(
        JSON.stringify({ id: "agreement-1", status: "executed" }),
        { headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(
      <WorkflowPanel
        context={{ accountId: routeContext.accountId }}
        workflow="agreement"
        surface="agreementExecution"
      />,
    );

    expect(await screen.findByLabelText("Exact agreement text")).toHaveValue(
      exactText,
    );
    expect(screen.getByLabelText("Exact agreement text")).toHaveAttribute(
      "readonly",
    );
    expect(screen.getByLabelText("Approved text SHA-256")).toHaveValue(
      exactTextHash,
    );
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Submit securely" }));
    expect(
      await screen.findByText(/server record is now the source of truth/i),
    ).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(acceptanceBody).toMatchObject({
      templateId: "55555555-5555-4555-8555-555555555555",
      templateVersion: "1.0.0",
      exactText,
      exactTextHash,
      authorityAttested: true,
    });
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
    await user.click(screen.getByRole("button", { name: "Submit securely" }));
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
    await user.click(screen.getByRole("button", { name: "Submit securely" }));
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

    await user.click(screen.getByRole("button", { name: "Submit securely" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Confirm and submit",
      }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
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
    expect(report.querySelectorAll("option")).toHaveLength(8);
    await user.selectOptions(report, "weekly_scorecard");
    await user.click(screen.getByRole("button", { name: "View report" }));
    expect(
      await screen.findByText("Report loaded from source records."),
    ).toBeVisible();
    expect(screen.getByLabelText("Report result")).toHaveTextContent("order-1");

    await user.click(screen.getByRole("button", { name: "Download CSV" }));
    expect(
      await screen.findByText("CSV export downloaded from source records."),
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
    await user.click(screen.getByRole("button", { name: "Submit securely" }));
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
      screen.getByLabelText("Invite expires at"),
      "2026-09-30T17:00",
    );
    await user.click(screen.getByRole("button", { name: "Submit securely" }));
    expect(
      await screen.findByText(/server record is now the source of truth/i),
    ).toBeVisible();

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

  /**
   * The row version is deliberately not a `WorkflowRecordContext` key. It is
   * compared against the core account aggregate's own `row_version`, which only
   * an authoritative read of the account produces; the projection row version a
   * route could reach is a different counter. Until that read exists the panel
   * shows the guess rather than dressing a wrong number as a resolved one.
   */
  it("shows the account row version as a stated guess and posts what is shown", async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(response()));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(
      <WorkflowPanel
        context={{ accountId: routeContext.accountId }}
        workflow="account"
        surface="account"
      />,
    );

    const rowVersion = screen.getByLabelText("Current row version");
    expect(rowVersion).toHaveValue(1);
    expect(rowVersion).not.toHaveAttribute("readonly");
    await user.clear(rowVersion);
    await user.type(rowVersion, "7");
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
    await user.click(screen.getByRole("button", { name: "Submit securely" }));
    expect(
      await screen.findByText(/server record is now the source of truth/i),
    ).toBeVisible();

    const firstCall = fetchMock.mock.calls.at(0);
    if (!firstCall) throw new Error("Account update was not captured.");
    await expect(
      (firstCall[0] as Request).clone().json(),
    ).resolves.toMatchObject({
      id: routeContext.accountId,
      accountId: routeContext.accountId,
      expectedVersion: 7,
    });
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
    expect(screen.getByText(/binds to the order id/i)).toBeVisible();

    const submit = screen.getByRole("button", { name: "Submit securely" });
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
    expect(
      screen.getByRole("button", { name: "Submit securely" }),
    ).toBeEnabled();
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
    await user.click(screen.getByRole("button", { name: "Submit securely" }));
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.queryByText(/Development simulation accepted/i)).toBeNull();
    expect(
      screen.queryByText(/server record is now the source of truth/i),
    ).toBeNull();
  });
});
