import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CustomerCollection } from "./customer-collection";
import { customerCollections } from "./customer-data";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

const formatting = { locale: "en-US", timeZone: "America/New_York" };

/**
 * The loader has always returned `stale` and `generatedAt`; the routes passed
 * neither, so a customer read rows that could be behind their source with
 * nothing saying so, while an operator on `/internal/queues` was told. These
 * fail against the unfixed component, which has no way to be told at all.
 */
describe("customer collection freshness disclosure", () => {
  it("raises the stale read to the reader with a way to resolve it", () => {
    render(
      <CustomerCollection
        config={customerCollections.amendments}
        formatting={formatting}
        freshness={{
          generatedAt: "2026-08-14T13:04:00Z",
          partial: false,
          stale: true,
        }}
        searchParams={{}}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "These records may be out of date.",
    );
    expect(
      screen.getByRole("button", { name: "Refresh records" }),
    ).toBeVisible();
  });

  it("states the read is current, and when it was taken, when it is", () => {
    render(
      <CustomerCollection
        config={customerCollections.amendments}
        formatting={formatting}
        freshness={{
          generatedAt: "2026-08-14T13:04:00Z",
          partial: false,
          stale: false,
        }}
        searchParams={{}}
      />,
    );

    expect(screen.queryByRole("alert")).toBeNull();
    const status = screen
      .getAllByRole("status")
      .find((node) => node.textContent?.includes("Records are current"));
    expect(status).toBeDefined();
    expect(status).toHaveTextContent("EDT");
  });
});
