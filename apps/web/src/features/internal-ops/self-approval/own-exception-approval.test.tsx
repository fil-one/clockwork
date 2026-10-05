import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import type * as CommerceClient from "@/src/features/contracts/commerce-client";
import { CommerceApiError } from "@/src/features/contracts/commerce-client";

const mocks = vi.hoisted(() => ({ decide: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("@/src/features/contracts/commerce-client", async (importOriginal) => ({
  ...(await importOriginal<typeof CommerceClient>()),
  decideException: mocks.decide,
}));

import { OwnExceptionApproval } from "./own-exception-approval";

const caseId = "70000000-0000-4000-8000-000000000001";
const evidence = "40000000-0000-4000-8000-000000000020";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.decide.mockResolvedValue({});
});

function open() {
  render(
    <OwnExceptionApproval
      caseId={caseId}
      subject="Pricing: Meridian Archive"
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Approve my own request" }),
  );
  return screen.getByRole("dialog");
}

it("needs an evidence document and a reason, then approves with the self-approval flag", async () => {
  const dialog = open();
  expect(dialog).toHaveTextContent(
    "You raised this request: Pricing: Meridian Archive.",
  );
  const confirm = within(dialog).getByRole("button", {
    name: "Approve my own request",
  });
  fireEvent.change(within(dialog).getByLabelText(/Evidence document ID/), {
    target: { value: "not-a-document" },
  });
  expect(confirm).toBeDisabled();
  fireEvent.change(within(dialog).getByLabelText(/Evidence document ID/), {
    target: { value: evidence },
  });
  fireEvent.change(
    within(dialog).getByLabelText(/Why are you approving it yourself/),
    { target: { value: "Below floor for the pilot, approving alone" } },
  );
  fireEvent.click(confirm);
  await waitFor(() =>
    expect(mocks.decide).toHaveBeenCalledExactlyOnceWith({
      caseId,
      decision: "approved",
      reason: "Below floor for the pilot, approving alone",
      evidenceDocumentId: evidence,
      selfApproval: true,
    }),
  );
  expect(
    await screen.findByText(/Approved. Your reason is recorded/),
  ).toBeInTheDocument();
});

it("says why the server refused", async () => {
  mocks.decide.mockRejectedValueOnce(
    new CommerceApiError(
      403,
      "forbidden",
      "refused",
      "SELF_APPROVAL_NOT_PERMITTED",
    ),
  );
  const dialog = open();
  fireEvent.change(within(dialog).getByLabelText(/Evidence document ID/), {
    target: { value: evidence },
  });
  fireEvent.change(
    within(dialog).getByLabelText(/Why are you approving it yourself/),
    { target: { value: "Below floor for the pilot, approving alone" } },
  );
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Approve my own request" }),
  );
  expect(
    await within(dialog).findByText(
      /Only a commerce administrator can approve their own request/,
    ),
  ).toBeInTheDocument();
});
