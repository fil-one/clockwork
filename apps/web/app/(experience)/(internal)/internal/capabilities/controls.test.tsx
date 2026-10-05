import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("./actions", () => ({ changeCapability: vi.fn() }));

import { CapabilityControls } from "./controls";

afterEach(() => {
  process.env.TZ = "UTC";
});

it("states when a capability change was requested in the reader's zone", () => {
  process.env.TZ = "America/Los_Angeles";
  render(
    <CapabilityControls
      canOperate
      canApprove
      capability={
        {
          capabilityKey: "billing",
          enabled: false,
          recoveryEnabled: false,
          rowVersion: 3,
          changedBy: "operator@filone.test",
          reason: "Billing stays off until launch.",
          updatedAt: new Date("2026-10-01T16:00:00.000Z"),
          pending: {
            id: "70000000-0000-4000-8000-000000000001",
            capabilityKey: "billing",
            baseVersion: 3,
            enableRecovery: false,
            requestedBy: "Ada Mercer",
            requestedAt: new Date("2026-10-02T17:30:00.000Z"),
            reason: "Launch rehearsal approved by finance.",
            evidenceReference: "launch-checklist-2026-10",
            status: "pending",
          },
        } as unknown as Parameters<typeof CapabilityControls>[0]["capability"]
      }
    />,
  );
  expect(screen.getByText(/Oct 2, 2026, 10:30 AM PDT/)).toBeVisible();
});
