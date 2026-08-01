import { describe, expect, it, vi } from "vitest";

import {
  ExternalGateClientError,
  readGeneratedExternalGates,
  runGeneratedExternalGateActivationTest,
  updateGeneratedExternalGate,
} from "./external-gates-client";

describe("generated external-gate client", () => {
  it("reads the generated system contract", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        Response.json({
          items: [
            {
              id: "90000000-0000-4000-8000-000000000001",
              gateKey: "EXT-ACC-01",
              title: "Hosted accounts and credentials",
              owner: "Platform owner",
              inputRequired: "Scoped hosted credentials",
              affectedFeature: "Hosted runtime",
              severity: "path_blocker",
              configuredStatus: "blocked",
              effectiveStatus: "blocked",
              simulatorState: "ready",
              simulatorDetails: "Provider simulator ready",
              lastActivationTestStatus: "never",
              lastActivationTestAt: null,
              lastActivationTestedBy: null,
              activationEvidenceReference: null,
              reviewOn: null,
              statusReason: "Production credentials pending",
              activationAllowed: false,
              blockedReasons: ["activation_test_not_passed"],
              rowVersion: 1,
              updatedAt: "2026-07-31T15:00:00Z",
            },
          ],
        }),
      ),
    );
    await expect(
      readGeneratedExternalGates(
        "https://clockwork.test/api",
        fetchImplementation,
      ),
    ).resolves.toMatchObject([{ gateKey: "EXT-ACC-01" }]);
    const request = fetchImplementation.mock.calls[0]?.[0];
    expect(request).toBeInstanceOf(Request);
    expect(new URL((request as Request).url).pathname).toBe(
      "/api/v1/system/external-gates",
    );
  });

  it("sends optimistic update authority through the generated operation", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        Response.json({
          id: "90000000-0000-4000-8000-000000000001",
          gateKey: "EXT-LEGAL-01",
          title: "Counsel-approved legal policy",
          owner: "General counsel",
          inputRequired: "Approved hashes and counsel evidence",
          affectedFeature: "Agreement publication",
          severity: "launch_blocker",
          configuredStatus: "active",
          effectiveStatus: "blocked",
          simulatorState: "ready",
          simulatorDetails: "Legal hash test is ready",
          lastActivationTestStatus: "never",
          lastActivationTestAt: null,
          lastActivationTestedBy: null,
          activationEvidenceReference: null,
          reviewOn: "2026-08-31",
          statusReason: "Counsel evidence has been supplied",
          activationAllowed: false,
          blockedReasons: ["activation_test_not_passed"],
          rowVersion: 5,
          updatedAt: "2026-07-31T16:00:00Z",
        }),
      ),
    );
    await expect(
      updateGeneratedExternalGate(
        "EXT-LEGAL-01",
        {
          expectedRowVersion: 4,
          owner: "General counsel",
          inputRequired: "Approved hashes and counsel evidence",
          configuredStatus: "active",
          reviewOn: "2026-08-31",
          statusReason: "Counsel evidence has been supplied",
        },
        {
          baseUrl: "https://clockwork.test/api",
          fetchImplementation,
          csrfToken: "c".repeat(32),
          idempotencyKey: "gate-update-legal-0001",
        },
      ),
    ).resolves.toMatchObject({
      configuredStatus: "active",
      effectiveStatus: "blocked",
      activationAllowed: false,
    });
    const request = fetchImplementation.mock.calls[0]?.[0] as Request;
    expect(request.method).toBe("PUT");
    expect(request.headers.get("x-csrf-token")).toBe("c".repeat(32));
    expect(request.headers.get("idempotency-key")).toBe(
      "gate-update-legal-0001",
    );
    await expect(request.clone().json()).resolves.toMatchObject({
      expectedRowVersion: 4,
      configuredStatus: "active",
    });
  });

  it("surfaces a stale activation test without retrying", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(null, { status: 409 })),
    );
    let thrown: unknown;
    try {
      await runGeneratedExternalGateActivationTest("EXT-BRAND-01", 3, {
        baseUrl: "https://clockwork.test/api",
        fetchImplementation,
        csrfToken: "c".repeat(32),
        idempotencyKey: "gate-test-brand-0001",
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ExternalGateClientError);
    if (!(thrown instanceof ExternalGateClientError))
      throw new Error("Expected an ExternalGateClientError");
    expect(thrown.status).toBe(409);
    expect(thrown.message).toMatch(/changed.*reload/i);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });
});
