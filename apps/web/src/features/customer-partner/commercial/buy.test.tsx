import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as CommerceClient from "@/src/features/contracts/commerce-client";

type SendCoreCommand = (
  input: CommerceClient.CoreCommandInput,
  options: CommerceClient.CommerceClientOptions,
) => Promise<unknown>;

const mocks = vi.hoisted(() => ({
  fetch: vi.fn<typeof fetch>(),
  sendCoreCommand: vi.fn<SendCoreCommand>(),
}));

vi.mock("@/src/features/contracts/commerce-client", async () => {
  const actual = await vi.importActual<typeof CommerceClient>(
    "@/src/features/contracts/commerce-client",
  );
  return { ...actual, sendCoreCommand: mocks.sendCoreCommand };
});

import { SelfServeBuy } from "./buy";
import { authoritativeQuoteOffers } from "./quote-offer.test-fixture";

const account = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "Northstar Archive Labs",
};
const artifactRequestId = "80000000-0000-4000-8000-000000000002";
const documentId = "80000000-0000-4000-8000-000000000001";

function renderBuy(input?: {
  catalogueMode?: "authoritative" | "simulated";
  mode?: "authoritative" | "demo";
  pollAttempts?: number;
}) {
  return render(
    <SelfServeBuy
      account={account}
      catalogueMode={input?.catalogueMode ?? "authoritative"}
      mode={input?.mode ?? "authoritative"}
      offers={authoritativeQuoteOffers}
      pollAttempts={input?.pollAttempts ?? 1}
      pollIntervalMs={0}
    />,
  );
}

function pricedDraft(marginFloorResult = "pass") {
  return {
    record: {
      rowVersion: 1,
      data: { totalMinor: "120000", currency: "USD", marginFloorResult },
    },
  };
}

function preparedResponse(value: unknown = artifactRequestId) {
  return {
    record: { data: { artifactRequest: { requestId: value } } },
  };
}

