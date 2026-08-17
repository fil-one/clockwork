import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as CommerceClient from "@/src/features/contracts/commerce-client";

type SendCoreCommand = (
  input: CommerceClient.CoreCommandInput,
  options: CommerceClient.CommerceClientOptions,
) => Promise<unknown>;

const mocks = vi.hoisted(() => ({
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
import type {
  LookupBuyQuoteProjection,
  LookupPreparedQuoteArtifact,
} from "./prepared-quote-artifact";

const account = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "Northstar Archive Labs",
};

function renderBuy(input?: {
  catalogueMode?: "authoritative" | "simulated";
  mode?: "authoritative" | "demo";
  lookupArtifact?: LookupPreparedQuoteArtifact;
  lookupProjection?: LookupBuyQuoteProjection;
}) {
  return render(
    <SelfServeBuy
      account={account}
      catalogueMode={input?.catalogueMode ?? "authoritative"}
      lookupArtifact={
        input?.lookupArtifact ??
        (vi.fn().mockResolvedValue({
          status: "stored",
          documentId: "80000000-0000-4000-8000-000000000001",
          artifactId: "80000000-0000-4000-8000-000000000002",
        }) as LookupPreparedQuoteArtifact)
      }
      lookupProjection={
        input?.lookupProjection ??
        (vi.fn().mockResolvedValue({
          status: "found",
          quoteStatus: "issued",
          rowVersion: 2,
        }) as LookupBuyQuoteProjection)
      }
      mode={input?.mode ?? "authoritative"}
      offers={authoritativeQuoteOffers}
      pollAttempts={1}
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

beforeEach(() => {
  mocks.sendCoreCommand.mockReset();
  mocks.sendCoreCommand.mockResolvedValue(pricedDraft());
});

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
  });

  it("binds the prepared document and waits for the exact issued projection", async () => {
    const user = userEvent.setup();
    const lookupProjection = vi
      .fn<LookupBuyQuoteProjection>()
      .mockResolvedValueOnce({ status: "pending" })
      .mockResolvedValueOnce({
        status: "found",
        quoteStatus: "issued",
        rowVersion: 2,
      });
    render(
      <SelfServeBuy
        account={account}
        catalogueMode="authoritative"
        lookupArtifact={vi.fn().mockResolvedValue({
          status: "stored",
          documentId: "80000000-0000-4000-8000-000000000001",
          artifactId: "80000000-0000-4000-8000-000000000002",
        })}
        lookupProjection={lookupProjection}
        mode="authoritative"
        offers={authoritativeQuoteOffers}
        pollAttempts={2}
        pollIntervalMs={0}
      />,
    );

    await user.type(screen.getByLabelText("Committed capacity (TB)"), "42");
    await user.click(
      screen.getByRole("button", { name: "Price and prepare quote" }),
    );

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
      payload: {
        renderedDocumentId: "80000000-0000-4000-8000-000000000001",
      },
    });
    expect(calls[1]?.[0].payload.issuedAt).toBe(
      calls[2]?.[0].payload.artifactIssuedAt,
    );
    expect(calls.map(([, options]) => options.idempotencyKey)).toHaveLength(3);
    expect(
      new Set(calls.map(([, options]) => options.idempotencyKey)).size,
    ).toBe(3);
    expect(lookupProjection).toHaveBeenCalledTimes(2);
    expect(
      screen.getByRole("link", { name: "Review and accept order" }),
    ).toHaveAttribute(
      "href",
      expect.stringMatching(/^\/orders\/accept\?quote=quote-/u),
    );
    expect(screen.getByText("$1,200.00 total / 12 months")).toBeVisible();
  });

  it("withholds acceptance until projection confirmation and reuses each pass key", async () => {
    const user = userEvent.setup();
    const lookupProjection = vi
      .fn<LookupBuyQuoteProjection>()
      .mockResolvedValueOnce({ status: "pending" })
      .mockResolvedValueOnce({
        status: "found",
        quoteStatus: "issued",
        rowVersion: 2,
      });
    renderBuy({ lookupProjection });

    await user.type(screen.getByLabelText("Committed capacity (TB)"), "42");
    await user.click(
      screen.getByRole("button", { name: "Price and prepare quote" }),
    );
    expect(
      screen.queryByRole("link", { name: "Review and accept order" }),
    ).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "not in the customer ledger yet",
    );

    const firstKeys = mocks.sendCoreCommand.mock.calls.map(
      ([, options]) => options.idempotencyKey,
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));
    const retryKeys = mocks.sendCoreCommand.mock.calls
      .slice(3)
      .map(([, options]) => options.idempotencyKey);
    expect(retryKeys).toEqual(firstKeys);
    expect(
      screen.getByRole("link", { name: "Review and accept order" }),
    ).toBeVisible();
  });

  it("stops the server-computed demo path after the simulated draft", async () => {
    const user = userEvent.setup();
    const lookupArtifact = vi.fn<LookupPreparedQuoteArtifact>();
    const lookupProjection = vi.fn<LookupBuyQuoteProjection>();
    renderBuy({
      catalogueMode: "simulated",
      mode: "demo",
      lookupArtifact,
      lookupProjection,
    });

    await user.type(screen.getByLabelText("Committed capacity (TB)"), "42");
    await user.click(screen.getByRole("button", { name: "Simulate draft" }));

    expect(mocks.sendCoreCommand).toHaveBeenCalledTimes(1);
    expect(lookupArtifact).not.toHaveBeenCalled();
    expect(lookupProjection).not.toHaveBeenCalled();
    expect(
      screen.getByText(/did not save, price, or issue a quote/u),
    ).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Review and accept order" }),
    ).toBeNull();
  });

  it("keeps a server pricing exception as a saved draft", async () => {
    const user = userEvent.setup();
    mocks.sendCoreCommand.mockResolvedValueOnce(
      pricedDraft("exception_required"),
    );
    renderBuy();

    await user.type(screen.getByLabelText("Committed capacity (TB)"), "42");
    await user.click(
      screen.getByRole("button", { name: "Price and prepare quote" }),
    );

    expect(mocks.sendCoreCommand).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent(
      "needs pricing review",
    );
    expect(
      screen.getByRole("link", { name: "Open priced draft" }),
    ).toHaveAttribute("href", expect.stringMatching(/^\/quotes\/quote-/u));
  });
});
