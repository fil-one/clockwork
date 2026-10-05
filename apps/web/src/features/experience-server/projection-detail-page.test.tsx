import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectionChannel, ProjectionRecord } from "./model";

const mocks = vi.hoisted(() => ({
  getRouteRoles: vi.fn(),
  loadPortalRecords: vi.fn(),
  billingEnabled: { value: true },
}));

vi.mock("@/src/features/internal-ops/capability-state", () => ({
  allCapabilitiesEnabled: { isEnabled: () => true },
  getCapabilityState: () =>
    Promise.resolve({
      isEnabled: (key: string) =>
        key === "billing" ? mocks.billingEnabled.value : true,
    }),
}));

vi.mock("@/src/features/shell/route-session", () => ({
  getRouteRoles: mocks.getRouteRoles,
  getRouteSession: async (audience: string) => ({
    roles: (await mocks.getRouteRoles(audience)) as readonly string[],
    providerBacked: false,
  }),
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
  mocks.billingEnabled.value = true;
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
      name: "Quote decisions",
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
      "Operational data needs a refresh",
    );
    expect(
      screen.getByRole("list", { name: "Commercial promise chain" }),
    ).toHaveTextContent(
      "Accepted quoteCurrent decisionOrder commitment and service timingAuthoritative resultProvisioning and service state",
    );
    const ledger = screen.getByRole("region", {
      name: "Order decisions",
    });
    expect(ledger).toHaveTextContent("Northstar primary archive");
    expect(ledger).toHaveTextContent(
      "Service term12 months · expires Aug 4, 2026",
    );
    expect(ledger).toHaveTextContent("TimingExpires Aug 4");
    expect(ledger).toHaveTextContent("Next stepRenewal notice opens Nov 1");
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
    // A field the product has no label for is shown under its own name, as
    // code, rather than dropped or dressed up as an English label.
    expect(screen.getByText("providerReference").tagName).toBe("CODE");
    expect(screen.getByText("case_018421")).toBeVisible();
    // Named facts carry their labels; sort keys and styling do not appear.
    expect(screen.getByText("Owner")).toBeVisible();
    expect(screen.queryByText("valueSort")).toBeNull();
    expect(screen.queryByText("tone")).toBeNull();
  });

  describe("a staff account record", () => {
    function account(overrides: Partial<ProjectionRecord["data"]> = {}) {
      const base = record("dashboard", {
        key: "meridian-archive",
        title: "Meridian Archive Labs, Inc.",
        nextAction: "Evaluate dunning",
        allowedActions: ["evaluate_dunning"],
      });
      return {
        ...base,
        audience: "internal" as const,
        data: {
          ...base.data,
          reference: "Meridian Archive Labs, Inc.",
          owner: "Ada Mercer",
          ...overrides,
        },
      };
    }

    async function renderAccount(data: ProjectionRecord) {
      mocks.getRouteRoles.mockResolvedValue(["internal_operator"]);
      mocks.loadPortalRecords.mockResolvedValue({
        records: [data],
        generatedAt: "2026-08-01T12:00:00.000Z",
        stale: false,
      });
      render(
        await ProjectionDetailPage({
          audience: "internal",
          channel: "dashboard",
          recordKey: "meridian-archive",
          title: "Account operations",
          description: "Owner, relationship, value and documents.",
        }),
      );
    }

    it("leaves out a fact that only repeats the account's name", async () => {
      await renderAccount(account());

      expect(screen.queryByText("Reference")).toBeNull();
      expect(screen.getByText("Owner")).toBeVisible();
      expect(screen.getByText("Ada Mercer")).toBeVisible();
      // Staff pages carry no workspace eyebrow.
      expect(screen.queryByText("Operator workspace")).toBeNull();
    });

    it("shows a billing next step while billing is switched on", async () => {
      await renderAccount(account());

      expect(screen.getByText("Next step")).toBeVisible();
      expect(screen.getByText("Evaluate dunning")).toBeVisible();
    });

    it("hides a billing next step and its action while billing is switched off", async () => {
      mocks.billingEnabled.value = false;
      await renderAccount(account());

      expect(screen.queryByText("Next step")).toBeNull();
      expect(screen.queryByText("Evaluate dunning")).toBeNull();
      expect(screen.queryByText(/evaluate_dunning/)).toBeNull();
    });

    it("keeps a next step that needs no switched-off capability", async () => {
      mocks.billingEnabled.value = false;
      await renderAccount(
        account({
          nextAction: "Prepare the order form",
          allowedActions: ["prepare_artifact"],
        }),
      );

      expect(screen.getByText("Next step")).toBeVisible();
      expect(screen.getByText("Prepare the order form")).toBeVisible();
    });

    it("hides a written step that names a switched-off capability", async () => {
      mocks.billingEnabled.value = false;
      await renderAccount(
        account({
          nextAction: "Confirm the ACH retry before the renewal notice opens",
          nextActionCapability: "billing",
          allowedActions: [],
        }),
      );

      expect(screen.queryByText("Next step")).toBeNull();
      expect(screen.queryByText(/ACH retry/)).toBeNull();
      // The tag is not shown as a fact of its own.
      expect(screen.queryByText("nextActionCapability")).toBeNull();
    });

    it("shows that written step while its capability is on", async () => {
      await renderAccount(
        account({
          nextAction: "Confirm the ACH retry before the renewal notice opens",
          nextActionCapability: "billing",
          allowedActions: [],
        }),
      );

      expect(
        screen.getByText(
          "Confirm the ACH retry before the renewal notice opens",
        ),
      ).toBeVisible();
    });

    it("names the first available action when the step's own action is switched off", async () => {
      mocks.billingEnabled.value = false;
      await renderAccount(
        account({ allowedActions: ["evaluate_dunning", "prepare_artifact"] }),
      );

      expect(screen.getByText("Next step")).toBeVisible();
      expect(screen.getByText("Prepare document")).toBeVisible();
    });
  });
});
