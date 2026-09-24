import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CustomerCollection } from "./customer-collection";
import { customerCollections } from "./customer-data";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

const formatting = { locale: "en-US", timeZone: "America/New_York" };
const fresh = {
  generatedAt: "2026-08-14T13:04:00Z",
  partial: false,
  stale: false,
};

describe("customer collection truth copy", () => {
  it("renders its configured purpose and rule after the results", () => {
    render(
      <CustomerCollection
        config={{ ...customerCollections.procurement, records: [] }}
        formatting={formatting}
        freshness={fresh}
        searchParams={{}}
      />,
    );

    expect(
      screen.getByText("Customer workspace · Purchasing readiness"),
    ).toBeVisible();
    const results = screen.getByRole("region", { name: /results/i });
    const rule = screen.getByText(
      "A tax exemption suppresses tax only while it is valid for the applicable jurisdiction.",
    );
    expect(results.compareDocumentPosition(rule)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
});
