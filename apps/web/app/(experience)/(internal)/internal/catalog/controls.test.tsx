import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { catalogs } from "@/src/i18n/catalogs";
import { setHarnessLanguage } from "@/src/i18n/client";

const mocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("./actions", () => ({ saveCatalogMapping: mocks.save }));

import { CatalogMappingControls } from "./controls";

type Row = Parameters<typeof CatalogMappingControls>[0]["row"];
const row = {
  rateCardId: "00000000-0000-4000-8000-000000000001",
  rowVersion: 2,
  sku: "LOCKED-STORAGE-TB",
  region: "us-east-2",
  unit: "TB-month",
  approvedClaim: "Immutable storage capacity",
  bookName: "Direct commerce USD",
  bookId: "66000000-0000-4000-8000-000000000001",
  bookVersion: 3,
  status: "draft",
  mapping: {
    providerSku: "object",
    providerRegion: "fr",
    meterId: "byte_hours",
    sourceEvidence: "evidence:mapping",
  },
  editable: true,
} as unknown as Row;

afterEach(() => setHarnessLanguage("en", catalogs.en));

describe("catalog mapping form", () => {
  // Staff screens are English whatever the reader's language.
  it("words the form and the saved result for a Portuguese reader", async () => {
    setHarnessLanguage("pt", catalogs.pt);
    mocks.save.mockResolvedValue("saved");
    const user = userEvent.setup();
    render(<CatalogMappingControls row={row} />);
    expect(screen.getByText("Draft provider mapping")).toBeVisible();
    await user.type(
      screen.getByLabelText("Reason for change"),
      "Referência confirmada",
    );
    await user.click(
      screen.getByRole("button", { name: "Save draft mapping" }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Draft mapping saved. Provider qualification and price-book approval remain required.",
    );
  });

  it("reports the authority rule, not a success, when the action refuses", async () => {
    mocks.save.mockResolvedValue("forbidden");
    const user = userEvent.setup();
    render(<CatalogMappingControls row={row} />);
    await user.type(
      screen.getByLabelText("Reason for change"),
      "Confirmed ref",
    );
    await user.click(
      screen.getByRole("button", { name: "Save draft mapping" }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Mapping changes require a directly authenticated operator or finance approver with recent MFA.",
    );
  });
});
