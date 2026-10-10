import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { fixtureSigner } from "../../../../../../packages/contracts/src/mnda-fixture";
const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  load: vi.fn(),
  configure: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("./actions", () => ({
  saveMndaSettings: mocks.save,
  loadMndaSettings: mocks.load,
  configureMndaSigner: mocks.configure,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
import { MndaSettingsWorkspace } from "./settings-workspace";

const initial = {
  signers: [fixtureSigner],
  settings: {
    noticeEmail: "james@fil.one",
    version: 2,
    updatedAt: null,
    updatedBy: null,
  },
};
beforeEach(() => vi.clearAllMocks());

it("saves the notice email against the version it was loaded with", async () => {
  mocks.save.mockResolvedValue({ ok: true, value: null });
  mocks.load.mockResolvedValue({
    ok: true,
    value: {
      ...initial,
      settings: {
        ...initial.settings,
        noticeEmail: "legal@fil.one",
        version: 3,
      },
    },
  });
  render(<MndaSettingsWorkspace initial={initial} />);
  fireEvent.change(screen.getByLabelText(/Fil One notice email/), {
    target: { value: "legal@fil.one" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(mocks.save).toHaveBeenCalledWith({
      noticeEmail: "legal@fil.one",
      version: 2,
    }),
  );
  expect(
    await screen.findByText("Notice email saved. New drafts use it."),
  ).toBeVisible();
});

it("reloads and says so when someone else changed the setting first", async () => {
  mocks.save.mockResolvedValue({ ok: false, code: "settings_conflict" });
  mocks.load.mockResolvedValue({
    ok: true,
    value: {
      ...initial,
      settings: {
        ...initial.settings,
        noticeEmail: "notices@fil.one",
        version: 3,
      },
    },
  });
  render(<MndaSettingsWorkspace initial={initial} />);
  const field = screen.getByLabelText(/Fil One notice email/);
  fireEvent.change(field, { target: { value: "legal@fil.one" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(
    await screen.findByText(/changed the notice email to .*notices@fil\.one/),
  ).toBeVisible();
  expect(field).toHaveValue("legal@fil.one");
  mocks.save.mockResolvedValue({ ok: true, value: null });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(mocks.save).toHaveBeenLastCalledWith({
      noticeEmail: "legal@fil.one",
      version: 3,
    }),
  );
});

it("offers a reload when the session expired and keeps the draft typed in", async () => {
  mocks.save.mockResolvedValueOnce({ ok: false, code: "session_expired" });
  render(<MndaSettingsWorkspace initial={initial} />);
  const field = screen.getByLabelText(/Fil One notice email/);
  fireEvent.change(field, { target: { value: "legal@fil.one" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(
    await screen.findByText("Your session expired. Reload to continue."),
  ).toBeVisible();
  expect(field).not.toHaveAccessibleErrorMessage();
  fireEvent.click(screen.getByRole("button", { name: "Reload" }));
  await waitFor(() =>
    expect(
      screen.queryByText("Your session expired. Reload to continue."),
    ).toBeNull(),
  );
  expect(mocks.refresh).toHaveBeenCalledOnce();
  expect(field).toHaveValue("legal@fil.one");
});

it("offers a reload when the session expired while saving a signer", async () => {
  mocks.configure.mockResolvedValueOnce({
    ok: false,
    code: "session_expired",
  });
  render(<MndaSettingsWorkspace initial={initial} />);
  fireEvent.click(screen.getByRole("button", { name: /Edit/ }));
  const form = screen.getByRole("form");
  fireEvent.click(within(form).getByRole("button", { name: "Save" }));
  expect(
    await screen.findByText("Your session expired. Reload to continue."),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "Reload" })).toBeVisible();
  expect(form).toBeVisible();
});
