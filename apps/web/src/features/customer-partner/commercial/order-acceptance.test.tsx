import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  sendCoreCommand: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock("@/src/features/contracts/commerce-client", () => ({
  sendCoreCommand: mocks.sendCoreCommand,
}));

import { OrderAcceptance, type AcceptableQuote } from "./order-acceptance";

const account = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "Northstar Archive Labs",
};
const quote: AcceptableQuote = {
  id: "40000000-0000-4000-8000-000000000001",
  reference: "Q-2026-0165-v2",
  title: "Compliance replica renewal",
  version: "2",
  scope: "120 TB · UK South · annual · direct",
  spend: "$55,440.00",
  acceptedLabel: "Accepted Jul 25",
};

function renderSurface(
  overrides: Partial<Parameters<typeof OrderAcceptance>[0]> = {},
) {
  return render(
    <OrderAcceptance
      account={account}
      agreement={{ title: "Cloud Service Agreement", version: "3.2" }}
      orderFormDocumentId={null}
      quote={quote}
      signerUserId="20000000-0000-4000-8000-000000000002"
      {...overrides}
    />,
  );
}

beforeEach(() => {
  mocks.sendCoreCommand.mockResolvedValue({});
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("order acceptance", () => {
  it("presents the binding promise chain before the acceptance inputs", () => {
    renderSurface();

    const chain = screen.getByRole("list", {
      name: "Commercial promise chain",
    });
    expect(chain).toHaveTextContent(
      "Accepted quote Q-2026-0165-v2 · version 2",
    );
    expect(chain).toHaveTextContent("Order authority and service start");
    expect(chain).toHaveTextContent(
      "Service commitment and provisioning state",
    );
    expect(
      screen.getByRole("group", { name: "Acceptance inputs" }),
    ).toBeVisible();
  });

  it("leaves every binding acceptance input blank", () => {
    renderSurface();

    expect(screen.getByLabelText("Purchase order")).toHaveValue("");
    expect(screen.getByLabelText("Service start")).toHaveValue("");
    expect(screen.getByLabelText("Authority title")).toHaveValue("");
  });

  it("announces the first missing acceptance input and moves focus to it", async () => {
    const user = userEvent.setup();
    renderSurface();

    const purchaseOrder = screen.getByLabelText("Purchase order");
    await user.click(
      screen.getByRole("button", {
        name: "Accept order and create commitment",
      }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter the purchase order reference.",
    );
    expect(purchaseOrder).toHaveFocus();
    expect(purchaseOrder).toHaveAttribute("aria-invalid", "true");
  });

  it("requires the explicit commitment confirmation after valid inputs", async () => {
    const user = userEvent.setup();
    renderSurface();

    await user.type(screen.getByLabelText("Purchase order"), "PO-NA-1092");
    await user.type(screen.getByLabelText("Service start"), "2026-08-15");
    await user.type(
      screen.getByLabelText("Authority title"),
      "Chief Operating Officer",
    );
    await user.click(
      screen.getByRole("button", {
        name: "Accept order and create commitment",
      }),
    );

    const confirmation = screen.getByRole("checkbox");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Confirm the reviewed commitment before accepting.",
    );
    expect(confirmation).toHaveFocus();
    expect(confirmation).toHaveAttribute("aria-invalid", "true");
    expect(confirmation).toHaveAttribute(
      "aria-describedby",
      "order-validation",
    );
  });

  it("offers no acceptance action without an acceptable quote", () => {
    renderSurface({ quote: null });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "No acceptable quote is selected",
    );
    expect(
      screen.queryByRole("button", {
        name: "Accept order and create commitment",
      }),
    ).not.toBeInTheDocument();
  });
});

const orderFormDocumentId = "80000000-0000-4000-8000-000000000001";

const acceptLabel = "Accept order and create commitment";
const createLabel = "Create the order and commitment";

/** The order-form poll sleeps a second between attempts, so tests drive it. */
async function elapse(milliseconds: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

function fillAcceptanceInputs() {
  fireEvent.change(screen.getByLabelText("Purchase order"), {
    target: { value: "PO-NA-1092" },
  });
  fireEvent.change(screen.getByLabelText("Service start"), {
    target: { value: "2026-08-15" },
  });
  fireEvent.change(screen.getByLabelText("Authority title"), {
    target: { value: "Chief Operating Officer" },
  });
  fireEvent.click(screen.getByRole("checkbox"));
}

/** Dispatches an event and lets the component's promise chain settle. */
async function settled(dispatch: () => void) {
  await act(async () => {
    dispatch();
    await Promise.resolve();
  });
}

async function submitFirstPass() {
  await settled(() => {
    fireEvent.click(screen.getByRole("button", { name: acceptLabel }));
  });
}

function commandCall(index: number) {
  const call = mocks.sendCoreCommand.mock.calls[index] as [
    {
      resource: string;
      id: string;
      action: string;
      payload: Record<string, unknown>;
    },
    { idempotencyKey: string },
  ];
  return { command: call[0], options: call[1] };
}

/**
 * P0-68's second half. The two-pass design is the contract -- acceptance can
 * only be recorded against an order form that exists -- but the first pass
 * used to end at a message that disabled the submit for good, with no refresh
 * and no polling, so completing the commitment meant navigating away and
 * re-keying the purchase order, service start and authority title.
 *
 * Every assertion below fails against that code: it never calls
 * `router.refresh()`, its submit is disabled on `Boolean(message)` and so
 * stays disabled after the document arrives, and it replays one idempotency
 * key across two different actions and payloads.
 */
describe("order acceptance two-pass bridge", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("asks the server to render the order form on the first pass", async () => {
    renderSurface();
    fillAcceptanceInputs();

    await submitFirstPass();

    expect(mocks.sendCoreCommand).toHaveBeenCalledTimes(1);
    expect(commandCall(0).command.action).toBe("prepare_artifact");
    expect(commandCall(0).command.payload).not.toHaveProperty(
      "orderFormDocumentId",
    );
  });

  it("polls for the rendered form instead of stranding the reader", async () => {
    renderSurface();
    fillAcceptanceInputs();

    await submitFirstPass();
    await elapse(3_000);

    expect(mocks.refresh).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: acceptLabel })).toBeDisabled();
  });

  it("releases the create pass when the document prop arrives, keeping every entry", async () => {
    const view = renderSurface();
    fillAcceptanceInputs();
    await submitFirstPass();
    await elapse(2_000);

    // What `router.refresh()` produces: the same client component, re-rendered
    // with a server prop it did not have before.
    await settled(() => {
      view.rerender(
        <OrderAcceptance
          account={account}
          agreement={{ title: "Cloud Service Agreement", version: "3.2" }}
          orderFormDocumentId={orderFormDocumentId}
          quote={quote}
          signerUserId="20000000-0000-4000-8000-000000000002"
        />,
      );
    });

    const create = screen.getByRole("button", { name: createLabel });
    expect(create).toBeEnabled();
    expect(screen.getByLabelText("Purchase order")).toHaveValue("PO-NA-1092");
    expect(screen.getByLabelText("Service start")).toHaveValue("2026-08-15");
    expect(screen.getByLabelText("Authority title")).toHaveValue(
      "Chief Operating Officer",
    );
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(screen.queryByText(/Order form requested/)).not.toBeInTheDocument();
  });

  it("creates under a fresh idempotency key against the same order", async () => {
    const view = renderSurface();
    fillAcceptanceInputs();
    await submitFirstPass();
    await elapse(2_000);
    await settled(() => {
      view.rerender(
        <OrderAcceptance
          account={account}
          agreement={{ title: "Cloud Service Agreement", version: "3.2" }}
          orderFormDocumentId={orderFormDocumentId}
          quote={quote}
          signerUserId="20000000-0000-4000-8000-000000000002"
        />,
      );
    });

    await settled(() => {
      fireEvent.click(screen.getByRole("button", { name: createLabel }));
    });

    expect(mocks.sendCoreCommand).toHaveBeenCalledTimes(2);
    const first = commandCall(0);
    const second = commandCall(1);
    expect(second.command.action).toBe("create");
    expect(second.command.payload.orderFormDocumentId).toBe(
      orderFormDocumentId,
    );
    // Same order aggregate, so the second pass completes the first one's work.
    expect(second.command.id).toBe(first.command.id);
    // Different key, because the action and the payload differ. Replaying the
    // prepare key here is the write an idempotency store exists to refuse.
    expect(second.options.idempotencyKey).not.toBe(
      first.options.idempotencyKey,
    );
    expect(second.options.idempotencyKey).toEqual(expect.any(String));
  });

  it("reports an unresolved order form rather than a completed acceptance", async () => {
    renderSurface();
    fillAcceptanceInputs();
    await submitFirstPass();

    await elapse(30_000);

    expect(
      screen.getByText(/The order form has not been rendered yet/),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: acceptLabel })).toBeDisabled();
    expect(mocks.sendCoreCommand).toHaveBeenCalledTimes(1);
  });

  it("offers a recheck once polling gives up", async () => {
    renderSurface();
    fillAcceptanceInputs();
    await submitFirstPass();
    await elapse(30_000);
    const polls = mocks.refresh.mock.calls.length;

    await settled(() => {
      fireEvent.click(
        screen.getByRole("button", { name: "Check for the order form again" }),
      );
    });

    expect(mocks.refresh.mock.calls.length).toBeGreaterThan(polls);
  });

  /**
   * The disable condition has to key on "no further pass is available", never
   * on a message. Editing a bound input invalidates the prepared form, so the
   * prepare pass becomes available again -- a control that stayed disabled
   * here would block legitimate work.
   */
  it("returns the prepare pass to the reader after an input is corrected", async () => {
    renderSurface();
    fillAcceptanceInputs();
    await submitFirstPass();
    await elapse(30_000);

    fireEvent.change(screen.getByLabelText("Purchase order"), {
      target: { value: "PO-NA-1093" },
    });

    expect(screen.getByRole("button", { name: acceptLabel })).toBeEnabled();
    expect(
      screen.queryByText(/The order form has not been rendered yet/),
    ).not.toBeInTheDocument();
  });

  it("leaves the same pass available after the server refuses the command", async () => {
    mocks.sendCoreCommand.mockRejectedValueOnce(new Error("Quote is expired"));
    renderSurface();
    fillAcceptanceInputs();

    await submitFirstPass();

    expect(screen.getByRole("alert")).toHaveTextContent("Quote is expired");
    expect(screen.getByRole("button", { name: acceptLabel })).toBeEnabled();
  });

  it("closes the surface once the order exists", async () => {
    renderSurface({ orderFormDocumentId });
    fillAcceptanceInputs();

    await settled(() => {
      fireEvent.click(screen.getByRole("button", { name: createLabel }));
    });

    expect(screen.getByRole("button", { name: createLabel })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Order created");
  });
});

/**
 * A truncated channel read means the quote and the agreement on this page were
 * chosen from a prefix. The reader is the one committing money against them,
 * so the incompleteness is disclosed rather than absorbed.
 */
describe("order acceptance under a truncated read", () => {
  it("discloses that the records shown are a prefix", () => {
    renderSurface({ partialRead: true });

    expect(
      screen.getByText(/more commercial records than one page/),
    ).toBeVisible();
  });

  it("says nothing when every record was read", () => {
    renderSurface();

    expect(
      screen.queryByText(/more commercial records than one page/),
    ).not.toBeInTheDocument();
  });
});
