import "server-only";
import { MndaRepository } from "@clockwork/db";
import { MndaSignerSchema, type Actor } from "@clockwork/contracts";
import { SignWellClient } from "@clockwork/integrations";
import { MndaWorkflow } from "@clockwork/workflows/mnda";
import {
  explicitDemoIdentityEnabled,
  getCommerceSession,
} from "@/src/auth/session";
import { getServiceDatabase } from "@/src/db/service";

export async function mndaStaff(manage = false) {
  const session = await getCommerceSession();
  if (
    !session.isInternalStaff ||
    !session.mfaVerified ||
    session.impersonation ||
    session.assistedSession ||
    explicitDemoIdentityEnabled() ||
    !session.roles.some((r) =>
      ["internal_operator", "finance_approver", "legal_approver"].includes(r),
    )
  )
    throw new Error("MNDA_FORBIDDEN");
  if (
    manage &&
    !session.roles.some((r) =>
      ["internal_operator", "finance_approver", "legal_approver"].includes(r),
    )
  )
    throw new Error("MNDA_FORBIDDEN");
  return session;
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
export function mndaActor(
  session: Awaited<ReturnType<typeof mndaStaff>>,
): Actor {
  return { kind: "user", id: session.userId, display: session.profile.name };
}
export async function mndaSigners() {
  return (await mndaRepository().signers()).map(({ version: _, ...signer }) =>
    MndaSignerSchema.parse(signer),
  );
}
