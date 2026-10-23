import { renderToString } from "react-dom/server";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  fetch: vi.fn(),
  remove: vi.fn(),
  restore: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("./actions", () => ({
  removeAccountDocument: mocks.remove,
  restoreAccountDocument: mocks.restore,
}));
import { AccountDocuments } from "./documents";
const target = {
  type: "partner" as const,
  id: "10000000-0000-4000-8000-000000000001",
};
const file = {
  id: "90000000-0000-4000-8000-000000000001",
  title: "External MNDA",
  kind: "mnda" as const,
  signedOn: "2026-10-10",
  fileName: "Signed MNDA.pdf",
  sizeBytes: 1024,
  uploadedByName: "Iris",
  createdAt: "2026-10-20T12:00:00Z",
  version: 1,
};
const removedFile = {
  ...file,
  version: 2,
  removedAt: "2026-10-21T12:00:00Z",
  removedByName: "Iris",
  removalReason: "Attached to the wrong record",
};
const choose = (name = "Signed MNDA.pdf", type = "application/pdf") =>
  fireEvent.change(screen.getByLabelText("Choose PDF"), {
    target: { files: [new File(["%PDF-1.7"], name, { type })] },
  });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
});
it("shows external provenance, signing date and target-scoped links to read-only staff", () => {
  render(<AccountDocuments target={target} files={[file]} canWrite={false} />);
  expect(screen.getByText("Uploaded externally")).toBeInTheDocument();
  expect(screen.getByText("Signed Oct 10, 2026")).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Download External MNDA" }),
  ).toHaveAttribute(
    "href",
    `/internal/record-documents/partner/${target.id}/${file.id}`,
  );
  expect(screen.queryByLabelText("Choose PDF")).not.toBeInTheDocument();
});
it("keeps details and the same retry ID after an interrupted upload, then shows the saved document immediately", async () => {
  mocks.fetch.mockRejectedValueOnce(new Error("network interrupted"));
  mocks.fetch.mockResolvedValueOnce(Response.json({ ok: true, value: file }));
  render(<AccountDocuments target={target} files={[]} canWrite />);
  choose();
  expect(screen.getByLabelText("Document title")).toHaveValue("Signed MNDA");
  fireEvent.change(screen.getByLabelText("Document title"), {
    target: { value: "External MNDA" },
  });
  fireEvent.change(screen.getByLabelText("Signed on (optional)"), {
    target: { value: "2026-10-10" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Attach document" }));
  await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Attach document" }),
    ).not.toBeDisabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Attach document" }));
  await screen.findByRole("link", { name: "Download External MNDA" });
  const metadata = mocks.fetch.mock.calls.map((call) => {
    const init = call[1] as RequestInit;
    return JSON.parse((init.body as FormData).get("item") as string) as Record<
      string,
      unknown
    >;
  });
  expect(metadata[0]).toEqual(metadata[1]);
  expect(metadata[0]).toMatchObject({
    title: "External MNDA",
    kind: "mnda",
    signedOn: "2026-10-10",
  });
  expect(screen.getByLabelText("Document title")).toHaveValue("");
  expect(mocks.refresh).toHaveBeenCalledOnce();
});
it("refuses unsupported files before sending and keeps the form available", async () => {
  render(<AccountDocuments target={target} files={[]} canWrite />);
  choose("notes.txt", "text/plain");
  fireEvent.click(screen.getByRole("button", { name: "Attach document" }));
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(
    await screen.findByText(/Only PDF files can be uploaded/i),
  ).toBeInTheDocument();
});
it("keeps uploads unavailable in demo mode", () => {
  render(<AccountDocuments target={target} files={[]} canWrite demo />);
  expect(screen.queryByLabelText("Choose PDF")).not.toBeInTheDocument();
  expect(screen.getByText(/live staff workspace/)).toBeInTheDocument();
});

it("keeps the file picker disabled until its client handler is ready", () => {
  const markup = renderToString(
    <AccountDocuments target={target} files={[]} canWrite />,
  );
  const container = document.createElement("div");
  container.innerHTML = markup;
  expect(container.querySelector('input[type="file"]')).toBeDisabled();
});

it("removes a document only with a reason, then offers undo", async () => {
  mocks.remove.mockResolvedValue({ ok: true, value: removedFile });
  mocks.restore.mockResolvedValue({ ok: true, value: { ...file, version: 3 } });
  render(<AccountDocuments target={target} files={[file]} canWrite />);
  fireEvent.click(screen.getByRole("button", { name: "Remove External MNDA" }));
  const confirm = screen.getByRole("button", { name: "Remove document" });
  expect(confirm).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Why remove it?"), {
    target: { value: "Attached to the wrong record" },
  });
  fireEvent.click(confirm);
  await screen.findByText("“External MNDA” was removed from this record.");
  expect(mocks.remove).toHaveBeenCalledWith({
    target,
    id: file.id,
    expectedVersion: 1,
    reason: "Attached to the wrong record",
  });
  expect(
    screen.queryByRole("link", { name: "Download External MNDA" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("1 removed document")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await screen.findByText("“External MNDA” is back on this record.");
  expect(mocks.restore).toHaveBeenCalledWith({
    target,
    id: file.id,
    expectedVersion: 2,
  });
  expect(
    screen.getByRole("link", { name: "Download External MNDA" }),
  ).toBeInTheDocument();
});

it("lists removed documents with who and why, and no way to open them", () => {
  render(
    <AccountDocuments
      target={target}
      files={[]}
      removed={[removedFile]}
      canWrite={false}
    />,
  );
  expect(
    screen.getByText(/Removed by Iris: Attached to the wrong record/),
  ).toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Restore External MNDA" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /Remove/ }),
  ).not.toBeInTheDocument();
});

it("explains a removal someone else already changed", async () => {
  mocks.remove.mockResolvedValue({
    ok: false,
    code: "ATTACHMENT_VERSION_CONFLICT",
  });
  render(<AccountDocuments target={target} files={[file]} canWrite />);
  fireEvent.click(screen.getByRole("button", { name: "Remove External MNDA" }));
  fireEvent.change(screen.getByLabelText("Why remove it?"), {
    target: { value: "Replaced" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Remove document" }));
  expect(
    await screen.findByText(/Someone else changed this document/),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Download External MNDA" }),
  ).toBeInTheDocument();
});

it("keeps the newest version when the server refresh lags behind an undo", async () => {
  mocks.remove.mockResolvedValueOnce({ ok: true, value: removedFile });
  mocks.restore.mockResolvedValue({ ok: true, value: { ...file, version: 3 } });
  const { rerender } = render(
    <AccountDocuments target={target} files={[file]} canWrite />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Remove External MNDA" }));
  fireEvent.change(screen.getByLabelText("Why remove it?"), {
    target: { value: "Wrong record" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Remove document" }));
  fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
  await screen.findByText("“External MNDA” is back on this record.");
  // A refresh that only saw the removal arrives after the undo.
  rerender(
    <AccountDocuments
      target={target}
      files={[]}
      removed={[removedFile]}
      canWrite
    />,
  );
  expect(
    screen.getByRole("link", { name: "Download External MNDA" }),
  ).toBeInTheDocument();
  mocks.remove.mockResolvedValueOnce({
    ok: true,
    value: { ...removedFile, version: 4 },
  });
  fireEvent.click(screen.getByRole("button", { name: "Remove External MNDA" }));
  fireEvent.change(screen.getByLabelText("Why remove it?"), {
    target: { value: "Wrong record again" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Remove document" }));
  await waitFor(() =>
    expect(mocks.remove).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedVersion: 3 }),
    ),
  );
  // The undo offered for one removal never outlives the next action.
  expect(
    screen.queryByText("“External MNDA” is back on this record."),
  ).toBeNull();
});
