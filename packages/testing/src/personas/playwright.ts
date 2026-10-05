import type { BrowserContext, Page } from "@playwright/test";
import { permissionsForRoles } from "@clockwork/contracts";
import type { Permission, Role } from "@clockwork/contracts";

import {
  demoPersonaHeaders,
  demoPersonaSide,
  demoPersonas,
  type DemoPersona,
  type DemoPersonaKey,
} from "./catalog";

export interface DemoSessionProjection {
  readonly userId: string;
  readonly organizationId: string;
  readonly selectedAccountId: string;
  readonly accessibleAccountIds: readonly string[];
  readonly roles: readonly [Role];
  readonly permissions: readonly Permission[];
  readonly mfaVerified: true;
  readonly recentAuthenticationVerified: true;
  readonly isInternalStaff: boolean;
  readonly assistedAccountId?: string;
}

export function demoSessionForPersona(
  personaKey: DemoPersonaKey,
): DemoSessionProjection {
  const persona: DemoPersona = demoPersonas[personaKey];
  return {
    userId: persona.userId,
    organizationId: persona.organizationId,
    selectedAccountId: persona.selectedAccountId,
    accessibleAccountIds: persona.accessibleAccountIds,
    roles: [persona.role],
    permissions: permissionsForRoles([persona.role], {
      side: demoPersonaSide(persona),
    }),
    mfaVerified: true,
    recentAuthenticationVerified: true,
    isInternalStaff: persona.isInternalStaff,
    ...(persona.assistedAccountId
      ? { assistedAccountId: persona.assistedAccountId }
      : {}),
  };
}

/** Applies the same deterministic local-auth headers to Page or BrowserContext. */
export async function applyDemoPersona(
  target: Page | BrowserContext,
  personaKey: DemoPersonaKey,
): Promise<void> {
  await target.setExtraHTTPHeaders(demoPersonaHeaders(personaKey));
}
