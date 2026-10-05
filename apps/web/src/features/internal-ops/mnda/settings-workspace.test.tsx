import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { fixtureSigner } from "../../../../../../packages/contracts/src/mnda-fixture";
const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  load: vi.fn(),
  configure: vi.fn(),
}));
vi.mock("./actions", () => ({
  saveMndaSettings: mocks.save,
  loadMndaSettings: mocks.load,
  configureMndaSigner: mocks.configure,
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
