import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { styles } from "@/src/features/internal-ops/administration-safety/ui";

const capability = (key: string, enabled: boolean) => ({
  capabilityKey: key,
  enabled,
  recoveryEnabled: true,
  rowVersion: 3,
  changedBy: "ops@filone.test",
  changeReason: "Reviewed.",
});

vi.mock("@clockwork/db", () => ({
  DatabaseSystemCapabilityAdmin: class {
    list() {
      return Promise.resolve([
        capability("billing", true),
        capability("teardown", false),
      ]);
    }
  },
  capabilityApprovalRole: () => "finance_approver",
}));
vi.mock("@/src/auth/session", () => ({
  getCommerceSession: () =>
    Promise.resolve({
      isInternalStaff: true,
      providerBacked: true,
      roles: ["internal_operator"],
    }),
}));
vi.mock("@/src/db/service", () => ({ getOptionalServiceDatabase: () => ({}) }));
vi.mock("./controls", () => ({ CapabilityControls: () => null }));

import Page from "./page";

/**
 * Every capability chip was amber, so a capability taking new work looked
 * like a warning. The colour now follows whether it is enabled.
 */
it("colours an enabled capability as success and a disabled one as a warning", async () => {
  render(await Page());
  expect(screen.getByText("New work enabled")).toHaveClass(
    styles.success ?? "",
  );
  expect(screen.getByText("New work disabled")).toHaveClass(
    styles.warning ?? "",
  );
});
