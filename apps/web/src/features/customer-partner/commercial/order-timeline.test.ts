import { describe, expect, it } from "vitest";

import type { ProjectedArtifact } from "@/src/features/experience-server/artifact-delivery-list";

import type { CommercialRecord } from "./model";
import { orderTimeline } from "./order-timeline";

function order(status: string, term = "Aug 1, 2026–Jul 31, 2027") {
  return {
    id: "ORD-2026-0112",
    kind: "orders",
    title: "Madrid compliance replica",
    description: "120 TB · EU West · direct",
    status,
    statusLabel: status,
    tone: "neutral",
    risk: "low",
    owner: "Service operations",
    value: "$55,440 annual",
    valueLabel: "Committed annual spend",
    updatedAt: "2026-07-31T14:00:00.000Z",
    dateLabel: "Starts Aug 1",
    href: "/orders/ORD-2026-0112",
    term,
    nextAction: "Review order",
  } satisfies CommercialRecord;
}

describe("orderTimeline", () => {
  it.each([
    ["submitted", ["current", "upcoming", "upcoming", "upcoming", "upcoming"]],
    ["accepted", ["complete", "current", "upcoming", "upcoming", "upcoming"]],
    [
      "provisioning",
      ["complete", "complete", "current", "upcoming", "upcoming"],
    ],
    ["active", ["complete", "complete", "complete", "current", "upcoming"]],
    ["completed", ["complete", "complete", "complete", "complete", "complete"]],
  ])("maps %s through the recorded lifecycle", (status, expected) => {
    expect(orderTimeline(order(status), []).map((item) => item.status)).toEqual(
      expected,
    );
  });

  it("names a stored order form but does not turn an absent artifact into a fact", () => {
    const form: ProjectedArtifact = {
      id: "artifact-1",
      kind: "order_form",
      label: "Order form ORD-2026-0112 v2",
      state: "stored",
    };

    expect(orderTimeline(order("accepted"), [form])[1]?.description).toBe(
      "Acceptance is recorded. Pinned order form: Order form ORD-2026-0112 v2.",
    );
    expect(orderTimeline(order("accepted"), [])[1]?.description).toBe(
      "Acceptance is recorded. Stored order form: Not yet recorded.",
    );
  });

  it("leaves unsourced stages and timestamps unrecorded", () => {
    const timeline = orderTimeline(order("submitted", "Not recorded"), []);
    const serialized = JSON.stringify(timeline);

    expect(timeline.slice(1).map((item) => item.description)).toEqual([
      "Not yet recorded.",
      "Not yet recorded.",
      "Not yet recorded.",
      "Not yet recorded.",
    ]);
    expect(timeline.every((item) => item.timestamp === undefined)).toBe(true);
    expect(serialized).not.toMatch(/notif|inventory|provisioned item/i);
  });

  it("does not infer how far an order progressed before cancellation", () => {
    expect(
      orderTimeline(order("cancelled"), []).map((item) => item.status),
    ).toEqual(["complete", "upcoming", "upcoming", "upcoming", "upcoming"]);
  });
});
