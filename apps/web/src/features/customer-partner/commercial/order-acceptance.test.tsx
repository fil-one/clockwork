import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
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
      quote={quote}
      signerUserId="20000000-0000-4000-8000-000000000002"
      {...overrides}
    />,
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.fetch.mockResolvedValue(
    new Response(JSON.stringify({ code: "ARTIFACT_NOT_FOUND" }), {
      status: 404,
      headers: { "content-type": "application/problem+json" },
    }),
  );
  mocks.sendCoreCommand.mockResolvedValue(prepareResponse("demo"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
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
    expect(screen.getByLabelText("Service end")).toHaveValue("");
    expect(screen.getByLabelText("Authority title")).toHaveValue("");
  });

  it("states that the purchase order cannot replace the pinned quote and agreement terms", () => {
    renderSurface();

    const purchaseOrder = screen.getByLabelText("Purchase order");
    expect(purchaseOrder).toHaveAccessibleDescription(
      /issued quote Q-2026-0165-v2 version 2 and Cloud Service Agreement version 3.2/u,
    );
    expect(purchaseOrder).toHaveAccessibleDescription(
      /does not replace or change those pinned terms/u,
    );
    expect(screen.getByText(/retained for 7 years/u)).toBeVisible();
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

  /**
   * The order form cannot be rendered without a service end:
   * `orderArtifactDefinition` throws `COMMERCIAL_ARTIFACT_ORDER_TERM_REQUIRED`
   * before it reads anything else, on both branches of `mutateOrder`. The form
   * that shipped collected a start and no end, so its first pass was refused
   * against every real database and no document ever existed for the bridge to
   * find.
   */
  it("asks for the service end the order form cannot be rendered without", async () => {
    const user = userEvent.setup();
    renderSurface();

    await user.type(screen.getByLabelText("Purchase order"), "PO-NA-1092");
    await user.type(screen.getByLabelText("Service start"), "2026-08-15");
    await user.click(
      screen.getByRole("button", {
        name: "Accept order and create commitment",
      }),
    );

    const serviceEnd = screen.getByLabelText("Service end");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Choose the service end date.",
    );
    expect(serviceEnd).toHaveFocus();
    expect(serviceEnd).toHaveAttribute("aria-invalid", "true");
  });

  /** `acceptOrder` refuses `end < serviceStartsOn`; the form says so first. */
  it("refuses a service end that precedes the service start", async () => {
    const user = userEvent.setup();
    renderSurface();

    await user.type(screen.getByLabelText("Purchase order"), "PO-NA-1092");
    await user.type(screen.getByLabelText("Service start"), "2026-08-15");
    await user.type(screen.getByLabelText("Service end"), "2026-08-14");
    await user.click(
      screen.getByRole("button", {
        name: "Accept order and create commitment",
      }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Choose a service end on or after the service start date.",
    );
    expect(screen.getByLabelText("Service end")).toHaveFocus();
    expect(mocks.sendCoreCommand).not.toHaveBeenCalled();
  });

  it("requires the explicit commitment confirmation after valid inputs", async () => {
    const user = userEvent.setup();
    renderSurface();

    await user.type(screen.getByLabelText("Purchase order"), "PO-NA-1092");
    await user.type(screen.getByLabelText("Service start"), "2026-08-15");
    await user.type(screen.getByLabelText("Service end"), "2027-08-14");
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
/**
 * The artifact request the document was stored against. It is a different
 * identifier from the document, and it is the one the download route resolves,
 * so the "open the order form" link is asserted against this rather than the
 * document identifier the create pass quotes.
 */
const orderFormArtifactId = "80000000-0000-4000-8000-0000000000a1";

const acceptLabel = "Accept order and create commitment";
const createLabel = "Create the order and commitment";
const recheckLabel = "Check for the order form again";

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
  fireEvent.change(screen.getByLabelText("Service end"), {
    target: { value: "2027-08-14" },
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

/** The order identifier the prepare pass named. */
function preparedOrderId(): string {
  return commandCall(0).command.id;
}

/**
 * What the artifact renderer produces: a stored document, bound to the order
 * the prepare pass named. The lookup is keyed on that order identifier, so the
 * server cannot answer for any other one -- which is the property the old
 * projection-derived prop did not have.
 */
function storeOrderForm() {
  mocks.fetch.mockImplementation(() => Promise.resolve(storedArtifact()));
}

function prepareResponse(shape: "production" | "demo") {
  return {
    record: {
      data:
        shape === "production"
          ? { artifactRequest: { requestId: orderFormArtifactId } }
          : { artifactRequestId: orderFormArtifactId },
    },
  };
}

function storedArtifact(overrides: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      id: orderFormArtifactId,
      kind: "order_form",
      subjectType: "order",
      subjectId: preparedOrderId(),
      documentId: orderFormDocumentId,
      ...overrides,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
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
 * P0-68's second half, third attempt.
 *
 * The first attempt ended the prepare pass at a message that disabled the
 * submit for good. The second polled `router.refresh()` for a server prop the
 * page derived from the orders channel -- and that prop can never carry this
 * document. `orders:prepare_artifact` writes no order row: `mutateOrder`'s
 * create branch is the only writer of `public.orders` and of
 * `orders.order_form_document_id`, and `authoritative-state.ts` projects the
 * order channel from `public.orders`. The one row that channel could ever
 * match is an order that has *already* been created, bound to a different
 * order identifier and to entries this reader never typed.
 *
 * So the bridge now asks the server about the artifact request the prepare
 * response actually returned.
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

  it.each(["production", "demo"] as const)(
    "polls the bodyless artifact GET for the %s prepare response",
    async (shape) => {
      mocks.sendCoreCommand.mockResolvedValueOnce(prepareResponse(shape));
      mocks.fetch.mockImplementation(() => Promise.resolve(storedArtifact()));
      renderSurface();
      fillAcceptanceInputs();

      await submitFirstPass();
      await elapse(2_000);

      expect(mocks.fetch).toHaveBeenCalledWith(
        `/api/experience/artifacts/order_form/${orderFormArtifactId}?representation=json`,
        {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
          headers: { accept: "application/json" },
        },
      );
      expect(screen.getByRole("button", { name: createLabel })).toBeEnabled();
    },
  );

  it.each([
    ["kind", { kind: "invoice" }],
    ["subject type", { subjectType: "quote" }],
    ["artifact id", { id: "80000000-0000-4000-8000-0000000000b2" }],
    ["order subject", { subjectId: "50000000-0000-4000-8000-000000000099" }],
    ["document id", { documentId: "not-a-uuid" }],
  ])(
    "refuses a stored representation with a mismatched %s",
    async (_, mismatch) => {
      mocks.sendCoreCommand.mockResolvedValueOnce(
        prepareResponse("production"),
      );
      mocks.fetch.mockImplementation(() =>
        Promise.resolve(storedArtifact(mismatch)),
      );
      renderSurface();
      fillAcceptanceInputs();

      await submitFirstPass();
      await elapse(2_000);

      expect(mocks.fetch).toHaveBeenCalled();
      expect(
        screen.getByText(/cannot confirm whether the order form was rendered/),
      ).toBeVisible();
      expect(
        screen.queryByRole("button", { name: createLabel }),
      ).not.toBeInTheDocument();
    },
  );

  it("keeps polling when the bodyless artifact GET reports pending", async () => {
    mocks.sendCoreCommand.mockResolvedValueOnce(prepareResponse("demo"));
    renderSurface();
    fillAcceptanceInputs();

    await submitFirstPass();
    await elapse(2_000);

    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: acceptLabel })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      /order form requested/i,
    );
  });

  it.each([
    ["missing", {}],
    [
      "malformed",
      { record: { data: { artifactRequestId: "../server-action" } } },
    ],
  ])(
    "fails closed when the prepare response has a %s artifact request id",
    async (_, response) => {
      mocks.sendCoreCommand.mockResolvedValueOnce(response);
      renderSurface();
      fillAcceptanceInputs();

      await submitFirstPass();

      expect(mocks.fetch).not.toHaveBeenCalled();
      expect(
        screen.getByText(/cannot confirm whether the order form was rendered/),
      ).toBeVisible();
      expect(
        screen.queryByRole("button", { name: createLabel }),
      ).not.toBeInTheDocument();
    },
  );

  it.each([401, 403])(
    "stops polling when the artifact GET returns %s",
    async (status) => {
      mocks.fetch.mockResolvedValue(new Response(null, { status }));
      renderSurface();
      fillAcceptanceInputs();

      await submitFirstPass();
      await elapse(2_000);

      expect(mocks.fetch).toHaveBeenCalledOnce();
      expect(
        screen.getByText(/cannot confirm whether the order form was rendered/),
      ).toBeVisible();
    },
  );

  it("uses the same seven-year retention rule the ceremony states", async () => {
    renderSurface();
    fillAcceptanceInputs();

    await submitFirstPass();

    const payload = commandCall(0).command.payload;
    const acceptedAt = new Date(String(payload.acceptedAt));
    const retainUntil = new Date(String(payload.retainUntil));
    expect(retainUntil.getUTCFullYear()).toBe(acceptedAt.getUTCFullYear() + 7);
    expect(retainUntil.getUTCMonth()).toBe(acceptedAt.getUTCMonth());
    expect(retainUntil.getUTCDate()).toBe(acceptedAt.getUTCDate());
  });

  /**
   * The whole bridge rests on this. Replayed against the local authoritative
   * database, the payload without `serviceEndsOn` is refused with
   * `COMMERCIAL_ARTIFACT_ORDER_TERM_REQUIRED` and the same payload with it
   * stores an order form; so a first pass that omits the field produces no
   * document, and everything downstream of it is unreachable regardless of how
   * the client polls.
   */
  it("sends the service term on both passes, so the order form can be rendered", async () => {
    renderSurface();
    fillAcceptanceInputs();
    await submitFirstPass();
    storeOrderForm();
    await elapse(2_000);

    await settled(() => {
      fireEvent.click(screen.getByRole("button", { name: createLabel }));
    });

    for (const index of [0, 1]) {
      expect(commandCall(index).command.payload).toMatchObject({
        serviceStartsOn: "2026-08-15",
        serviceEndsOn: "2027-08-14",
      });
    }
  });

  it("polls for the order it prepared, not for whatever the account holds", async () => {
    renderSurface();
    fillAcceptanceInputs();

    await submitFirstPass();
    await elapse(3_000);

    expect(mocks.fetch).toHaveBeenCalledWith(
      `/api/experience/artifacts/order_form/${orderFormArtifactId}?representation=json`,
      expect.objectContaining({ method: "GET", cache: "no-store" }),
    );
    expect(screen.getByRole("button", { name: acceptLabel })).toBeDisabled();
  });

  it("releases the create pass once the form is stored, keeping every entry", async () => {
    renderSurface();
    fillAcceptanceInputs();
    await submitFirstPass();

    storeOrderForm();
    await elapse(2_000);

    const create = screen.getByRole("button", { name: createLabel });
    expect(create).toBeEnabled();
    expect(screen.getByLabelText("Purchase order")).toHaveValue("PO-NA-1092");
    expect(screen.getByLabelText("Service start")).toHaveValue("2026-08-15");
    expect(screen.getByLabelText("Authority title")).toHaveValue(
      "Chief Operating Officer",
    );
    expect(screen.getByRole("checkbox")).toBeChecked();
  });

  /**
   * The paper, before the signature.
   *
   * The create pass is a binding acceptance OF a document, and the surface used
   * to complete it without ever offering the document. The link is keyed on the
   * artifact identifier rather than the document identifier the create pass
   * quotes, because the download route resolves the former and would answer the
   * latter with nothing.
   */
  it("offers the rendered order form before the create pass", async () => {
    renderSurface();
    fillAcceptanceInputs();
    await submitFirstPass();

    expect(
      screen.queryByRole("link", { name: "Open the order form" }),
    ).toBeNull();

    storeOrderForm();
    await elapse(2_000);

    expect(
      screen.getByRole("link", { name: "Open the order form" }),
    ).toHaveAttribute(
      "href",
      `/api/experience/artifacts/order_form/${orderFormArtifactId}`,
    );
  });

  it("withdraws the order form when a bound entry changes", async () => {
    renderSurface();
    fillAcceptanceInputs();
    await submitFirstPass();
    storeOrderForm();
    await elapse(2_000);

    await settled(() => {
      fireEvent.change(screen.getByLabelText("Purchase order"), {
        target: { value: "PO-NA-1093" },
      });
    });

    expect(
      screen.queryByRole("link", { name: "Open the order form" }),
    ).toBeNull();
  });

  it("creates under a fresh idempotency key against the same order", async () => {
    renderSurface();
    fillAcceptanceInputs();
    await submitFirstPass();
    storeOrderForm();
    await elapse(2_000);

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
    // Same order aggregate, so the second pass completes the first one's work
    // and the document's `subject_id` binding still holds.
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

  /**
   * Two claims this surface used to make to the reader, both false.
   *
   * "Come back to this page later to finish" cannot happen: the order form is
   * hashed over the acceptance instant, the purchase order, the service period
   * and the signing title, and the instant is minted per mount and stored
   * nowhere. A later visit can only start a new attempt.
   *
   * "Track this acceptance in orders" pointed at a ledger that cannot show it:
   * `orders:prepare_artifact` writes no `public.orders` row, and the orders
   * channel projects `public.orders`.
   */
  it("promises no resumption and no order ledger entry before the order exists", async () => {
    renderSurface();
    fillAcceptanceInputs();
    await submitFirstPass();
    await elapse(30_000);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Leaving this page ends this attempt");
    expect(status).not.toHaveTextContent(/come back to this page later/i);
    expect(
      screen.queryByRole("link", { name: "Track this acceptance in orders" }),
    ).not.toBeInTheDocument();
  });

  it("links to the order only once the order exists", async () => {
    renderSurface();
    fillAcceptanceInputs();
    await submitFirstPass();
    storeOrderForm();
    await elapse(2_000);

    await settled(() => {
      fireEvent.click(screen.getByRole("button", { name: createLabel }));
    });

    expect(
      screen.getByRole("link", { name: "Open the created order" }),
    ).toBeVisible();
  });

  it("offers a recheck once polling gives up, and completes on it", async () => {
    renderSurface();
    fillAcceptanceInputs();
    await submitFirstPass();
    await elapse(30_000);

    storeOrderForm();
    await settled(() => {
      fireEvent.click(screen.getByRole("button", { name: recheckLabel }));
    });
    await elapse(2_000);

    expect(screen.getByRole("button", { name: createLabel })).toBeEnabled();
  });

  /**
   * A lookup that cannot be answered is not the same as one that says "not
   * yet". Telling the reader to keep waiting for a form this deployment will
   * never render is the failure mode the third state exists to prevent.
   */
  it("says so when the server cannot answer at all", async () => {
    renderSurface();
    fillAcceptanceInputs();
    await submitFirstPass();

    mocks.fetch.mockResolvedValue(new Response(null, { status: 503 }));
    await elapse(2_000);

    expect(
      screen.getByText(/cannot confirm whether the order form was rendered/),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: recheckLabel })).toBeEnabled();
    expect(mocks.sendCoreCommand).toHaveBeenCalledTimes(1);
  });

  /** A dropped request costs one attempt, never the whole acceptance. */
  it("keeps waiting when one artifact GET fails", async () => {
    renderSurface();
    fillAcceptanceInputs();
    await submitFirstPass();

    mocks.fetch.mockRejectedValueOnce(new Error("network"));
    await elapse(2_000);
    storeOrderForm();
    await elapse(2_000);

    expect(screen.getByRole("button", { name: createLabel })).toBeEnabled();
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
    renderSurface();
    fillAcceptanceInputs();
    await submitFirstPass();
    storeOrderForm();
    await elapse(2_000);

    await settled(() => {
      fireEvent.click(screen.getByRole("button", { name: createLabel }));
    });

    expect(
      screen.queryByRole("button", { name: createLabel }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Order created");
  });

  it.each([
    null,
    {
      ...quote,
      id: "40000000-0000-4000-8000-000000000099",
      title: "Different next quote",
    },
  ])(
    "keeps the created order receipt when refresh changes the selected quote (%j)",
    async (nextQuote) => {
      const view = renderSurface();
      fillAcceptanceInputs();
      await submitFirstPass();
      storeOrderForm();
      await elapse(2_000);
      await settled(() => {
        fireEvent.click(screen.getByRole("button", { name: createLabel }));
      });
      const href = screen
        .getByRole("link", { name: "Open the created order" })
        .getAttribute("href");
      expect(mocks.refresh).toHaveBeenCalled();

      view.rerender(
        <OrderAcceptance
          account={account}
          agreement={{ title: "Cloud Service Agreement", version: "3.2" }}
          quote={nextQuote}
          signerUserId="20000000-0000-4000-8000-000000000002"
        />,
      );

      expect(screen.getByRole("status")).toHaveTextContent("Order created");
      expect(
        screen.getByRole("link", { name: "Open the created order" }),
      ).toHaveAttribute("href", href);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(
        screen.queryByText("Different next quote"),
      ).not.toBeInTheDocument();
      expect(mocks.sendCoreCommand).toHaveBeenCalledTimes(2);
    },
  );
});

/**
 * P0-68, refuted twice. The server binds the create pass to the order the
 * document was prepared for and to the entries it was rendered from. Three
 * places in the database prove the reader's screen is not enough:
 *
 * 1. `assertCommercialArtifactBinding` (packages/db/src/repositories/core/
 *    commercial-artifacts.ts) selects the request row by `(document_id,
 *    subject_type, subject_id, source_hash, status='stored')`. `subject_id` is
 *    the order identifier the *prepare* pass named.
 * 2. `mutateOrder`'s create branch recomputes `orderArtifactDefinition` from
 *    the command it is handed and passes that definition's `sourceHash` to the
 *    binding check. The definition carries the purchase-order number, the
 *    service period and the signing title.
 * 3. Neither has any tolerance: a mismatch on either is
 *    `COMMERCIAL_ARTIFACT_BINDING_INVALID`, and the refusal releases no further
 *    pass, so the reader is left with a form they can never submit.
 */
describe("order acceptance binds the form to the order it was prepared for", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("returns to a prepare pass when a bound entry changes after the form arrives", async () => {
    renderSurface();
    fillAcceptanceInputs();
    await submitFirstPass();
    storeOrderForm();
    await elapse(2_000);
    const prepared = preparedOrderId();
    expect(screen.getByRole("button", { name: createLabel })).toBeEnabled();

    // The purchase-order number is rendered into the order form and hashed
    // into the request. Changing it makes the held document evidence for
    // entries that are no longer on screen.
    fireEvent.change(screen.getByLabelText("Purchase order"), {
      target: { value: "PO-NA-1093" },
    });

    expect(screen.getByRole("button", { name: acceptLabel })).toBeEnabled();
    await settled(() => {
      fireEvent.click(screen.getByRole("button", { name: acceptLabel }));
    });

    const second = commandCall(1);
    expect(second.command.action).toBe("prepare_artifact");
    expect(second.command.payload).not.toHaveProperty("orderFormDocumentId");
    // A new prepare is a new order. Reusing the identifier the first form was
    // bound to would leave two requests fighting over one subject.
    expect(second.command.id).not.toBe(prepared);
  });

  /**
   * The answer that arrives after the reader has moved on describes an order
   * this acceptance is no longer being made under. Applying it would release a
   * create pass bound to a superseded order.
   */
  it("discards an answer for an order the reader has already superseded", async () => {
    renderSurface();
    fillAcceptanceInputs();
    await submitFirstPass();

    storeOrderForm();
    fireEvent.change(screen.getByLabelText("Purchase order"), {
      target: { value: "PO-NA-1093" },
    });
    await elapse(5_000);

    expect(screen.getByRole("button", { name: acceptLabel })).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: createLabel }),
    ).not.toBeInTheDocument();
  });

  /**
   * The service end is rendered into the order form and hashed into the
   * request exactly as the purchase order is, so changing it after the form
   * arrives has to invalidate the create pass too.
   */
  it("returns to a prepare pass when the service term changes after the form arrives", async () => {
    renderSurface();
    fillAcceptanceInputs();
    await submitFirstPass();
    storeOrderForm();
    await elapse(2_000);
    expect(screen.getByRole("button", { name: createLabel })).toBeEnabled();

    fireEvent.change(screen.getByLabelText("Service end"), {
      target: { value: "2028-08-14" },
    });

    expect(screen.getByRole("button", { name: acceptLabel })).toBeEnabled();
    await settled(() => {
      fireEvent.click(screen.getByRole("button", { name: acceptLabel }));
    });
    expect(commandCall(1).command.action).toBe("prepare_artifact");
    expect(commandCall(1).command.payload).toMatchObject({
      serviceEndsOn: "2028-08-14",
    });
  });

  /**
   * A keystroke while the prepare pass is still on the wire used to null the
   * order identifier the resumed code then recorded and polled for, which put
   * the surface into the unanswerable state behind a control that could only
   * reproduce it.
   */
  it("records nothing and polls for nothing when an entry changes mid-command", async () => {
    let release: (value: unknown) => void = () => {};
    mocks.sendCoreCommand.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderSurface();
    fillAcceptanceInputs();
    await settled(() => {
      fireEvent.click(screen.getByRole("button", { name: acceptLabel }));
    });

    fireEvent.change(screen.getByLabelText("Purchase order"), {
      target: { value: "PO-NA-1093" },
    });
    await settled(() => release({}));
    await elapse(30_000);

    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: acceptLabel })).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: recheckLabel }),
    ).not.toBeInTheDocument();
  });

  it("never creates under an order the document was not bound to", async () => {
    renderSurface();
    fillAcceptanceInputs();
    await submitFirstPass();
    storeOrderForm();
    await elapse(2_000);
    const prepared = preparedOrderId();

    await settled(() => {
      fireEvent.click(screen.getByRole("button", { name: createLabel }));
    });

    const create = commandCall(1);
    expect(create.command.action).toBe("create");
    expect(create.command.id).toBe(prepared);
    expect(create.command.payload.orderFormDocumentId).toBe(
      orderFormDocumentId,
    );
  });
});

/**
 * A truncated channel read means the quote and the agreement on this page were
 * chosen from a prefix. The reader is the one committing money against them,
 * so the incompleteness is disclosed rather than absorbed.
 */
describe("order acceptance review panel", () => {
  it("shows both ends of the term the reader is committing to", () => {
    renderSurface();
    fillAcceptanceInputs();

    const summary = screen
      .getByRole("heading", { name: "Review before accepting" })
      .closest("aside");
    expect(summary).not.toBeNull();
    expect(summary).toHaveTextContent("Service start2026-08-15");
    expect(summary).toHaveTextContent("Service end2027-08-14");
    expect(
      screen.getByRole("checkbox", {
        name: /service start, service end, and resulting commitment/u,
      }),
    ).toBeVisible();
  });
});

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
