import { describe, expect, it } from "vitest";
import {
  deriveWorkflowCapabilityProfile,
  disabledWorkflowProvider,
} from "./capability-profile";

describe("capability-aware provider boot", () => {
  it("boots without business providers when every capability is disabled or absent", () => {
    expect(deriveWorkflowCapabilityProfile([])).toEqual({
      capabilities: [],
      providers: [],
      gateKeys: [],
      artifacts: false,
    });
    expect(
      deriveWorkflowCapabilityProfile([
        { capabilityKey: "billing", enabled: false, recoveryEnabled: false },
      ]).providers,
    ).toEqual([]);
  });
  it("retains billing providers for recovery and excludes unrelated signature/identity", () => {
    const profile = deriveWorkflowCapabilityProfile([
      { capabilityKey: "billing", enabled: false, recoveryEnabled: true },
    ]);
    expect(profile.providers).toEqual(
      expect.arrayContaining([
        "billing",
        "tax",
        "accounting",
        "usage",
        "provisioning",
      ]),
    );
    expect(profile.providers).not.toContain("signature");
    expect(profile.providers).not.toContain("workos");
    expect(profile.gateKeys).toContain("EXT-TAX-01");
    expect(profile.artifacts).toBe(true);
  });
  it("direct onboarding does not require future billing and signature providers", () => {
    const profile = deriveWorkflowCapabilityProfile([
      { capabilityKey: "new_business", enabled: true, recoveryEnabled: false },
    ]);
    expect(profile.providers).toEqual([
      "evidence",
      "notifications",
      "screening",
      "workos",
    ]);
    expect(profile.gateKeys).toContain("EXT-LEGAL-01");
    expect(profile.gateKeys).not.toContain("EXT-TAX-01");
  });
  it("fails closed for unknown enabled capability keys", () => {
    expect(() =>
      deriveWorkflowCapabilityProfile([
        { capabilityKey: "constructor", enabled: true, recoveryEnabled: false },
      ]),
    ).toThrow();
    expect(() =>
      deriveWorkflowCapabilityProfile([
        {
          capabilityKey: "future_sales",
          enabled: true,
          recoveryEnabled: false,
        },
      ]),
    ).toThrow("WORKFLOW_CAPABILITY_KEY_INVALID");
  });
  it("disabled nested ports never return success or become thenables", () => {
    const port = disabledWorkflowProvider<{
      billing: { createInvoice(): unknown };
    }>("billing");
    expect(() => port.billing.createInvoice()).toThrow(
      "WORKFLOW_PROVIDER_DISABLED:billing.billing.createInvoice:restart_after_activation",
    );
    expect((port as unknown as { then?: unknown }).then).toBeUndefined();
  });
});
