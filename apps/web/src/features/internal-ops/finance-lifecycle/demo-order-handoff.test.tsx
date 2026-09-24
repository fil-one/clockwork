import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { DemoOrderHandoff } from "./demo-order-handoff";

const order = {
  id: "70000000-0000-4000-8000-000000000001",
  reference: "ORD-2026-0142",
  startsOn: "2026-10-01",
  ready: true,
};

async function submitAnswering(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(Response.json(body, { status }))),
  );
  const user = userEvent.setup();
  render(<DemoOrderHandoff orders={[order]} />);
  await user.click(
    screen.getByRole("button", { name: "Submit to demo provisioner" }),
  );
  return screen.getByRole("status");
}

afterEach(() => vi.unstubAllGlobals());

describe("demo provisioning handoff failures", () => {
  it("says the provisioner refused when the route says so", async () => {
    const status = await submitAnswering(422, {
      code: "DEMO_PROVISIONING_REFUSED",
      detail: "Order is not ready for provisioning",
    });
    expect(status).toHaveTextContent(
      "The demo provisioner refused this order.",
    );
    expect(status).not.toHaveTextContent("not ready for provisioning");
  });

  /**
   * The route also answers 422 for a malformed idempotency key. Keyed on the
   * status, that read as the provisioner refusing the order and sent the
   * operator to reload a page whose order had never reached the provisioner.
   */
  it("does not call another 422 a provisioner refusal", async () => {
    const status = await submitAnswering(422, {
      code: "IDEMPOTENCY_KEY_REQUIRED",
      detail: "A valid idempotency-key header is required",
    });
    expect(status).toHaveTextContent(
      "The provisioning request could not be submitted. Try again.",
    );
  });
});
