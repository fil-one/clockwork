import { describe, expect, it } from "vitest";

import {
  demoPersonaHeaders,
  demoPersonas,
  type DemoPersonaKind,
} from "./catalog";

describe("demo persona catalog", () => {
  it("covers every launch journey persona", () => {
    const kinds = new Set<DemoPersonaKind>(
      Object.values(demoPersonas).map(({ kind }) => kind),
    );

    expect(kinds).toEqual(
      new Set<DemoPersonaKind>([
        "direct_buyer",
        "referral_partner",
        "reseller",
        "distributor",
        "end_client",
        "billing_user",
        "legal_approver",
        "finance_approver",
        "internal_operator",
      ]),
    );
  });

  it("uses only visibly fictional identities and stable auth headers", () => {
    for (const [key, persona] of Object.entries(demoPersonas)) {
      expect(persona.email).toMatch(/\.test$/);
      expect(persona.mfaVerified).toBe(true);
      expect(persona.startRoute).toMatch(/^\/(client|partner|internal)/);
      expect(demoPersonaHeaders(key as keyof typeof demoPersonas)).toEqual({
        "x-clockwork-account": persona.selectedAccountId,
        "x-clockwork-mfa": "true",
        "x-clockwork-persona": persona.role,
      });
    }
  });

  it("keeps customer and partner personas separate from internal membership", () => {
    for (const persona of Object.values(demoPersonas)) {
      if (persona.isInternalStaff) {
        expect(persona.accessibleAccountIds).toHaveLength(0);
      } else {
        expect(persona.accessibleAccountIds).toContain(
          persona.selectedAccountId,
        );
      }
    }
  });
});
