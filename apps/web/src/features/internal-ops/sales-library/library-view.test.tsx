import type * as UploadClient from "../contracts/upload-client";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { SalesCollateralRecord } from "@clockwork/contracts";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  save: vi.fn(),
  post: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("./actions", () => ({ saveCollateral: mocks.save }));
vi.mock("../contracts/upload-client", async (original) => ({
  ...(await original<typeof UploadClient>()),
  postCollateral: mocks.post,
}));
import { SalesLibraryView } from "./library-view";

const item = (
  patch: Partial<SalesCollateralRecord>,
): SalesCollateralRecord => ({
  id: "019a44ac-0000-7000-8000-0000000000e1",
  title: "Fil One overview deck",
  description: "First meeting with a storage buyer.",
  kind: "pitch_deck",
  audience: "customer",
  status: "current",
  contentUpdatedOn: "2026-10-01",
  linkUrl: null,
  file: {
    fileName: "Deck.pdf",
    sizeBytes: 3 * 1024 * 1024,
    sha256: "a".repeat(64),
  },
  updatedByName: "James Kurz",
  updatedAt: "2026-10-01T00:00:00.000Z",
  version: 1,
  ...patch,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.save.mockResolvedValue({ ok: true, value: {} });
  mocks.post.mockResolvedValue({ ok: true, value: {} });
});

it("explains what belongs in an empty library, by role", () => {
  const { unmount } = render(
    <SalesLibraryView items={[]} canManage={false} today="2026-10-04" />,
  );
  expect(
    screen.getByText("Nothing in the sales library yet"),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/Ask a Commerce administrator to add them/),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Add material" })).toBeNull();
  unmount();
  render(<SalesLibraryView items={[]} canManage today="2026-10-04" />);
  expect(
    screen.getAllByRole("button", { name: "Add material" }).length,
  ).toBeGreaterThan(0);
});

it("hides archived material until asked and filters by audience", () => {
  render(
    <SalesLibraryView
      canManage={false}
      today="2026-10-04"
      items={[
        item({}),
        item({
          id: "019a44ac-0000-7000-8000-0000000000e2",
          title: "Partner program one-pager",
          kind: "one_pager",
          audience: "partner",
          linkUrl: "https://example.com/partners",
          file: null,
        }),
        item({
          id: "019a44ac-0000-7000-8000-0000000000e3",
          title: "Old pricing",
          kind: "pricing_sheet",
          status: "archived",
        }),
      ]}
    />,
  );
  expect(screen.getByText("2 items")).toBeInTheDocument();
  expect(screen.queryByText("Old pricing")).toBeNull();
  fireEvent.click(screen.getByLabelText("Show archived (1)"));
  expect(screen.getByText("Old pricing")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Audience"), {
    target: { value: "partner" },
  });
  expect(screen.getByText("1 item")).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Open Partner program one-pager" }),
  ).toHaveAttribute("href", "https://example.com/partners");
  expect(screen.queryByRole("button", { name: /^Edit/ })).toBeNull();
});

it("adds a link only when it starts with https://", async () => {
  render(<SalesLibraryView items={[]} canManage today="2026-10-04" />);
  fireEvent.click(
    screen.getAllByRole("button", { name: "Add material" })[0] as HTMLElement,
  );
  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "Case study: media archive" },
  });
  fireEvent.click(screen.getByLabelText("Link to it"));
  fireEvent.change(screen.getByLabelText("Link"), {
    target: { value: "http://example.com/case" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add to library" }));
  expect(
    await screen.findByText("Use a link that starts with https://."),
  ).toBeInTheDocument();
  expect(mocks.save).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Link"), {
    target: { value: "https://example.com/case" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add to library" }));
  await waitFor(() =>
    expect(mocks.save.mock.calls[0]?.[0]).toMatchObject({
      item: {
        title: "Case study: media archive",
        linkUrl: "https://example.com/case",
        status: "current",
        contentUpdatedOn: "2026-10-04",
      },
    }),
  );
  expect(
    await screen.findByText("Case study: media archive was added."),
  ).toBeInTheDocument();
});

it("uploads a PDF item through the upload route", async () => {
  render(<SalesLibraryView items={[]} canManage today="2026-10-04" />);
  fireEvent.click(
    screen.getAllByRole("button", { name: "Add material" })[0] as HTMLElement,
  );
  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "Pricing" },
  });
  const form = screen
    .getByRole("button", { name: "Add to library" })
    .closest("form") as HTMLElement;
  fireEvent.change(within(form).getByLabelText(/^PDF/), {
    target: {
      files: [
        new File(["%PDF-1.7"], "Pricing.pdf", { type: "application/pdf" }),
      ],
    },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add to library" }));
  await waitFor(() => expect(mocks.post).toHaveBeenCalledOnce());
  const [url, body] = mocks.post.mock.calls[0] as [string, FormData];
  expect(url).toBe("/internal/sales-library/items");
  const item = body.get("item");
  expect(JSON.parse(typeof item === "string" ? item : "null")).toMatchObject({
    title: "Pricing",
    linkUrl: "",
  });
});
