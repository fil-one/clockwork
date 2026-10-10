import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

import type { SelfApprovalOutcome } from "./model";
import { SelfApprovalDialog } from "./self-approval-dialog";

beforeEach(() => vi.clearAllMocks());

function submit(outcome: SelfApprovalOutcome) {
  const confirm = vi.fn().mockResolvedValue(outcome);
  render(
    <SelfApprovalDialog subject="Channel policy v4" onConfirm={confirm} />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Approve my own request" }),
  );
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByRole("textbox"), {
    target: { value: "Board approved the change" },
  });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Approve my own request" }),
  );
  return dialog;
}

it("offers a reload beside an expired-session refusal and keeps the reason", async () => {
  const dialog = submit({
    ok: false,
    message: "Your session expired. Reload to continue.",
    expired: true,
  });
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "Your session expired. Reload to continue.",
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "Reload" }));
  await waitFor(() => expect(within(dialog).queryByRole("alert")).toBeNull());
  expect(mocks.refresh).toHaveBeenCalledOnce();
  expect(within(dialog).getByRole("textbox")).toHaveValue(
    "Board approved the change",
  );
});

it("offers no reload for any other refusal", async () => {
  const dialog = submit({ ok: false, message: "You cannot approve this." });
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "You cannot approve this.",
  );
  expect(within(dialog).queryByRole("button", { name: "Reload" })).toBeNull();
});
