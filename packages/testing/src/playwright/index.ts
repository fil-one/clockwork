import type { BrowserContext, Page } from "@playwright/test";

export const playwrightPersonas = {
  directOwner: {
    role: "owner",
    accountId: "10000000-0000-4000-8000-000000000001",
  },
  partnerAdmin: {
    role: "partner_admin",
    accountId: "10000000-0000-4000-8000-000000000002",
  },
  billing: {
    role: "billing",
    accountId: "10000000-0000-4000-8000-000000000001",
  },
  internalOperator: {
    role: "internal_operator",
    accountId: "10000000-0000-4000-8000-000000000001",
  },
  legalApprover: {
    role: "legal_approver",
    accountId: "10000000-0000-4000-8000-000000000001",
  },
} as const;

export async function applyPersona(
  target: Page | BrowserContext,
  persona: keyof typeof playwrightPersonas,
) {
  const value = playwrightPersonas[persona];
  await target.setExtraHTTPHeaders({
    "x-clockwork-persona": value.role,
    "x-clockwork-account": value.accountId,
    "x-clockwork-mfa": "true",
  });
}
