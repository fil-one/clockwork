import { createHash } from "node:crypto";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { catalogs } from "@/src/i18n/catalogs";
import { LanguageProvider } from "@/src/i18n/client";

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("@/src/features/contracts/commerce-client", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  executeClickAgreementAs: mocks.execute,
}));

import { AgreementAcceptance } from "./agreement-acceptance";

const exactText = "Customer services agreement, version 2.1.0.";

const template = {
  id: "22222222-2222-4222-8222-222222222222",
  type: "csa",
  semanticVersion: "2.1.0",
  jurisdiction: "US",
  effectiveOn: "2026-07-01",
  canonicalDocumentId: "33333333-3333-4333-8333-333333333333",
  exactText,
  exactTextHash: createHash("sha256").update(exactText).digest("hex"),
  executionMode: "click_through" as const,
};

beforeEach(() => {
  mocks.execute.mockReset().mockResolvedValue({ id: "agreement" });
});

describe("click-through acceptance evidence", () => {
  /**
   * The server keeps the pressed control's label and the page language as
   * evidence of what the signer agreed to. The surface used to call the
   * helper that always records "Accept and execute" in English, so a
   * Portuguese signer's acceptance was evidenced by words they never saw.
   */
  it("records the label the signer pressed, in the language they read", async () => {
    const user = userEvent.setup();
    render(
      <LanguageProvider catalog={catalogs.pt} locale="pt">
        <AgreementAcceptance
          account={{
            id: "11111111-1111-4111-8111-111111111111",
            name: "Northstar Archive Labs",
          }}
          demoTemplate={template}
        />
      </LanguageProvider>,
    );

    await user.type(
      screen.getByLabelText("Cargo do signatário"),
      "Diretora financeira",
    );
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Aceitar e firmar" }));

    await vi.waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(1));
    await screen.findByRole("link", {
      name: "Abrir o registro do acordo firmado",
    });
    expect(mocks.execute.mock.calls[0]?.[1]).toEqual({
      actionLabel: "Aceitar e firmar",
      locale: "pt-BR",
    });
  });
});
