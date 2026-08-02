import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkflowPanel } from "./workflow-panel";

const csrfToken = "12345678901234567890123456789012";

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
    render(<WorkflowPanel workflow="quote" surface="quoteBuilder" />);
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
    render(<WorkflowPanel workflow="quote" surface="quoteBuilder" />);

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
    render(<WorkflowPanel workflow="quote" surface="quoteBuilder" />);

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
    render(<WorkflowPanel workflow="payment" surface="billing" />);
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
      accountId: "11111111-1111-4111-8111-111111111111",
      invoiceId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
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
    render(<WorkflowPanel workflow="assisted" surface="assisted" />);

    expect(screen.getByText(/server—not this form—records/i)).toBeVisible();
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
      accountId: "11111111-1111-4111-8111-111111111111",
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
    render(<WorkflowPanel workflow="agreement" surface="agreementExecution" />);

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
    render(<WorkflowPanel workflow="renewal" surface="services" />);

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
    render(<WorkflowPanel workflow="reports" surface="reports" />);

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
