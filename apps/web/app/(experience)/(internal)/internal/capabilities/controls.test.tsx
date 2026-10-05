import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ approveOwn: vi.fn() }));
vi.mock("./actions", () => ({ changeCapability: vi.fn() }));
vi.mock("@/src/features/internal-ops/self-approval/actions", () => ({
  approveOwnCapability: mocks.approveOwn,
}));

import { CapabilityControls } from "./controls";

const requester = "21000000-0000-4000-8000-000000000020";
const capability = {
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
    requestedBy: requester,
    requestedAt: new Date("2026-10-02T17:30:00.000Z"),
    reason: "Launch rehearsal approved by finance.",
    evidenceReference: "launch-checklist-2026-10",
    status: "pending",
  },
} as unknown as Parameters<typeof CapabilityControls>[0]["capability"];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.approveOwn.mockResolvedValue({ ok: true });
});
afterEach(() => {
  process.env.TZ = "UTC";
});

it("states when a capability change was requested in the reader's zone", () => {
  process.env.TZ = "America/Los_Angeles";
  render(<CapabilityControls canOperate canApprove capability={capability} />);
  expect(screen.getByText(/Oct 2, 2026, 10:30 AM PDT/)).toBeVisible();
});

it("lets a commerce administrator approve their own switch request with a reason", async () => {
  const user = userEvent.setup();
  render(
    <CapabilityControls
      canOperate
      canApprove
      canApproveOwn
      viewerUserId={requester}
      subject="Billing"
      capability={capability}
    />,
  );
  expect(
    screen.queryByRole("button", { name: "Approve activation" }),
  ).toBeNull();
  await user.click(
    screen.getByRole("button", { name: "Approve my own request" }),
  );
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveTextContent("You raised this request: Billing.");
  await user.type(
    within(dialog).getByLabelText(/Why are you approving it yourself/),
    "Launch rehearsal, approving alone",
  );
  await user.click(
    within(dialog).getByRole("button", { name: "Approve my own request" }),
  );
  expect(mocks.approveOwn).toHaveBeenCalledExactlyOnceWith({
    capabilityKey: "billing",
    expectedRowVersion: 3,
    proposalId: "70000000-0000-4000-8000-000000000001",
    reason: "Launch rehearsal, approving alone",
  });
  expect(
    await screen.findByText(/Approved. Your reason is recorded/),
  ).toBeVisible();
});

it("keeps the ordinary approval for someone else's request or without approval:self", () => {
  const { rerender } = render(
    <CapabilityControls
      canOperate
      canApprove
      canApproveOwn
      viewerUserId="21000000-0000-4000-8000-000000000099"
      capability={capability}
    />,
  );
  expect(
    screen.queryByRole("button", { name: "Approve my own request" }),
  ).toBeNull();
  rerender(
    <CapabilityControls
      canOperate
      canApprove
      viewerUserId={requester}
      capability={capability}
    />,
  );
  expect(
    screen.queryByRole("button", { name: "Approve my own request" }),
  ).toBeNull();
});
