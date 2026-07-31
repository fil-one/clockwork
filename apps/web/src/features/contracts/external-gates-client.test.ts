import { describe, expect, it, vi } from "vitest";

import { readGeneratedExternalGates } from "./external-gates-client";

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
});
