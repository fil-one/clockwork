import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import type { ChannelPolicyRecord } from "@clockwork/domain/core";

const mocks = vi.hoisted(() => ({ approveOwn: vi.fn() }));
vi.mock("./actions", () => ({ changeChannelPolicy: vi.fn() }));
vi.mock("@/src/features/internal-ops/self-approval/actions", () => ({
  approveOwnChannelPolicy: mocks.approveOwn,
}));

import { ChannelDecisionForm } from "./forms";

const author = "20000000-0000-4000-8000-000000000001";
const record: ChannelPolicyRecord = {
  id: "90000000-0000-4000-8000-000000001449",
  rowVersion: 2,
  status: "proposed",
  terms: {
    version: 4,
    effectiveFrom: "2026-11-01",
    selfServeThresholdTb: 250,
    defaultProtectionDays: 30,
    maximumProtectionDays: 60,
    extensionDays: 30,
    maximumExtensions: 1,
    sourceEvidence: "approved-source",
  },
  createdBy: author,
  lastEditedBy: author,
  proposedBy: author,
  approvedBy: null,
  approvalEvidence: null,
  decisionReason: "Ready",
  createdAt: "2026-10-05T00:00:00Z",
  updatedAt: "2026-10-05T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.approveOwn.mockResolvedValue({ ok: true });
});

it("lets the author approve their own version with a reason and the approval evidence", async () => {
  render(
    <ChannelDecisionForm
      record={record}
      action="approve"
      allowed={false}
      selfApprovable
    />,
  );
  expect(
    screen.queryByText(/A different finance approver/),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Approve my own request" }),
  );
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveTextContent(
    "You raised this request: channel policy version 4.",
  );
  fireEvent.change(within(dialog).getByLabelText(/Approval evidence/), {
    target: { value: "Board minutes 2026-10" },
  });
  fireEvent.change(
    within(dialog).getByLabelText(/Why are you approving it yourself/),
    { target: { value: "Quarter start, approving alone" } },
  );
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Approve my own request" }),
  );
  await waitFor(() =>
    expect(mocks.approveOwn).toHaveBeenCalledExactlyOnceWith({
      id: record.id,
      expectedRowVersion: 2,
      reason: "Quarter start, approving alone",
      approvalEvidence: "Board minutes 2026-10",
    }),
  );
  expect(
    await screen.findByText(/Approved. Your reason is recorded/),
  ).toBeInTheDocument();
});

it("keeps the second-approver note for anyone who may not approve their own", () => {
  render(
    <ChannelDecisionForm record={record} action="approve" allowed={false} />,
  );
  expect(
    screen.queryByRole("button", { name: "Approve my own request" }),
  ).not.toBeInTheDocument();
});
