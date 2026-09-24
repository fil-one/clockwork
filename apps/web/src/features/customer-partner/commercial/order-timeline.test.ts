import { describe, expect, it } from "vitest";

import type { ProjectedArtifact } from "@/src/features/experience-server/artifact-delivery-list";

import { translatorFor } from "@/src/i18n/catalogs";

import type { CommercialRecord, OrderLifecycleStatus } from "./model";
import { orderTimeline as renderTimeline } from "./order-timeline";

const en = translatorFor("en");
const orderTimeline = (
  record: CommercialRecord,
  artifacts: readonly ProjectedArtifact[],
) => renderTimeline(record, artifacts, en);

function publicOrderStatus(status: OrderLifecycleStatus | null): string {
  if (status === "accepted" || status === "active") return status;
  if (status === "completed") return "complete";
  return "attention";
}

function order(
  lifecycleStatus: OrderLifecycleStatus | null,
  term = "Aug 1, 2026–Jul 31, 2027",
) {
  return {
    id: "ORD-2026-0112",
    kind: "orders",
    title: "Madrid compliance replica",
    description: "120 TB · EU West · direct",
    // This is the lossy status the production presentation renders. The
    // timeline must never try to reconstruct lifecycle position from it.
    status: publicOrderStatus(lifecycleStatus),
    statusLabel: publicOrderStatus(lifecycleStatus),
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
    orderLifecycleStatus: lifecycleStatus,
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
    ["amended", ["complete", "complete", "complete", "current", "upcoming"]],
    ["completed", ["complete", "complete", "complete", "complete", "complete"]],
    ["cancelled", ["complete", "upcoming", "upcoming", "upcoming", "upcoming"]],
    [
      "terminated",
      ["complete", "complete", "complete", "complete", "complete"],
    ],
  ] as const)("maps %s through the recorded lifecycle", (status, expected) => {
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
    const timeline = orderTimeline(order(null, "Not recorded"), []);
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

  it("does not fall back to a plausible public display status", () => {
    const record = order(null);
    record.status = "active";

    expect(orderTimeline(record, []).map((item) => item.status)).toEqual([
      "upcoming",
      "upcoming",
      "upcoming",
      "upcoming",
      "upcoming",
    ]);
  });
});
