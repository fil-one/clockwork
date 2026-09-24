import type { sendCoreCommand } from "@/src/features/contracts/commerce-client";
import type * as issuanceClient from "./quote-issuance-client";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  command:
    vi.fn<(...args: Parameters<typeof sendCoreCommand>) => Promise<unknown>>(),
  projection: vi.fn(),
  artifact: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("@/src/features/contracts/commerce-client", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendCoreCommand: mocks.command,
}));
vi.mock("./quote-issuance-client", async (importOriginal) => ({
  ...(await importOriginal<typeof issuanceClient>()),
  readBuyQuoteProjection: mocks.projection,
  readPreparedQuoteArtifact: mocks.artifact,
}));
import { QuoteIssue } from "./quote-issue";

const quoteId = "10000000-0000-4000-8000-000000000001";
const accountId = "10000000-0000-4000-8000-000000000002";
const requestId = "10000000-0000-4000-8000-000000000003";
const documentId = "10000000-0000-4000-8000-000000000004";
const draft = {
  status: "found",
  quoteStatus: "draft",
  rowVersion: 4,
  marginResult: "pass",
};
const issued = { ...draft, quoteStatus: "issued", rowVersion: 5 };
function setup() {
  render(
    <QuoteIssue
      accountId={accountId}
      quoteId={quoteId}
      recordKey={`quote-${quoteId}`}
      pollAttempts={1}
      pollIntervalMs={0}
    />,
  );
  return userEvent.setup();
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.projection.mockResolvedValueOnce(draft).mockResolvedValue(issued);
  mocks.command.mockImplementation((command) =>
    Promise.resolve(
      command.action === "prepare_artifact"
        ? { record: { data: { artifactRequest: { requestId } } } }
        : {},
    ),
  );
  mocks.artifact.mockResolvedValue({
    status: "stored",
    documentId,
    artifactId: requestId,
  });
});
describe("continuing a saved customer quote", () => {
  it("prepares and issues the same saved draft using its current row version", async () => {
    const user = setup();
    await user.click(
      screen.getByRole("button", { name: "Prepare and issue quote" }),
    );
    expect(
      await screen.findByRole("link", { name: "Review and accept order" }),
    ).toHaveAttribute("href", `/orders/accept?quote=quote-${quoteId}`);
    expect(mocks.command.mock.calls.map(([command]) => command.action)).toEqual(
      ["prepare_artifact", "issue"],
    );
    expect(mocks.command.mock.calls[1]?.[0]).toMatchObject({
      id: quoteId,
      accountId,
      expectedVersion: 4,
      payload: { renderedDocumentId: documentId },
    });
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  it("reuses the preparation request when rendering is delayed", async () => {
    mocks.projection
      .mockReset()
      .mockResolvedValueOnce(draft)
      .mockResolvedValueOnce(draft)
      .mockResolvedValue(issued);
    mocks.artifact.mockResolvedValueOnce({ status: "pending" });
    const user = setup();
    await user.click(
      screen.getByRole("button", { name: "Prepare and issue quote" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "still being prepared",
    );
    expect(mocks.command).toHaveBeenCalledTimes(1);
    await user.click(
      screen.getByRole("button", { name: "Continue this quote" }),
    );
    await screen.findByRole("link", { name: "Review and accept order" });
    expect(mocks.command.mock.calls[0]).toEqual(mocks.command.mock.calls[1]);
  });
  it("does not reissue after an uncertain response when the saved quote is already issued", async () => {
    mocks.command.mockImplementation((command) => {
      if (command.action === "issue")
        return Promise.reject(
          new Error("Connection interrupted. Check again."),
        );
      return Promise.resolve({
        record: { data: { artifactRequestId: requestId } },
      });
    });
    const user = setup();
    await user.click(
      screen.getByRole("button", { name: "Prepare and issue quote" }),
    );
    await screen.findByRole("alert");
    await user.click(
      screen.getByRole("button", { name: "Continue this quote" }),
    );
    await screen.findByRole("link", { name: "Review and accept order" });
    expect(mocks.command).toHaveBeenCalledTimes(2);
  });
  it.each([
    { status: "forbidden" },
    { status: "unavailable" },
    { ...draft, quoteStatus: "expired" },
    { ...draft, marginResult: "exception_required" },
  ])(
    "refuses mutation for an ineligible current record: %j",
    async (current) => {
      mocks.projection.mockReset().mockResolvedValue(current);
      const user = setup();
      await user.click(
        screen.getByRole("button", { name: "Prepare and issue quote" }),
      );
      await screen.findByRole("alert");
      expect(mocks.command).not.toHaveBeenCalled();
      expect(
        screen.queryByRole("link", { name: "Review and accept order" }),
      ).toBeNull();
    },
  );
  it("refuses a changed version after a retry rather than issuing a different revision", async () => {
    mocks.projection
      .mockReset()
      .mockResolvedValueOnce(draft)
      .mockResolvedValue({ ...draft, rowVersion: 6 });
    mocks.artifact.mockResolvedValue({ status: "pending" });
    const user = setup();
    await user.click(
      screen.getByRole("button", { name: "Prepare and issue quote" }),
    );
    await screen.findByRole("alert");
    await user.click(
      screen.getByRole("button", { name: "Continue this quote" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Refresh this page",
    );
    expect(mocks.command).toHaveBeenCalledTimes(1);
  });
});
