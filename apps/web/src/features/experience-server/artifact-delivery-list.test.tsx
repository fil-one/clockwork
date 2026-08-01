import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ArtifactDeliveryList } from "./artifact-delivery-list";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("artifact delivery states", () => {
  it("loads the generated-client representation before exposing download", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          Response.json({
            id: "70000000-0000-4000-8000-000000000001",
            kind: "order_form",
            subjectType: "order",
            subjectId: "80000000-0000-4000-8000-000000000001",
            accountId: "10000000-0000-4000-8000-000000000001",
            audience: "customer",
            audienceAccountId: "10000000-0000-4000-8000-000000000001",
            documentId: "90000000-0000-4000-8000-000000000001",
            version: "3",
            sourceHash: "a".repeat(64),
            contentHash: "b".repeat(64),
            mimeType: "application/pdf",
            byteLength: "2048",
            filename: "order-form.pdf",
            retainUntil: "2033-07-31T12:00:00.000Z",
            createdAt: "2026-07-31T12:00:00.000Z",
            downloadHref:
              "/api/experience/artifacts/order_form/70000000-0000-4000-8000-000000000001",
          }),
        ),
      ),
    );
    render(
      <ArtifactDeliveryList
        artifacts={[
          {
            id: "70000000-0000-4000-8000-000000000001",
            kind: "order_form",
            label: "Accepted order form",
            state: "stored",
          },
        ]}
      />,
    );
    expect(
      await screen.findByRole("link", { name: "Download verified PDF" }),
    ).toHaveAttribute(
      "href",
      "/api/experience/artifacts/order_form/70000000-0000-4000-8000-000000000001",
    );
    expect(screen.getByText(/order-form.pdf · version 3/)).toBeVisible();
  });

  it("renders pending and missing states without making a download request", () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    render(
      <ArtifactDeliveryList
        artifacts={[
          {
            id: "70000000-0000-4000-8000-000000000002",
            kind: "receipt",
            label: "Receipt",
            state: "pending",
          },
          {
            id: "70000000-0000-4000-8000-000000000003",
            kind: "report_export",
            label: "Report",
            state: "missing",
          },
        ]}
      />,
    );
    expect(screen.getByText("Generation pending")).toBeVisible();
    expect(screen.getByText("Document missing")).toHaveAttribute(
      "role",
      "alert",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when representation access is denied or corrupt", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          Response.json(
            { code: "ARTIFACT_NOT_FOUND", title: "Artifact not found" },
            { status: 404 },
          ),
        ),
      ),
    );
    render(
      <ArtifactDeliveryList
        artifacts={[
          {
            id: "70000000-0000-4000-8000-000000000004",
            kind: "receipt",
            label: "Receipt",
            state: "stored",
          },
        ]}
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Artifact not found",
    );
    expect(
      screen.queryByRole("link", { name: "Download verified PDF" }),
    ).not.toBeInTheDocument();
  });
});
