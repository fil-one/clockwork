import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { catalogs } from "@/src/i18n/catalogs";
import { LanguageProvider } from "@/src/i18n/client";

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
      "The signing provider returned an address outside the approved list, so it was not opened.",
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

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "This signing link does not match a signing session you started.",
    );
    // The server's problem title is English diagnostics, never reader copy.
    expect(alert).not.toHaveTextContent("Signing return state is invalid");
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

  it("offers a way back to the agreement record from every terminal state", async () => {
    for (const state of ["completed", "declined", "expired"] as const) {
      vi.stubGlobal(
        "fetch",
        vi.fn(() => Promise.resolve(returnResponse(state))),
      );
      const view = render(
        <SigningExperience mode="return" returnState="opaque-state" />,
      );

      expect(
        await screen.findByRole("link", { name: "Back to agreements" }),
      ).toHaveAttribute("href", "/agreements");
      view.unmount();
    }
  });

  it("explains the declined and expired outcomes without a dead end", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(returnResponse("declined"))),
    );
    render(<SigningExperience mode="return" returnState="opaque-state" />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Signature declined");
    expect(alert).toHaveTextContent(
      "The agreement remains unchanged. Return to your agreements to decide the next step.",
    );
    expect(
      within(alert).getByRole("link", { name: "Back to agreements" }),
    ).toBeVisible();
  });

  it("scopes the live region to the status text instead of the whole card", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(returnResponse("pending"))),
    );
    const { container } = render(
      <SigningExperience mode="return" returnState="opaque-state" />,
    );

    await screen.findByRole("heading", { name: "Signature pending" });
    const card = container.querySelector(".signing-card");
    expect(card).not.toHaveAttribute("aria-live");
    expect(card?.querySelectorAll("[aria-live]")).toHaveLength(0);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Signature pending");
    expect(status).not.toHaveTextContent("Review and sign");
  });
});

describe("signing in the reader's language", () => {
  it("renders the ceremony and a server refusal in Portuguese, not the server's English", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          Response.json(
            {
              code: "ESIGN_RETURN_EXPIRED",
              title: "Signing return state expired",
            },
            { status: 410 },
          ),
        ),
      ),
    );
    render(
      <LanguageProvider locale="pt" catalog={catalogs.pt}>
        <SigningExperience mode="return" returnState="opaque-state" />
      </LanguageProvider>,
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Não foi possível continuar a assinatura. O acordo permanece inalterado.",
    );
    expect(alert).toHaveTextContent(
      "Este link de assinatura expirou. Recomece pelos seus acordos.",
    );
    expect(alert).not.toHaveTextContent("Signing return state expired");
    expect(
      screen.getByRole("heading", { level: 1, name: "Revisar e assinar" }),
    ).toBeVisible();
    expect(
      within(alert).getByRole("link", { name: "Voltar aos acordos" }),
    ).toHaveAttribute("href", "/agreements");
  });

  it("keeps the agreement reference whole inside the translated sentence", () => {
    render(
      <LanguageProvider locale="fr" catalog={catalogs.fr}>
        <SigningExperience mode="redirect" agreementId={agreementId} />
      </LanguageProvider>,
    );
    expect(
      screen.getByText((_, element) =>
        element?.tagName === "P"
          ? element.textContent ===
            `Référence de l’accord\u00a0: ${agreementId}`
          : false,
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: "Continuer vers la signature sécurisée",
      }),
    ).toBeVisible();
  });
});

const testedSuccessText =
  "Your signed agreement is confirmed and stored with its audit certificate.";
