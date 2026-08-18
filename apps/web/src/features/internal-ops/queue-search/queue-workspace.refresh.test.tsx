import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { QueueItem } from "./model";
import { QueueWorkspace } from "./queue-workspace";

const navigation = vi.hoisted(() => ({
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/internal/queues",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({
    replace: vi.fn(),
    push: vi.fn(),
    prefetch: vi.fn(),
    refresh: navigation.refresh,
  }),
}));

const item: QueueItem = {
  id: "EXC-COL-008",
  title: "Collections aging decision",
  entity: "Northstar Archive Labs",
  type: "collections",
  owner: "Dana Reyes",
  ownerId: "dana",
  backup: null,
  backupId: null,
  risk: "high",
  status: "open",
  createdAt: "2026-07-20T10:00:00.000Z",
  updatedAt: "2026-07-31T15:42:00.000Z",
  dueAt: "2026-07-30T17:00:00.000Z",
  ageDays: 11,
  summary: null,
  policyReason: null,
  policyBasis: null,
  evidence: [],
  related: [],
  permittedActions: [],
};

function renderWorkspace(demoRefreshEnabled: boolean) {
  return render(
    <QueueWorkspace
      roles={["internal_operator"]}
      items={[item]}
      generatedAt="2026-07-31T16:00:00.000Z"
      stale
      actorId="dana"
      demoRefreshEnabled={demoRefreshEnabled}
    />,
  );
}

describe("operational queue projection refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.cookie = "clockwork-csrf=12345678901234567890123456789012; Path=/";
  });

  afterEach(() => {
    document.cookie = "clockwork-csrf=; Max-Age=0; Path=/";
    vi.unstubAllGlobals();
  });

  it("keeps the ordinary production control a read-only route recheck", async () => {
    const fetchImplementation = vi.fn();
    vi.stubGlobal("fetch", fetchImplementation);
    renderWorkspace(false);

    await userEvent.click(screen.getByRole("button", { name: "Refresh data" }));

    expect(navigation.refresh).toHaveBeenCalledTimes(1);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("uses a bodyless same-origin mutation before refreshing the demo route", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchImplementation);
    renderWorkspace(true);

    await userEvent.click(screen.getByRole("button", { name: "Refresh data" }));

    await waitFor(() => expect(navigation.refresh).toHaveBeenCalledTimes(1));
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImplementation.mock.calls[0] ?? [];
    expect(url).toBe("/api/demo/projections/queues/refresh");
    expect(init).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
    });
    const headers = new Headers(init?.headers);
    expect(headers.get("x-csrf-token")).toBe(
      "12345678901234567890123456789012",
    );
    expect(headers.get("idempotency-key")).toMatch(/^[0-9a-f-]{36}$/u);
    expect(init).not.toHaveProperty("body");
  });

  it("retains the idempotency key when an operator retries a refused refresh", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchImplementation);
    renderWorkspace(true);

    await userEvent.click(screen.getByRole("button", { name: "Refresh data" }));
    expect(
      await screen.findByText("Data refresh failed. Try again."),
    ).toBeVisible();
    const firstHeaders = fetchImplementation.mock.calls[0]?.[1]
      ?.headers as Readonly<Record<string, string>>;

    await userEvent.click(
      screen.getByRole("button", { name: "Try refresh again" }),
    );

    await waitFor(() => expect(navigation.refresh).toHaveBeenCalledTimes(1));
    const secondHeaders = fetchImplementation.mock.calls[1]?.[1]
      ?.headers as Readonly<Record<string, string>>;
    expect(secondHeaders["idempotency-key"]).toBe(
      firstHeaders["idempotency-key"],
    );
  });
});
