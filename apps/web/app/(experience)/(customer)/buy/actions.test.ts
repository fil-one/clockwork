import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCommerceSession: vi.fn(),
  loadPreparedQuoteArtifact: vi.fn(),
  loadBuyQuoteProjection: vi.fn(),
}));

vi.mock("@/src/auth/session", () => ({
  getCommerceSession: mocks.getCommerceSession,
}));
vi.mock("@/src/features/experience-server/portal-view-loader", () => ({
  loadPreparedQuoteArtifact: mocks.loadPreparedQuoteArtifact,
  loadBuyQuoteProjection: mocks.loadBuyQuoteProjection,
}));

import {
  lookupBuyQuoteProjection,
  lookupPreparedQuoteArtifact,
} from "./actions";

const quoteId = "60000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCommerceSession.mockResolvedValue({ roles: ["owner"] });
  mocks.loadPreparedQuoteArtifact.mockResolvedValue({ status: "pending" });
  mocks.loadBuyQuoteProjection.mockResolvedValue({ status: "pending" });
});

describe("Buy server lookups", () => {
  it("rechecks quote-write permission before reading either bridge", async () => {
    await expect(lookupPreparedQuoteArtifact(quoteId)).resolves.toEqual({
      status: "pending",
    });
    await expect(lookupBuyQuoteProjection(quoteId)).resolves.toEqual({
      status: "pending",
    });
    expect(mocks.getCommerceSession).toHaveBeenCalledTimes(2);
  });

  it("refuses malformed identifiers before a loader runs", async () => {
    await expect(lookupPreparedQuoteArtifact("quote-1")).resolves.toEqual({
      status: "unavailable",
    });
    await expect(lookupBuyQuoteProjection("quote-1")).resolves.toEqual({
      status: "unavailable",
    });
    expect(mocks.getCommerceSession).not.toHaveBeenCalled();
  });

  it("returns forbidden when the fresh session cannot write quotes", async () => {
    mocks.getCommerceSession.mockResolvedValue({ roles: ["member"] });

    await expect(lookupPreparedQuoteArtifact(quoteId)).resolves.toEqual({
      status: "forbidden",
    });
    await expect(lookupBuyQuoteProjection(quoteId)).resolves.toEqual({
      status: "forbidden",
    });
    expect(mocks.loadPreparedQuoteArtifact).not.toHaveBeenCalled();
    expect(mocks.loadBuyQuoteProjection).not.toHaveBeenCalled();
  });
});
