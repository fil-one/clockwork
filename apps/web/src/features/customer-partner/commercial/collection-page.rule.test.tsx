import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CommercialCollectionPage } from "./collection-page";

const fresh = {
  generatedAt: "2026-08-14T13:00:00Z",
  partial: false,
  stale: false,
};
const formatting = { locale: "en-US", timeZone: "America/New_York" };

describe("commercial collection truth copy", () => {
  it("renders the configured purpose and rule after quote results", () => {
    render(
      <CommercialCollectionPage
        formatting={formatting}
        freshness={fresh}
        kind="quotes"
        records={[]}
        searchParams={{}}
      />,
    );

    expect(
      screen.getByText("Customer workspace · Price and expiry"),
    ).toBeVisible();
    const results = screen.getByRole("region", { name: "0 results" });
    const rule = screen.getByText(
      "Issued quote versions never mutate; a commercial change requires a revised quote.",
    );
    expect(results.compareDocumentPosition(rule)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
});
