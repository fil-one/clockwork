import { permissionsForRoles } from "@clockwork/contracts";
import { describe, expect, it } from "vitest";

import { demoPersonas, demoPersonaSide } from "./catalog";
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

  it("projects one commerce role and what it allows on the persona's side", () => {
    for (const key of Object.keys(demoPersonas) as Array<
      keyof typeof demoPersonas
    >) {
      const session = demoSessionForPersona(key);
      expect(session.roles).toEqual([demoPersonas[key].role]);
      expect(session.permissions).toEqual(
        permissionsForRoles([demoPersonas[key].role], {
          side: demoPersonaSide(demoPersonas[key]),
        }),
      );
      expect(session.mfaVerified).toBe(true);
      expect(session.recentAuthenticationVerified).toBe(true);
    }
  });

  it("registers deals for the referral partner without the partner quote", () => {
    const referral = demoSessionForPersona("referralPartner");
    expect(referral.permissions).toContain("deal:register");
    expect(referral.permissions).not.toContain("partner:quote:write");
    expect(demoSessionForPersona("reseller").permissions).toContain(
      "partner:quote:write",
    );
  });
});
