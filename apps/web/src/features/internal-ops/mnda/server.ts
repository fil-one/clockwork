import "server-only";
import { MndaRepository } from "@clockwork/db";
import {
  contextHasPermission,
  MndaSignerSchema,
  type Actor,
  type Permission,
} from "@clockwork/contracts";

import { SignWellClient } from "@clockwork/integrations";
import { MndaWorkflow } from "@clockwork/workflows/mnda";
import {
  explicitDemoIdentityEnabled,
  getCommerceSession,
  type CommerceSession,
} from "@/src/auth/session";
import { getServiceDatabase } from "@/src/db/service";

/** Sending, tracking and downloading need `mnda:send`; choosing who may
 * countersign and where notices go needs `signatory:manage`. */
export type MndaPermission = Extract<
  Permission,
  "mnda:send" | "signatory:manage"
>;

/**
 * Every MNDA action and route re-checks the real staff session here. Assisted,
 * impersonated and demo sessions never act on legal documents. Page renders
 * pass the request-cached session reader; actions and route handlers keep the
 * default, which reads the session afresh.
 */
export async function mndaStaff(
  permission: MndaPermission = "mnda:send",
  readSession: () => Promise<CommerceSession> = getCommerceSession,
) {
  const session = await readSession();
  if (
    !session.isInternalStaff ||
    session.impersonation ||
    session.assistedSession ||
    explicitDemoIdentityEnabled()
  )
    throw new Error("MNDA_FORBIDDEN");
  if (!session.mfaVerified) throw new Error("MNDA_MFA_REQUIRED");
  if (!contextHasPermission(session, permission))
    throw new Error("MNDA_FORBIDDEN");
  return session;
}
export type MndaSession = Awaited<ReturnType<typeof mndaStaff>>;
export function mndaCanManage(session: MndaSession) {
  return contextHasPermission(session, "signatory:manage");
}
export const mndaRepository = () => new MndaRepository(getServiceDatabase());
export function mndaConfiguration() {
  return {
    ready:
      process.env.COMMERCE_MNDA_ENABLED === "true" &&
      Boolean(process.env.SIGNWELL_API_KEY && process.env.SIGNWELL_WEBHOOK_ID),
    testMode: process.env.COMMERCE_MNDA_TEST_MODE !== "false",
  };
}
export function mndaWorkflow() {
  const apiKey = process.env.SIGNWELL_API_KEY;
  if (!mndaConfiguration().ready || !apiKey)
    throw new Error("MNDA_NOT_CONFIGURED");
  return new MndaWorkflow(mndaRepository(), new SignWellClient(apiKey));
}
export function mndaActor(session: MndaSession): Actor {
  return { kind: "user", id: session.userId, display: session.profile.name };
}
export async function mndaSigners() {
  return (await mndaRepository().signers()).map(({ version: _, ...signer }) =>
    MndaSignerSchema.parse(signer),
  );
}
