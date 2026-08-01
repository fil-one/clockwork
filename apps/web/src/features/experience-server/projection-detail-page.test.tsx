import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectionChannel, ProjectionRecord } from "./model";

const mocks = vi.hoisted(() => ({
  getRouteRoles: vi.fn(),
  loadPortalRecords: vi.fn(),
}));

vi.mock("@/src/features/shell/route-session", () => ({
  getRouteRoles: mocks.getRouteRoles,
}));

vi.mock("./portal-view-loader", () => ({
  loadPortalRecords: mocks.loadPortalRecords,
}));

vi.mock("./projection-action-buttons", () => ({
  ProjectionActionButtons: ({
    actions,
    recordKey,
    version,
  }: {
    actions: readonly string[];
    recordKey: string;
    version: number;
  }) => (
    <span>
      {actions.length > 0
        ? `${actions.join(", ")} · ${recordKey} · version ${version}`
        : "Read only"}
    </span>
  ),
}));

vi.mock("./artifact-delivery-list", () => ({
  ArtifactDeliveryList: () => <p>No generated artifacts attached</p>,
}));

vi.mock("./evidence-upload-control", () => ({
  EvidenceUploadControl: () => <span>Evidence control</span>,
}));

import { ProjectionDetailPage } from "./projection-detail-page";

function record(
  channel: ProjectionChannel,
  input: {
    key: string;
    title: string;
    allowedActions?: readonly string[];
    nextAction?: string;
  },
): ProjectionRecord {
  return {
    id: `projection-${input.key}`,
    recordKey: input.key,
    aggregateType: channel,
    aggregateId: `aggregate-${input.key}`,
    accountId: "account-1",
    audience: "customer",
    channel,
    version: 3,
    sourceUpdatedAt: "2026-07-31T16:00:00.000Z",
    projectedAt: "2026-07-31T16:01:00.000Z",
    stale: false,
    data: {
      id: input.key,
      kind: channel,
      title: input.title,
      description: "120 TB · US East · annual · direct",
      status: "open",
      statusLabel: "Open",
      tone: "warning",
      risk: "medium",
      owner: "Maya Chen",
      value: "$55,440.00",
      valueLabel: "Estimated annual spend",
      dateLabel: "Expires Aug 4",
      href: `/quotes/${input.key}`,
      term: "12 months · expires Aug 4, 2026",
      nextAction: input.nextAction ?? "Accept or cancel before expiry",
      allowedActions: input.allowedActions ?? [],
    },
  };
}

beforeEach(() => {
  mocks.getRouteRoles.mockResolvedValue(["owner"]);
});

describe("projection detail task hierarchy", () => {
  it("orders actionable quotes and exposes only decision-changing facts", async () => {
    mocks.loadPortalRecords.mockResolvedValue({
      records: [
        record("quotes", { key: "Q-DRAFT", title: "Draft expansion" }),
        record("quotes", {
          key: "Q-OPEN",
          title: "Enterprise committed capacity",
          allowedActions: ["accept", "expire"],
        }),
      ],
      generatedAt: "2026-08-01T12:00:00.000Z",
      stale: false,
    });

    render(
      await ProjectionDetailPage({
        audience: "customer",
        channel: "quotes",
        title: "Quote workspace",
        description: "Choose an authorized commercial record.",
      }),
    );

    const chain = screen.getByRole("list", {
      name: "Commercial promise chain",
    });
    expect(chain).toHaveTextContent("Agreement and account authority");
    expect(chain).toHaveTextContent("Quote scope, price, and expiry");
    expect(chain).toHaveTextContent("Order commitment");

    const ledger = screen.getByRole("region", {
      name: "Quotes decision ledger",
    });
    expect(
      within(ledger)
        .getAllByRole("heading", { level: 3 })
        .map((item) => item.textContent?.trim()),
    ).toEqual(["Enterprise committed capacity", "Draft expansion"]);
    expect(ledger).toHaveTextContent("Estimated annual spend");
    expect(ledger).toHaveTextContent("accept, expire · Q-OPEN · version 3");
    expect(ledger).not.toHaveTextContent("Status label");
    expect(ledger).not.toHaveTextContent("/quotes/Q-OPEN");
  });

  it("keeps accepted quote, order timing, and authoritative result contiguous", async () => {
    mocks.loadPortalRecords.mockResolvedValue({
      records: [
        record("orders", {
          key: "ORD-0098",
          title: "Northstar primary archive",
          nextAction: "Renewal notice opens Nov 1",
        }),
      ],
      generatedAt: "2026-08-01T12:00:00.000Z",
      stale: true,
    });

    render(
      await ProjectionDetailPage({
        audience: "customer",
        channel: "orders",
        title: "Order acceptance",
        description: "Review persisted commitments.",
      }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Source refresh is overdue",
    );
    expect(
      screen.getByRole("list", { name: "Commercial promise chain" }),
    ).toHaveTextContent(
      "Accepted quoteCurrent decisionOrder commitment and service timingAuthoritative resultProvisioning and service state",
    );
    const ledger = screen.getByRole("region", {
      name: "Orders decision ledger",
    });
    expect(ledger).toHaveTextContent("Northstar primary archive");
    expect(ledger).toHaveTextContent(
      "Service term12 months · expires Aug 4, 2026",
    );
    expect(ledger).toHaveTextContent("TimingExpires Aug 4");
    expect(ledger).toHaveTextContent(
      "Next binding stepRenewal notice opens Nov 1",
    );
    expect(ledger).toHaveTextContent("Read only");
  });

  it("preserves the complete scalar projection for non-commercial routes", async () => {
    const support = record("support", {
      key: "SUP-18421",
      title: "Restore timing",
    });
    support.data = { ...support.data, providerReference: "case_018421" };
    mocks.loadPortalRecords.mockResolvedValue({
      records: [support],
      generatedAt: "2026-08-01T12:00:00.000Z",
      stale: false,
    });

    render(
      await ProjectionDetailPage({
        audience: "customer",
        channel: "support",
        title: "Support record",
        description: "Inspect the authorized support projection.",
      }),
    );

    expect(screen.queryByLabelText("Commercial promise chain")).toBeNull();
    expect(screen.getByText("Provider Reference")).toBeVisible();
    expect(screen.getByText("case_018421")).toBeVisible();
  });
});
