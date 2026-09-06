import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(
  (): {
    demo: boolean;
    database: object | undefined;
    list: ReturnType<typeof vi.fn>;
  } => ({ demo: false, database: {}, list: vi.fn() }),
);
vi.mock("@clockwork/db", () => ({ listAgreementTemplates: state.list }));
vi.mock("@/src/auth/session", () => ({
  explicitDemoIdentityEnabled: () => state.demo,
  getCommerceSession: () => Promise.resolve({ isInternalStaff: true }),
}));
vi.mock("@/src/db/service", () => ({
  getOptionalServiceDatabase: () => state.database,
}));
vi.mock("@/src/features/shell/route-session", () => ({
  getRouteRoles: () => Promise.resolve(["legal_approver"]),
}));
vi.mock("@/src/features/internal-ops/administration-safety/agreements", () => ({
  AgreementAdministration: () => <p>Explicit demo templates</p>,
}));
vi.mock("@/src/features/shell/permission-gate", () => ({
  SurfaceActionGate: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/src/features/surfaces/workflow-panel", () => ({
  WorkflowPanel: () => <p>Authorized publication workflow</p>,
}));
import Page from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  state.demo = false;
  state.database = {};
  state.list.mockResolvedValue([]);
});
describe("canonical agreement operator page", () => {
  it("shows a true empty registry rather than fictional agreements", async () => {
    render(await Page());
    expect(
      screen.getByText("No canonical agreement templates have been published."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Explicit demo templates"),
    ).not.toBeInTheDocument();
  });
  it("renders persisted version and exact evidence", async () => {
    state.list.mockResolvedValue([
      {
        id: "actual-template",
        type: "Storage MSA",
        semanticVersion: "1.2.3",
        jurisdiction: "US",
        effectiveOn: "2026-09-06",
        approvalStatus: "approved",
        executionMode: "counter_signed",
        canonicalDocumentId: "actual-document",
        textHash: "approved-text-hash",
        approvedBy: "actual-legal-approver",
      },
    ]);
    render(await Page());
    expect(screen.getByText("Storage MSA")).toBeInTheDocument();
    expect(screen.getByText("1.2.3")).toBeInTheDocument();
    expect(
      screen.getByText("Text hash: approved-text-hash"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Approved by: actual-legal-approver"),
    ).toBeInTheDocument();
  });
  it("does not offer publication when the canonical database is unconfigured", async () => {
    state.database = undefined;
    render(await Page());
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Agreement registry unavailable",
    );
    expect(
      screen.queryByText("Authorized publication workflow"),
    ).not.toBeInTheDocument();
    expect(state.list).not.toHaveBeenCalled();
  });
  it("uses fixture templates only for the explicit demo adapter", async () => {
    state.demo = true;
    render(await Page());
    expect(screen.getByText("Explicit demo templates")).toBeInTheDocument();
    expect(state.list).not.toHaveBeenCalled();
  });
});
