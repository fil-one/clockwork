import { describe, expect, it, vi } from "vitest";

import { translatorFor } from "@/src/i18n/catalogs";

import {
  CommerceApiError,
  executeClickAgreementAs,
  readCoreAccount,
  sendCoreCommand,
} from "./commerce-client";
import {
  commerceErrorText,
  experienceErrorText,
  externalGateErrorText,
} from "./error-text";
import { ExperienceClientError } from "./experience-client";
import { ExternalGateClientError } from "./external-gates-client";

const csrfToken = "c".repeat(40);

describe("reader-language API failures", () => {
  const de = translatorFor("de");

  it("words each commerce failure class in the reader's language, never the English diagnostic", () => {
    const cases: [CommerceApiError, RegExp][] = [
      [new CommerceApiError(403, "forbidden", "x"), /Rolle/u],
      [new CommerceApiError(409, "conflict", "x"), /Datensatz/u],
      [new CommerceApiError(422, "validation", "x"), /Server/u],
      [new CommerceApiError(503, "unavailable", "x"), /Dienst/u],
      [new CommerceApiError(500, "unknown", "x"), /nichts geändert/u],
      [
        new CommerceApiError(403, "forbidden", "x", undefined, "token"),
        /Sicherheitstoken/u,
      ],
      [
        new CommerceApiError(503, "unavailable", "x", undefined, "network"),
        /nicht erreichbar/u,
      ],
      [
        new CommerceApiError(409, "conflict", "x", undefined, "version"),
        /nichts gesendet/u,
      ],
    ];
    for (const [error, expected] of cases)
      expect(commerceErrorText(error, de)).toMatch(expected);
    expect(commerceErrorText(new Error("boom"), de)).toBe(
      de("platform.api.failed"),
    );
  });

  it("marks a client-side refusal so it is not worded as a server refusal", async () => {
    let refused: unknown;
    try {
      void sendCoreCommand(
        { resource: "accounts", id: "a", action: "update", payload: {} },
        { csrfToken: "short", fetchImplementation: vi.fn<typeof fetch>() },
      );
    } catch (error) {
      refused = error;
    }
    expect(refused).toMatchObject({ clientReason: "token" });
    await expect(
      sendCoreCommand(
        { resource: "accounts", id: "a", action: "update", payload: {} },
        {
          csrfToken,
          baseUrl: "https://clockwork.test/api",
          fetchImplementation: () => Promise.reject(new TypeError("offline")),
        },
      ),
    ).rejects.toMatchObject({ clientReason: "network" });
    await expect(
      readCoreAccount("11111111-1111-4111-8111-111111111111", {
        baseUrl: "https://clockwork.test/api",
        fetchImplementation: () =>
          Promise.resolve(Response.json({ items: [], nextCursor: null })),
      }),
    ).rejects.toMatchObject({ clientReason: "version" });
  });

  it("words experience and external-gate failures too", () => {
    const ja = translatorFor("ja");
    expect(
      experienceErrorText(
        new ExperienceClientError(403, "CSRF_MISSING", "x"),
        ja,
      ),
    ).toBe(ja("platform.api.tokenUnavailable"));
    expect(
      experienceErrorText(
        new ExperienceClientError(502, "ARTIFACT_RESPONSE_INVALID", "x"),
        ja,
      ),
    ).toBe(ja("platform.api.documentUnverified"));
    expect(
      externalGateErrorText(new ExternalGateClientError(422, "x"), ja),
    ).toBe(ja("platform.api.gate.policyDenied"));
    expect(
      externalGateErrorText(new ExternalGateClientError(403, "x", "token"), ja),
    ).toBe(ja("platform.api.gate.tokenUnavailable"));
  });
});

describe("click-through acceptance evidence", () => {
  it("records the label the reader pressed and the language it was shown in", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ id: "agreement" }, { status: 201 })),
    );
    await executeClickAgreementAs(
      {
        accountId: "11111111-1111-4111-8111-111111111111",
        templateId: "22222222-2222-4222-8222-222222222222",
        templateVersion: "1.0.0",
        exactText: "Terms",
        exactTextHash: "a".repeat(64),
        authorityTitle: "Diretora financeira",
      },
      { actionLabel: "Aceitar e firmar", locale: "pt-BR" },
      {
        csrfToken,
        baseUrl: "https://clockwork.test/api",
        fetchImplementation,
      },
    );
    const request = fetchImplementation.mock.calls[0]?.[0] as Request;
    const body = (await request.json()) as {
      uiContext: { actionLabel: string; locale: string };
    };
    expect(body.uiContext).toEqual({
      surface: "agreements.execute",
      actionLabel: "Aceitar e firmar",
      locale: "pt-BR",
    });
  });
});
