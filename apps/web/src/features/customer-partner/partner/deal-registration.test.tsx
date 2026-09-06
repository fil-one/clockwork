import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DealRegistrationContext } from "./deal-registration-model";

const sendCoreCommand =
  vi.fn<(input: unknown, options?: unknown) => Promise<unknown>>();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/src/features/contracts/commerce-client", () => ({
  sendCoreCommand: (input: unknown, options?: unknown) =>
    sendCoreCommand(input, options),
}));

const { DealRegistration, RegistrationDirectoryUnavailable } =
  await import("./deal-registration");

const context: DealRegistrationContext = {
  partnerAccountId: "8f6bb5c6-4f0a-4a2b-9f2d-4c0f1c9b7d31",
  partnerAccountName: "Redwood Channel Group",
  endClients: [
    { id: "5e6f7a8b-1111-4111-8111-111111111111", name: "Juniper Health" },
  ],
};

beforeEach(() => {
  refresh.mockReset();
  sendCoreCommand.mockReset();
  sendCoreCommand.mockResolvedValue({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function fillValidRegistration(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("combobox", { name: "End client" }));
  await user.click(screen.getByRole("option", { name: "Juniper Health" }));
  await user.type(screen.getByLabelText("Workload"), "Immutable archive");
  await user.type(screen.getByLabelText("Expected volume (TB)"), "120");
}

/**
 * Spec §6 and §14 put deal registration on the partner desk, and until this
 * surface existed the only code that could send `deal_registrations create`
 * was a workflow-panel branch mounted on no route at all. Every assertion here
 * is about the command actually leaving the browser with identifiers the
 * server can bind.
 */
describe("deal registration", () => {
  it("sends the create command with the resolved account identifiers", async () => {
    const user = userEvent.setup();
    render(<DealRegistration context={context} />);

    await fillValidRegistration(user);
    await user.click(screen.getByRole("button", { name: "Register the deal" }));

    expect(sendCoreCommand).toHaveBeenCalledOnce();
    const [input, options] = sendCoreCommand.mock.calls[0] ?? [];
    expect(input).toMatchObject({
      resource: "deal_registrations",
      action: "create",
      accountId: context.partnerAccountId,
      payload: {
        partnerAccountId: context.partnerAccountId,
        endClientAccountId: "5e6f7a8b-1111-4111-8111-111111111111",
        workload: "Immutable archive",
        expectedVolume: "120",
        protectionDays: 90,
      },
    });
    expect(
      typeof (options as { idempotencyKey?: unknown }).idempotencyKey,
    ).toBe("string");
    expect(await screen.findByText(/Registration submitted/i)).toHaveAttribute(
      "role",
      "status",
    );
    expect(refresh).toHaveBeenCalledOnce();
  });

  /**
   * The surface promises to protect opportunities "without exposing raw
   * account identifiers", and no partner is shown an account UUID anywhere
   * else on the desk. The end client is therefore named, and the identifier
   * comes from the server-resolved list.
   */
  it("submits the selected account when two end clients share a name", async () => {
    const user = userEvent.setup();
    const duplicate = {
      id: "5e6f7a8b-1111-4111-8111-222222222222",
      name: "Juniper Health",
    };
    render(
      <DealRegistration
        context={{ ...context, endClients: [...context.endClients, duplicate] }}
      />,
    );
    await user.click(screen.getByRole("combobox", { name: "End client" }));
    const second = screen.getAllByRole("option", { name: "Juniper Health" })[1];
    if (!second) throw new Error("Missing second client option");
    await user.click(second);
    await user.type(
      screen.getByLabelText("Workload"),
      "Distinct account archive",
    );
    await user.type(screen.getByLabelText("Expected volume (TB)"), "20");
    await user.click(screen.getByRole("button", { name: "Register the deal" }));
    const [input] = sendCoreCommand.mock.calls[0] ?? [];
    expect(input).toMatchObject({
      payload: { endClientAccountId: duplicate.id },
    });
  });

  it("never asks the partner to type an account identifier", () => {
    render(<DealRegistration context={context} />);
    expect(screen.queryByLabelText(/account id/i)).toBeNull();
    const field = screen.getByLabelText("End client");
    expect(field).toHaveValue("");
    expect(field).toBeEnabled();
  });

  /**
   * `QuantitySchema` is a bare decimal. The deleted panel branch defaulted the
   * field to `120 TB`, which the command refuses, so the refusal has to happen
   * where the seller can fix it and nothing may be posted.
   */
  it("refuses an expected volume with a unit before anything is sent", async () => {
    const user = userEvent.setup();
    render(<DealRegistration context={context} />);

    await user.click(screen.getByRole("combobox", { name: "End client" }));
    await user.click(screen.getByRole("option", { name: "Juniper Health" }));
    await user.type(screen.getByLabelText("Workload"), "Immutable archive");
    await user.type(screen.getByLabelText("Expected volume (TB)"), "120 TB");
    await user.click(screen.getByRole("button", { name: "Register the deal" }));

    expect(sendCoreCommand).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent("no unit");
  });

  it("reports a refused command as a failure and keeps the draft submittable", async () => {
    sendCoreCommand.mockRejectedValueOnce(
      new Error("Deal registration decision context is unavailable"),
    );
    const user = userEvent.setup();
    render(<DealRegistration context={context} />);

    await fillValidRegistration(user);
    await user.click(screen.getByRole("button", { name: "Register the deal" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "decision context is unavailable",
    );
    expect(
      screen.getByRole("button", { name: "Register the deal" }),
    ).toBeEnabled();
  });

  /**
   * A retry after a failure has to replay the same registration rather than
   * open a second protection window against the same opportunity.
   */
  it("replays one registration identity across a retry", async () => {
    sendCoreCommand.mockRejectedValueOnce(new Error("Network unreachable"));
    const user = userEvent.setup();
    render(<DealRegistration context={context} />);

    await fillValidRegistration(user);
    const submit = screen.getByRole("button", { name: "Register the deal" });
    await user.click(submit);
    await screen.findByRole("alert");
    await user.click(submit);

    expect(sendCoreCommand).toHaveBeenCalledTimes(2);
    const first = sendCoreCommand.mock.calls[0];
    const second = sendCoreCommand.mock.calls[1];
    expect((second?.[0] as { id: string }).id).toBe(
      (first?.[0] as { id: string }).id,
    );
    expect(second?.[1]).toEqual(first?.[1]);
  });

  /**
   * A registration binds an existing account row. With nothing to bind, the
   * surface says so rather than rendering a picker over an empty list above a
   * Submit that would post an end client the database has never heard of.
   */
  it("names an empty end-client list instead of rendering a dead form", () => {
    render(<DealRegistration context={{ ...context, endClients: [] }} />);
    expect(
      screen.getByText(/No end client is available to register/i),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Register the deal" }),
    ).toBeNull();
  });

  /**
   * An unreadable directory is a statement about the deployment, not about the
   * partner's relationships, and the two must not share a sentence.
   */
  it("distinguishes an unreadable directory from an empty one", () => {
    render(<RegistrationDirectoryUnavailable />);
    expect(
      screen.getByText(/Registration is unavailable on this deployment/i),
    ).toBeVisible();
    expect(screen.queryByText(/No end client is available/i)).toBeNull();
  });
});
