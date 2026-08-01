import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/src/auth/actions", () => ({
  exitAssistedSession: vi.fn(),
}));

import { AssistedSessionBanner } from "./assisted-session-banner";

const session = {
  id: "12000000-0000-4000-8000-000000000001",
  authenticationSessionId: "auth-session-001",
  actualUserId: "20000000-0000-4000-8000-000000000001",
  actualActorName: "Iris Operator",
  actualActorEmail: "operator@filone.com",
  actualRoles: ["internal_operator" as const],
  targetAccountId: "10000000-0000-4000-8000-000000000001",
  targetAccountName: "Northstar Archive Labs",
  reason: "Customer requested quote correction · CASE-4812",
  startedAt: new Date("2026-07-31T16:00:00.000Z"),
  expiresAt: new Date("2026-07-31T16:15:00.000Z"),
};

describe("AssistedSessionBanner", () => {
  it("renders only authoritative effective identity, reason, and expiry with a real exit", () => {
    render(<AssistedSessionBanner session={session} />);

    const banner = screen.getByLabelText("Assisted mode active");
    expect(banner).toHaveTextContent("Northstar Archive Labs");
    expect(banner).toHaveTextContent("Iris Operator · operator@filone.com");
    expect(banner).toHaveTextContent("CASE-4812");
    expect(banner).toHaveTextContent("2026-07-31T16:15:00.000Z");
    expect(banner).toHaveTextContent(session.id);
    expect(
      screen.getByRole("button", { name: "Exit assisted mode" }),
    ).toHaveAttribute("type", "submit");
    expect(
      screen.queryByRole("link", { name: /exit/i }),
    ).not.toBeInTheDocument();
  });
});
