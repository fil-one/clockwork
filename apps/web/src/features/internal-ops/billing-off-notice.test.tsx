import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const billing = vi.hoisted(() => ({ enabled: false }));

vi.mock("@/src/features/shell/route-session", () => ({
  getRouteSession: () => Promise.resolve({ providerBacked: true }),
}));
vi.mock("./capability-state", () => ({
  getCapabilityState: () =>
    Promise.resolve({
      isEnabled: (key: string) => key !== "billing" || billing.enabled,
      isRecoveryEnabled: () => true,
    }),
}));

import { BillingOffNotice } from "./billing-off-notice";

beforeEach(() => {
  billing.enabled = false;
});

describe("BillingOffNotice", () => {
  it("says billing and provisioning are off, and where to switch them", async () => {
    render(await BillingOffNotice());

    const note = screen.getByRole("note");
    expect(note).toHaveTextContent("Billing and provisioning are switched off");
    expect(note).toHaveTextContent(
      "New invoices are not issued and no new service is started while billing is off.",
    );
    expect(
      screen.getByRole("link", { name: "Review capability switches" }),
    ).toHaveAttribute("href", "/internal/capabilities");
  });

  it("says nothing once billing is on", async () => {
    billing.enabled = true;
    expect(await BillingOffNotice()).toBeNull();
  });
});
