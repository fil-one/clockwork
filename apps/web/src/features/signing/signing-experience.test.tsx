import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SigningExperience } from "./signing-experience";

const csrfToken = "12345678901234567890123456789012";

beforeEach(() => {
  document.cookie = `clockwork-csrf=${csrfToken}; path=/`;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.cookie = "clockwork-csrf=; Max-Age=0; path=/";
});

function signingResponse(signingUrl: string) {
  return new Response(
    JSON.stringify({
      id: "envelope-1",
      status: "sent",
      signingUrl,
    }),
    { headers: { "content-type": "application/json" } },
  );
}

describe("e-sign provider navigation", () => {
  it("renders an allowed embedded signing session in a sandboxed frame", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          signingResponse("https://esign.clockwork.test/embedded/envelope-1"),
        ),
      ),
    );
    const user = userEvent.setup();
    render(<SigningExperience mode="embedded" />);

    await user.click(
      screen.getByRole("button", { name: "Start embedded signing" }),
    );
    const frame = await screen.findByTitle("Secure e-sign provider");
    expect(frame).toHaveAttribute(
      "src",
      "https://esign.clockwork.test/embedded/envelope-1",
    );
    expect(frame).toHaveAttribute(
      "sandbox",
      "allow-forms allow-popups allow-same-origin allow-scripts",
    );
    expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
  });

  it("exposes an allowed redirect URL only after the server creates the envelope", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Promise.resolve(
        signingResponse("https://esign.clockwork.test/redirect/envelope-1"),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<SigningExperience mode="redirect" />);

    await user.click(
      screen.getByRole("button", { name: "Continue to secure signing" }),
    );
    const link = await screen.findByRole("link", {
      name: "Continue to the approved e-sign provider",
    });
    expect(link).toHaveAttribute(
      "href",
      "https://esign.clockwork.test/redirect/envelope-1",
    );
    const firstCall = fetchMock.mock.calls.at(0);
    expect(firstCall).toBeDefined();
    if (!firstCall) throw new Error("Signing request was not captured.");
    const request = firstCall[0] as Request;
    expect(request.headers.get("x-csrf-token")).toBe(csrfToken);
    expect(request.headers.get("idempotency-key")).toBeTruthy();
  });

  it("fails closed when the provider returns a URL outside the allow-list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(signingResponse("https://attacker.example/sign")),
      ),
    );
    const user = userEvent.setup();
    render(<SigningExperience mode="redirect" />);

    await user.click(
      screen.getByRole("button", { name: "Continue to secure signing" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "outside the allow-list",
    );
    expect(
      screen.queryByRole("link", {
        name: "Continue to the approved e-sign provider",
      }),
    ).not.toBeInTheDocument();
  });
});
