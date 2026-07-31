import { describe, expect, it } from "vitest";

import { demoPersonas } from "./catalog";
import { demoSessionForPersona } from "./playwright";

describe("demo session projection", () => {
  it("keeps actual internal identity distinct from an assisted account", () => {
    const session = demoSessionForPersona("internalOperator");

    expect(session.isInternalStaff).toBe(true);
    expect(session.accessibleAccountIds).toHaveLength(0);
    expect(session.assistedAccountId).toBe(
      demoPersonas.internalOperator.selectedAccountId,
    );
  });

  it("projects one authoritative commerce role without deriving permissions", () => {
    for (const key of Object.keys(demoPersonas) as Array<
      keyof typeof demoPersonas
    >) {
      const session = demoSessionForPersona(key);
      expect(session.roles).toEqual([demoPersonas[key].role]);
      expect(session.mfaVerified).toBe(true);
      expect(session.recentAuthenticationVerified).toBe(true);
    }
  });
});
