import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { CommercialRecord } from "./model";
import { CommercialRecordDetail } from "./record-detail";

vi.mock("@/src/features/experience-server/delivery", () => ({
  loadRecordArtifacts: () =>
    Promise.resolve([
      {
        id: "artifact-1",
        kind: "order_form",
        label: "Order form ORD-2026-0112 v2",
        state: "stored",
      },
    ]),
}));

function record(kind: CommercialRecord["kind"]): CommercialRecord {
  return {
    id: kind === "orders" ? "ORD-2026-0112" : "Q-2026-0184-v3",
    kind,
    title: kind === "orders" ? "Madrid compliance replica" : "Archive quote",
    description: "A projected commercial record",
    status: kind === "orders" ? "provisioning" : "open",
    statusLabel: kind === "orders" ? "Provisioning" : "Open",
    tone: "warning",
    risk: "medium",
    owner: "Service operations",
    value: "$55,440 annual",
    valueLabel: "Committed annual spend",
    updatedAt: "2026-07-31T14:00:00.000Z",
    dateLabel: "Starts Aug 1",
    href:
      kind === "orders" ? "/orders/ORD-2026-0112" : "/quotes/Q-2026-0184-v3",
    term: "Aug 1, 2026–Jul 31, 2027",
    nextAction: "Complete provisioning checklist",
  };
}

describe("order detail timeline wiring", () => {
  it("mounts the shared timeline with the already-loaded order artifacts", async () => {
    render(
      await CommercialRecordDetail({
        id: "ORD-2026-0112",
        record: record("orders"),
      }),
    );

    const timeline = screen.getByRole("list", { name: "Order lifecycle" });
    expect(within(timeline).getAllByRole("listitem")).toHaveLength(5);
    expect(timeline).toHaveTextContent(
      "Pinned order form: Order form ORD-2026-0112 v2",
    );
    expect(timeline).toHaveTextContent("Not yet recorded.");
  });

  it("does not mount an order lifecycle on another commercial record", async () => {
    render(
      await CommercialRecordDetail({
        id: "Q-2026-0184-v3",
        record: record("quotes"),
      }),
    );

    expect(screen.queryByRole("list", { name: "Order lifecycle" })).toBeNull();
  });
});
