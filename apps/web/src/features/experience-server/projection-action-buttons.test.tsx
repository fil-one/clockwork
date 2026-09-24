import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { catalogs } from "@/src/i18n/catalogs";
import { LanguageProvider } from "@/src/i18n/client";

import type { ProjectionActionReceipt } from "./model";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  sendProjectionAction: vi.fn(),
  readProjectionAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock("@/src/features/contracts/experience-client", () => ({
  sendProjectionAction: mocks.sendProjectionAction,
  readProjectionAction: mocks.readProjectionAction,
}));

import { ProjectionActionButtons } from "./projection-action-buttons";

function receipt(
  status: ProjectionActionReceipt["status"],
  overrides: Partial<ProjectionActionReceipt> = {},
): ProjectionActionReceipt {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    projectionId: "projection-1",
    aggregateType: "invoice",
    aggregateId: "aggregate-1",
    action: "void",
    expectedVersion: 3,
    status,
    resultReference: null,
    resultCode: null,
    authoritativeVersion: null,
    commandReplayed: null,
    createdAt: "2026-08-01T12:00:00.000Z",
    completedAt: null,
    auditEventId: "audit-1",
    outboxMessageId: "outbox-1",
    ...overrides,
  };
}

/** The receipt poll sleeps a second between attempts, so tests drive the clock. */
async function elapse(milliseconds: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

function renderButtons(
  actions: readonly string[],
  roles: readonly string[] = ["owner"],
) {
  return render(
    <ProjectionActionButtons
      audience="customer"
      channel="billing"
      recordKey="INV-2026-0781"
      projectionId="projection-1"
      version={3}
      actions={actions}
      roles={roles}
    />,
  );
}

function renderPortugueseButtons(actions: readonly string[]) {
  return render(
    <LanguageProvider locale="pt" catalog={catalogs.pt}>
      <ProjectionActionButtons
        audience="customer"
        channel="billing"
        recordKey="INV-2026-0781"
        projectionId="projection-1"
        version={3}
        actions={actions}
        roles={["owner"]}
      />
    </LanguageProvider>,
  );
}

/** What `experience-client` throws for a problem+json response. */
function problem(status: number, code: string, title: string) {
  return Object.assign(new Error(title), {
    name: "ExperienceClientError",
    status,
    code,
  });
}

beforeEach(() => {
  mocks.sendProjectionAction.mockResolvedValue(receipt("queued"));
  mocks.readProjectionAction.mockResolvedValue(receipt("queued"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("projection action buttons", () => {
  it("labels commands in operator language instead of server identifiers", () => {
    renderButtons(["mark_uncollectible", "evaluate_dunning"]);

    expect(
      screen.getByRole("button", { name: "Mark uncollectible" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Evaluate dunning" }),
    ).toBeVisible();
    expect(screen.queryByText("mark uncollectible")).not.toBeInTheDocument();
  });

  it("falls back to a humanized identifier for an unmapped action", () => {
    renderButtons(["reopen_dispute"]);

    expect(
      screen.getByRole("button", { name: "reopen dispute" }),
    ).toBeVisible();
  });

  it("separates destructive styling from routine actions", () => {
    renderButtons(["issue", "void"]);

    expect(screen.getByRole("button", { name: "Issue" })).toHaveClass(
      "cw-button--secondary",
    );
    expect(screen.getByRole("button", { name: "Void invoice" })).toHaveClass(
      "cw-button--danger",
    );
  });

  it("requires a confirmation before a destructive command is sent", async () => {
    const user = userEvent.setup();
    renderButtons(["void"]);

    await user.click(screen.getByRole("button", { name: "Void invoice" }));
    expect(mocks.sendProjectionAction).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("Void invoice?", { selector: "*" }),
    ).toBeVisible();
    expect(dialog).toHaveTextContent("INV-2026-0781");
    expect(
      within(dialog).getByRole("button", { name: "Keep the record unchanged" }),
    ).toBeVisible();

    await user.click(
      within(dialog).getByRole("button", { name: "Void invoice" }),
    );
    expect(mocks.sendProjectionAction).toHaveBeenCalledTimes(1);
    expect(mocks.sendProjectionAction.mock.calls[0]?.[0]).toMatchObject({
      action: "void",
      recordKey: "INV-2026-0781",
      expectedVersion: 3,
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "“Void invoice” is queued. Waiting for the authoritative result.",
    );
  });

  it("abandons a destructive command when the confirmation is dismissed", async () => {
    const user = userEvent.setup();
    renderButtons(["void"]);

    await user.click(screen.getByRole("button", { name: "Void invoice" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Keep the record unchanged" }),
    );

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(mocks.sendProjectionAction).not.toHaveBeenCalled();
  });

  it("sends a routine action on a single click", async () => {
    const user = userEvent.setup();
    renderButtons(["issue"]);

    await user.click(screen.getByRole("button", { name: "Issue" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mocks.sendProjectionAction).toHaveBeenCalledTimes(1);
  });

  it("keeps the other actions on the row usable while one command runs", async () => {
    const user = userEvent.setup();
    mocks.sendProjectionAction.mockReturnValue(new Promise(() => undefined));
    renderButtons(["issue", "evaluate_dunning"]);

    await user.click(screen.getByRole("button", { name: "Issue" }));

    expect(screen.getByRole("button", { name: "Submitting…" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Evaluate dunning" }),
    ).toBeEnabled();
  });

  it("reports an unresolved command and offers a re-check instead of leaving it queued", async () => {
    vi.useFakeTimers();
    renderButtons(["issue"]);

    fireEvent.click(screen.getByRole("button", { name: "Issue" }));
    await elapse(15_000);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("“Issue” is still running");
    expect(status).toHaveTextContent("the record may still change");
    expect(mocks.refresh).not.toHaveBeenCalled();

    mocks.readProjectionAction.mockResolvedValue(
      receipt("applied", { authoritativeVersion: 4 }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Check the result again" }),
    );
    await elapse(1_000);

    expect(screen.getByRole("status")).toHaveTextContent(
      "“Issue” was applied at authoritative version 4.",
    );
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("button", { name: "Check the result again" }),
    ).not.toBeInTheDocument();
  });

  it("announces a rejected command as an error rather than a polite status", async () => {
    vi.useFakeTimers();
    mocks.readProjectionAction.mockResolvedValue(
      receipt("rejected", { resultCode: "INVOICE_ALREADY_PAID" }),
    );
    renderButtons(["issue"]);

    fireEvent.click(screen.getByRole("button", { name: "Issue" }));
    await elapse(1_000);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(
      "“Issue” was not applied. The commerce API rejected it with code INVOICE_ALREADY_PAID.",
    );
    expect(alert).toHaveClass("form-message--error");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("announces a version conflict as an error and describes the control", async () => {
    const user = userEvent.setup();
    mocks.sendProjectionAction.mockRejectedValue(
      problem(409, "VERSION_CONFLICT", "Projection record changed"),
    );
    renderButtons(["issue"]);

    await user.click(screen.getByRole("button", { name: "Issue" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "“Issue” was not applied. The record changed. Refresh before retrying.",
    );
    // The API's English problem title is for integrators, not the reader.
    expect(alert).not.toHaveTextContent("Projection record changed");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Issue" })).toHaveAttribute(
        "aria-describedby",
        alert.id,
      ),
    );
  });

  it("marks an applied command as a success status", async () => {
    vi.useFakeTimers();
    mocks.readProjectionAction.mockResolvedValue(
      receipt("applied", { authoritativeVersion: 9 }),
    );
    renderButtons(["issue"]);

    fireEvent.click(screen.getByRole("button", { name: "Issue" }));
    await elapse(1_000);

    expect(screen.getByRole("status")).toHaveClass("form-message--success");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("explains who can act when the role holds no authorized action", () => {
    renderButtons(["void", "issue"], ["member"]);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Read only. An account owner or the assigned approver can act on this record.",
      ),
    ).toBeVisible();
  });

  it("speaks the reader's language for labels, progress and API refusals", async () => {
    const user = userEvent.setup();
    mocks.sendProjectionAction.mockRejectedValue(
      problem(403, "ACTION_FORBIDDEN", "Action is not allowed for this record"),
    );
    renderPortugueseButtons(["evaluate_dunning"]);

    await user.click(
      screen.getByRole("button", { name: "Avaliar régua de cobrança" }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "“Avaliar régua de cobrança” não foi aplicado. Sua função não permite realizar esta ação neste registro.",
    );
    expect(alert).not.toHaveTextContent("Action is not allowed");
  });

  it("names each receipt status in its own sentence rather than inserting the status word", async () => {
    vi.useFakeTimers();
    mocks.readProjectionAction.mockResolvedValue(
      receipt("failed", { resultCode: "PROVIDER_TIMEOUT" }),
    );
    renderPortugueseButtons(["issue"]);

    fireEvent.click(screen.getByRole("button", { name: "Emitir" }));
    await elapse(1_000);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(
      "“Emitir” não foi aplicado. A API comercial informou uma falha com o código PROVIDER_TIMEOUT.",
    );
    expect(alert).not.toHaveTextContent("failed");
  });
});
