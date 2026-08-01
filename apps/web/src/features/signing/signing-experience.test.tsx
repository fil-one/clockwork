import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SigningExperience } from "./signing-experience";

const csrfToken = "12345678901234567890123456789012";
const agreementId = "99999999-9999-4999-8999-999999999999";

beforeEach(() => {
  document.cookie = `clockwork-csrf=${csrfToken}; path=/`;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.cookie = "clockwork-csrf=; Max-Age=0; path=/";
});

function signingResponse(signingUrl: string) {
  return Response.json({
    envelopeId: "88888888-8888-4888-8888-888888888888",
    status: "pending",
    signingUrl,
    returnState: "opaque-return-state",
  });
}

function returnResponse(
  state: "pending" | "completed" | "declined" | "expired" | "failed",
) {
  return Response.json({
    state,
    envelopeId: "88888888-8888-4888-8888-888888888888",
    agreementId,
    documentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    signedDocumentId:
      state === "completed" ? "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" : null,
    completionCertificateDocumentId: null,
    updatedAt: "2026-07-31T12:00:00.000Z",
  });
}

async function enterAgreement(user: ReturnType<typeof userEvent.setup>) {
  await user.type(
    screen.getByRole("textbox", { name: "Agreement ID" }),
    agreementId,
  );
}

describe("authoritative e-sign experience", () => {
  it("sends only the persisted agreement reference and renders an allowed embedded session", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        signingResponse("https://esign.clockwork.test/embedded/envelope-1"),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<SigningExperience mode="embedded" />);
    await enterAgreement(user);

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
      "allow-forms allow-popups allow-scripts",
    );
    expect(frame.getAttribute("sandbox")).not.toContain("allow-same-origin");
    const requestInit = fetchMock.mock.calls[0]?.[1];
    const requestBody =
      typeof requestInit?.body === "string" ? requestInit.body : "";
    expect(JSON.parse(requestBody)).toEqual({ agreementId, mode: "embedded" });
    expect(requestBody).not.toMatch(/signer|document|account/i);
  });

  it("exposes an allowed redirect URL only after the authoritative server launch", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        signingResponse("https://esign.clockwork.test/redirect/envelope-1"),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<SigningExperience mode="redirect" />);
    await enterAgreement(user);

    await user.click(
      screen.getByRole("button", { name: "Continue to secure signing" }),
    );
    expect(
      await screen.findByRole("link", {
        name: "Continue to the approved e-sign provider",
      }),
    ).toHaveAttribute(
      "href",
      "https://esign.clockwork.test/redirect/envelope-1",
    );
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("x-csrf-token")).toBe(csrfToken);
    expect(headers.get("idempotency-key")).toBeTruthy();
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
    await enterAgreement(user);

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

  it("never infers completion from the browser return and fails an altered state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          Response.json(
            {
              code: "ESIGN_RETURN_NOT_FOUND",
              title: "Signing return state is invalid",
            },
            { status: 404 },
          ),
        ),
      ),
    );
    render(<SigningExperience mode="return" returnState="altered-state" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Signing return state is invalid",
    );
    expect(screen.queryByText(testedSuccessText)).not.toBeInTheDocument();
  });

  it("reconciles callback ordering through pending then completed server status", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(returnResponse("pending"))
      .mockResolvedValueOnce(returnResponse("completed"));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<SigningExperience mode="return" returnState="opaque-state" />);

    expect(
      await screen.findByRole("heading", { name: "Signature pending" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Download signed agreement" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Refresh status" }));
    expect(
      await screen.findByRole("link", { name: "Download signed agreement" }),
    ).toHaveAttribute(
      "href",
      "/api/experience/esign/returns/opaque-state/signed-document",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

const testedSuccessText =
  "Your signed agreement is confirmed and stored with its audit certificate.";
