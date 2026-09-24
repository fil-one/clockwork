import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CustomerCollection } from "./customer-collection";
import { resolveDemoText } from "@clockwork/testing/demo-localized-text";

import { customerCollections } from "./customer-data";
import styles from "./customer-collection.module.css";

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

describe("customer collection values", () => {
  /**
   * A record's value is a fact -- an amount, an address, a reference -- and
   * table cells hyphenate in de/fr/es/pt. The value sits in a <bdi>, which the
   * stylesheet never hyphenates, and which keeps its own direction in Arabic.
   */
  it("sets each record's value apart from the surrounding prose", () => {
    const { container } = render(
      <CustomerCollection
        config={resolveDemoText(customerCollections.procurement, "en")}
        formatting={formatting}
        freshness={fresh}
        searchParams={{}}
      />,
    );
    const values = container.querySelectorAll(`strong.${styles.value}`);
    expect(values.length).toBeGreaterThan(0);
    for (const value of values)
      expect(value.firstElementChild?.tagName).toBe("BDI");
  });
});
