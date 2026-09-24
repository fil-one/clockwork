import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { catalogs } from "@/src/i18n/catalogs";
import { LanguageProvider } from "@/src/i18n/client";

import { RegistrationForm } from "./registration-form";

const csrfToken = "12345678901234567890123456789012";
const registrationToken = "workos-registration-code-1234567890";

beforeEach(() => {
  document.cookie = `clockwork-csrf=${csrfToken}; path=/`;
  window.history.replaceState(null, "", `/register?code=${registrationToken}`);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.cookie = "clockwork-csrf=; Max-Age=0; path=/";
});

describe("organization registration", () => {
  it("submits the complete generated registration contract and clears the code from the URL", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Promise.resolve(
        new Response(
          JSON.stringify({ id: "organization-1", status: "pending" }),
          {
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<RegistrationForm initialRegistrationToken={registrationToken} />);

    expect(window.location.pathname).toBe("/register");
    expect(window.location.search).toBe("");
    await user.type(
      screen.getByLabelText("Legal entity name"),
      "Northstar Labs",
    );
    await user.type(
      screen.getByLabelText("Verified work email"),
      "buyer@northstar.example",
    );
    await user.type(
      screen.getByLabelText("Business domain"),
      "northstar.example",
    );
    await user.type(screen.getByLabelText("Registered address"), "100 Main St");
    await user.type(screen.getByLabelText("City"), "Boston");
    await user.type(screen.getByLabelText(/State or region/), "MA");
    await user.type(screen.getByLabelText("Postal code"), "02110");
    await user.type(screen.getByLabelText("Billing contact name"), "Maya Chen");
    await user.type(
      screen.getByLabelText("Billing contact email"),
      "billing@northstar.example",
    );
    await user.type(
      screen.getByLabelText("Invoice delivery email"),
      "ap@northstar.example",
    );
    await user.click(
      screen.getByRole("button", { name: "Register organization" }),
    );

    expect(await screen.findByText("Registration accepted")).toBeVisible();
    expect(fetchMock).toHaveBeenCalledOnce();
    const firstCall = fetchMock.mock.calls.at(0);
    expect(firstCall).toBeDefined();
    if (!firstCall) throw new Error("Registration request was not captured.");
    const request = firstCall[0] as Request;
    expect(request.url).toContain("/api/v1/lifecycle/registrations");
    expect(request.headers.get("x-csrf-token")).toBe(csrfToken);
    expect(request.headers.get("idempotency-key")).toBeTruthy();
    await expect(request.clone().json()).resolves.toMatchObject({
      legalName: "Northstar Labs",
      country: "US",
      businessDomain: "northstar.example",
      registrantEmail: "buyer@northstar.example",
      registrationToken,
      relationshipRoles: ["direct_client"],
      registeredAddress: {
        line1: "100 Main St",
        city: "Boston",
        region: "MA",
        postalCode: "02110",
        country: "US",
      },
      billingContact: {
        name: "Maya Chen",
        email: "billing@northstar.example",
      },
      apContact: null,
      invoiceDeliveryEmail: "ap@northstar.example",
      taxIds: [],
    });
  });

  it("requires a one-time WorkOS code when no redirect context is present", () => {
    render(<RegistrationForm initialRegistrationToken="" />);
    expect(screen.getByLabelText("WorkOS registration code")).toBeRequired();
  });

  it("renders every label, option and refusal in the reader's language", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(() =>
        Promise.resolve(
          Response.json(
            { code: "FORBIDDEN", detail: "Registrant is not allowed" },
            { status: 403 },
          ),
        ),
      ),
    );
    const user = userEvent.setup();
    const { container } = render(
      <LanguageProvider locale="pt" catalog={catalogs.pt}>
        <RegistrationForm initialRegistrationToken="" />
      </LanguageProvider>,
    );

    expect(
      screen.getByLabelText("Código de cadastro do WorkOS"),
    ).toBeRequired();
    expect(screen.getByLabelText("Razão social")).toBeRequired();
    const country = screen.getByLabelText("País");
    expect(
      Array.from(
        country.querySelectorAll("option"),
        (option) => option.textContent,
      ),
    ).toEqual(["Espanha", "Estados Unidos", "Reino Unido"]);
    expect(country).toHaveValue("US");
    expect(
      screen.getByRole("option", { name: "Cliente direto" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cadastrar organização" }),
    ).toBeVisible();
    for (const english of [
      "Legal entity name",
      "Optional",
      "United States",
      "Already registered",
      "AP contact",
    ])
      expect(container).not.toHaveTextContent(english);

    await user.type(
      screen.getByLabelText("Código de cadastro do WorkOS"),
      registrationToken,
    );
    await user.type(screen.getByLabelText("Razão social"), "Northstar Labs");
    await user.type(
      screen.getByLabelText("E-mail corporativo verificado"),
      "buyer@northstar.example",
    );
    await user.type(
      screen.getByLabelText("Domínio da empresa"),
      "northstar.example",
    );
    await user.type(screen.getByLabelText("Endereço da sede"), "100 Main St");
    await user.type(screen.getByLabelText("Cidade"), "Boston");
    await user.type(screen.getByLabelText("Código postal"), "02110");
    await user.type(
      screen.getByLabelText("Nome do contato de faturamento"),
      "Maya Chen",
    );
    await user.type(
      screen.getByLabelText("E-mail do contato de faturamento"),
      "billing@northstar.example",
    );
    await user.type(
      screen.getByLabelText("E-mail para envio de faturas"),
      "ap@northstar.example",
    );
    await user.type(
      screen.getByLabelText(/Nome do contato de contas a pagar/),
      "Elias Romero",
    );
    await user.click(
      screen.getByRole("button", { name: "Cadastrar organização" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Informe o nome e o e-mail do contato de contas a pagar, ou deixe os dois em branco.",
    );

    await user.type(
      screen.getByLabelText(/E-mail do contato de contas a pagar/),
      "ap-team@northstar.example",
    );
    await user.click(
      screen.getByRole("button", { name: "Cadastrar organização" }),
    );
    const refusal = await screen.findByRole("alert");
    expect(refusal).toHaveTextContent(
      "O cadastro falhou. Nenhuma organização foi criada. Sua função ou sessão atual não permite esta ação.",
    );
    expect(refusal).not.toHaveTextContent("Registrant is not allowed");
  });
});
