import "server-only";
import { contextHasPermission } from "@clockwork/contracts";
import {
  explicitDemoIdentityEnabled,
  getCommerceSession,
} from "@/src/auth/session";
import type { DemoMndaViewer } from "./demo-register";

/**
 * The reader of the demo MNDA register, or null outside the demo. Demo
 * personas read fictional records only; `mndaStaff` still refuses every
 * action that would prepare, send or change one.
 */
export async function demoMndaViewer(): Promise<DemoMndaViewer | null> {
  if (!explicitDemoIdentityEnabled()) return null;
  const session = await getCommerceSession();
  if (!session.isInternalStaff || !contextHasPermission(session, "mnda:send"))
    throw new Error("MNDA_FORBIDDEN");
  return {
    id: session.userId,
    name: session.profile.name,
    email: session.profile.email,
  };
}
