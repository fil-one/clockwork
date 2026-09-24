import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { catalogs } from "@/src/i18n/catalogs";
import { LanguageProvider } from "@/src/i18n/client";
import type { Locale } from "@/src/i18n/locales";

import { AppShell } from "./app-shell";
import type { RouteSession } from "./route-session";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
  }),
}));
vi.mock("@/src/auth/actions", () => ({
  switchCommerceAccount: vi.fn(() => Promise.resolve({ ok: true })),
}));
vi.mock("@/src/auth/sign-out", () => ({ signOutCommerceSession: vi.fn() }));

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const session: RouteSession = {
  roles: ["owner"],
  profile: { name: "Maya Chen", email: "owner@northstar.test" },
  locale: "pt-BR",
  timeZone: "UTC",
  memberships: [
    {
      userId: "20000000-0000-4000-8000-000000000002",
      userName: "Maya Chen",
      userEmail: "owner@northstar.test",
      isInternalStaff: false,
      organizationId: "30000000-0000-4000-8000-000000000001",
      workosOrganizationId: "org_local_northstar",
      organizationName: "Northstar Production",
      accountId: "10000000-0000-4000-8000-000000000001",
      accountName: "Northstar Archive Labs",
      role: "owner",
      audience: "customer",
      home: "/dashboard",
    },
  ],
  selectedAccountId: "10000000-0000-4000-8000-000000000001",
  effectiveAccountId: "10000000-0000-4000-8000-000000000001",
  providerBacked: false,
  authenticationSource: "local",
};

function renderShell(locale: Locale) {
  return render(
    <LanguageProvider locale={locale} catalog={catalogs[locale]}>
      <AppShell audience="customer" session={session}>
        <main id="main-content">
          <h1>Painel</h1>
        </main>
      </AppShell>
    </LanguageProvider>,
  );
}

describe("shell chrome in the reader's language", () => {
  it("names the product and translates every landmark, footer and shortcut in Portuguese", async () => {
    renderShell("pt");
    // The product name is never translated ("Comércio" was the defect).
    expect(
      screen.getByRole("link", { name: "Fil One Commerce" }),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Comércio/u);
    expect(
      screen.getByRole("region", { name: "Status do aplicativo" }),
    ).toBeInTheDocument();
    // The company takes the feminine article in Portuguese.
    expect(
      screen.getByText(
        "Os registros comerciais da Fil One são sincronizados a partir do registro operacional.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Atalho de teclado: ⌘K ou Ctrl+K"),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Abrir menu de comandos" }),
    );
    const palette = await screen.findByRole("dialog");
    expect(
      within(palette).getByRole("button", {
        name: "Fechar a paleta de comandos",
      }),
    ).toBeInTheDocument();
    expect(within(palette).getByText("Navegar")).toBeInTheDocument();
    for (const english of [/Close command palette/u, /\bMove\b/u, /Select/u])
      expect(palette.textContent ?? "").not.toMatch(english);
  });

  it("uses the German key name and no English landmark names in German", () => {
    renderShell("de");
    expect(screen.getByText("⌘/Strg K")).toBeInTheDocument();
    for (const element of document.querySelectorAll("[aria-label]"))
      expect(element.getAttribute("aria-label")).not.toMatch(
        /Application status|Primary|Open navigation|Skip to/u,
      );
  });
});