function currentQuoteId(): string {
  const call = mocks.sendCoreCommand.mock.calls.find(
    ([command]) => command.action === "create",
  );
  if (!call) throw new Error("The create command was not sent");
  return call[0].id;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function storedArtifact(overrides: Record<string, unknown> = {}): Response {
  return json({
    id: artifactRequestId,
    kind: "direct_quote",
    subjectType: "quote",
    subjectId: currentQuoteId(),
    accountId: account.id,
    documentId,
    ...overrides,
  });
}

function issuedProjection(overrides: Record<string, unknown> = {}): Response {
  const quoteId = currentQuoteId();
  return json({
    recordKey: `quote-${quoteId}`,
    aggregateType: "quote",
    aggregateId: quoteId,
    accountId: account.id,
    audience: "customer",
    channel: "quotes",
    stale: false,
    version: 2,
    data: { authoritative: { status: "issued" } },
    ...overrides,
  });
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  return typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
}

function serveStoredArtifactAndIssuedProjection() {
  mocks.fetch.mockImplementation((input) => {
    const url = requestUrl(input);
    return Promise.resolve(
      url.includes("/artifacts/direct_quote/")
        ? storedArtifact()
        : issuedProjection(),
    );
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.fetch.mockReset();
  mocks.sendCoreCommand.mockReset();
  mocks.sendCoreCommand.mockImplementation((command) =>
    Promise.resolve(
      command.action === "create"
        ? pricedDraft()
        : command.action === "prepare_artifact"
          ? preparedResponse()
          : {},
    ),
  );
  serveStoredArtifactAndIssuedProjection();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function buy(capacity = "42") {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Committed capacity (TB)"), capacity);
  await user.click(
    screen.getByRole("button", { name: "Price and prepare quote" }),
  );
}

describe("self-serve Buy", () => {
  it("routes the 100 TB boundary without sending a command", async () => {
    const user = userEvent.setup();
    renderBuy();

    await user.type(screen.getByLabelText("Committed capacity (TB)"), "100");

    expect(
      screen.getByText(/routing choice, not a pricing rule/u),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Continue in a quote" }),
    ).toHaveAttribute("href", "/quotes/new?capacity=100&term=12");
    expect(mocks.sendCoreCommand).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("binds bodyless artifact and projection GETs before the handoff", async () => {
    let projectionReads = 0;
    mocks.fetch.mockImplementation((input) => {
      const url = requestUrl(input);
      if (url.includes("/artifacts/direct_quote/"))
        return Promise.resolve(storedArtifact());
      projectionReads += 1;
      return Promise.resolve(
        projectionReads === 1
          ? new Response(null, { status: 404 })
          : issuedProjection(),
      );
    });
    renderBuy({ pollAttempts: 2 });

    await buy();

    const calls = mocks.sendCoreCommand.mock.calls;
    expect(calls.map(([command]) => command.action)).toEqual([
      "create",
      "prepare_artifact",
      "issue",
    ]);
    expect(calls[0]?.[0].payload).toMatchObject({
      route: "direct",
      lines: [{ quantity: "42", termMonths: 12 }],
    });
    expect(calls[0]?.[0].payload).not.toHaveProperty("partnerAccountId");
    expect(calls[1]?.[0]).toMatchObject({
      expectedVersion: 1,
      payload: { audience: "end_client" },
    });
    expect(calls[2]?.[0]).toMatchObject({
      expectedVersion: 1,
      payload: { renderedDocumentId: documentId },
    });
    expect(calls[1]?.[0].payload.issuedAt).toBe(
      calls[2]?.[0].payload.artifactIssuedAt,
    );
    expect(
      new Set(calls.map(([, options]) => options.idempotencyKey)).size,
    ).toBe(3);
    const quoteId = currentQuoteId();
    expect(mocks.fetch).toHaveBeenCalledWith(
      `/api/experience/artifacts/direct_quote/${artifactRequestId}?representation=json`,
      {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        headers: { accept: "application/json" },
      },
    );
    expect(mocks.fetch).toHaveBeenCalledWith(
      `/api/experience/projections/customer/quotes/quote-${quoteId}`,
      {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        headers: { accept: "application/json" },
      },
    );
    expect(projectionReads).toBe(2);
    expect(
      screen.getByRole("link", { name: "Review and accept order" }),
    ).toBeVisible();
    expect(screen.getByText("$1,200.00 total / 12 months")).toBeVisible();
  });

  it("withholds acceptance until projection confirmation and reuses each pass key", async () => {
    let projectionReads = 0;
    mocks.fetch.mockImplementation((input) => {
      if (requestUrl(input).includes("/artifacts/direct_quote/"))
        return Promise.resolve(storedArtifact());
      projectionReads += 1;
      return Promise.resolve(
        projectionReads === 1
          ? new Response(null, { status: 404 })
          : issuedProjection(),
      );
    });
    renderBuy();

    await buy();
    expect(
      screen.queryByRole("link", { name: "Review and accept order" }),
    ).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "not in the customer ledger yet",
    );

    const firstKeys = mocks.sendCoreCommand.mock.calls.map(
      ([, options]) => options.idempotencyKey,
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Try again" }));
    const retryKeys = mocks.sendCoreCommand.mock.calls
      .slice(3)
      .map(([, options]) => options.idempotencyKey);
    expect(retryKeys).toEqual(firstKeys);
    expect(
      screen.getByRole("link", { name: "Review and accept order" }),
    ).toBeVisible();
  });

  it.each([
    { record: { data: { artifactRequest: {} } } },
    preparedResponse("../legacy-action"),
  ])(
    "refuses a missing or malformed prepare artifact request id",
    async (response) => {
      mocks.sendCoreCommand.mockImplementation((command) =>
        Promise.resolve(
          command.action === "create"
            ? pricedDraft()
            : command.action === "prepare_artifact"
              ? response
              : {},
        ),
      );
      renderBuy();

      await buy();

      expect(mocks.fetch).not.toHaveBeenCalled();
      expect(
        mocks.sendCoreCommand.mock.calls.map(([command]) => command.action),
      ).toEqual(["create", "prepare_artifact"]);
      expect(screen.getByRole("alert")).toHaveTextContent(
        "request could not be verified",
      );
    },
  );

  it.each([
    ["kind", { kind: "invoice" }],
    ["subject type", { subjectType: "order" }],
    ["request id", { id: "80000000-0000-4000-8000-000000000099" }],
    ["quote id", { subjectId: "60000000-0000-4000-8000-000000000099" }],
    ["account", { accountId: "10000000-0000-4000-8000-000000000099" }],
    ["document id", { documentId: "not-a-uuid" }],
  ])("refuses an artifact with a mismatched %s", async (_, mismatch) => {
    mocks.fetch.mockImplementation(() =>
      Promise.resolve(storedArtifact(mismatch)),
    );
    renderBuy();

    await buy();

    expect(
      mocks.sendCoreCommand.mock.calls.map(([command]) => command.action),
    ).toEqual(["create", "prepare_artifact"]);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "cannot confirm that the quote document was stored",
    );
  });

  it.each([
    ["record key", { recordKey: "quote-other" }],
    ["aggregate type", { aggregateType: "order" }],
    ["aggregate id", { aggregateId: "60000000-0000-4000-8000-000000000099" }],
    ["account", { accountId: "10000000-0000-4000-8000-000000000099" }],
    ["audience", { audience: "partner" }],
    ["channel", { channel: "orders" }],
    ["freshness", { stale: true }],
  ])("refuses a projection with a mismatched %s", async (_, mismatch) => {
    mocks.fetch.mockImplementation((input) =>
      Promise.resolve(
        requestUrl(input).includes("/artifacts/direct_quote/")
          ? storedArtifact()
          : issuedProjection(mismatch),
      ),
    );
    renderBuy();

    await buy();

    expect(
      mocks.sendCoreCommand.mock.calls.map(([command]) => command.action),
    ).toEqual(["create", "prepare_artifact", "issue"]);
    expect(
      screen.queryByRole("link", { name: "Review and accept order" }),
    ).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "cannot confirm the new quote",
    );
  });

  it("retries a transient bodyless read within the bounded poll", async () => {
    let reads = 0;
    mocks.fetch.mockImplementation((input) => {
      if (requestUrl(input).includes("/artifacts/direct_quote/")) {
        reads += 1;
        return reads === 1
          ? Promise.reject(new Error("network"))
          : Promise.resolve(storedArtifact());
      }
      return Promise.resolve(issuedProjection());
    });
    renderBuy({ pollAttempts: 2 });

    await buy();

    expect(reads).toBe(2);
    expect(
      screen.getByRole("link", { name: "Review and accept order" }),
    ).toBeVisible();
  });

  it.each([401, 403])(
    "stops on an artifact authorization %s",
    async (status) => {
      mocks.fetch.mockResolvedValue(new Response(null, { status }));
      renderBuy({ pollAttempts: 2 });

      await buy();

      expect(mocks.fetch).toHaveBeenCalledOnce();
      expect(screen.getByRole("alert")).toHaveTextContent(
        "session can no longer prepare this quote",
      );
    },
  );

  it("stops when projection lookup is unavailable", async () => {
    mocks.fetch.mockImplementation((input) =>
      Promise.resolve(
        requestUrl(input).includes("/artifacts/direct_quote/")
          ? storedArtifact()
          : new Response(null, { status: 503 }),
      ),
    );
    renderBuy({ pollAttempts: 2 });

    await buy();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "cannot confirm the new quote",
    );
  });

  it("stops the server-computed demo path after the simulated draft", async () => {
    renderBuy({ catalogueMode: "simulated", mode: "demo" });

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Committed capacity (TB)"), "42");
    await user.click(screen.getByRole("button", { name: "Simulate draft" }));

    expect(mocks.sendCoreCommand).toHaveBeenCalledTimes(1);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(
      screen.getByText(/did not save, price, or issue a quote/u),
    ).toBeVisible();
  });

  it("keeps a server pricing exception as a saved draft", async () => {
    mocks.sendCoreCommand.mockResolvedValueOnce(
      pricedDraft("exception_required"),
    );
    renderBuy();

    await buy();

    expect(mocks.sendCoreCommand).toHaveBeenCalledTimes(1);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "needs pricing review",
    );
  });
});
