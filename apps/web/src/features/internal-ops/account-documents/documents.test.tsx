import { renderToString } from "react-dom/server";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ refresh: vi.fn(), fetch: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
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
