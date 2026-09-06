import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";
import { DatabaseChannelPolicyRepository } from "@clockwork/db";
import {
  legacyChannelDefaults,
  type ChannelPolicySnapshot,
} from "@clockwork/domain/core";
import {
  explicitDemoIdentityEnabled,
  getCommerceSession,
} from "@/src/auth/session";
import { getOptionalServiceDatabase } from "@/src/db/service";
/** An unavailable registry is distinct from an available registry with no approved policy. */
export async function loadChannelPolicy(): Promise<ChannelPolicySnapshot | null> {
  if (explicitDemoIdentityEnabled()) {
    if (!demoDeployIdentityEnabled(process.env))
      return { ...legacyChannelDefaults };
    const { DemoCommercialPolicyRepository } =
      await import("@/src/features/internal-ops/commercial-policies/demo-policies");
    return new DemoCommercialPolicyRepository().active();
  }
  const session = await getCommerceSession();
  if (!session.providerBacked) return null;
  const database = getOptionalServiceDatabase();
  if (!database) return null;
  try {
    return await new DatabaseChannelPolicyRepository(database).active();
  } catch {
    return null;
  }
}
