import Link from "next/link";
import {
  DatabaseSystemCapabilityAdmin,
  capabilityApprovalRole,
  type SystemCapabilityKey,
} from "@clockwork/db";
import { getCommerceSession } from "@/src/auth/session";
import { getOptionalServiceDatabase } from "@/src/db/service";
import {
  AdministrationPage,
  StatusPill,
} from "@/src/features/internal-ops/administration-safety/ui";
import styles from "@/src/features/internal-ops/administration-safety/administration-safety.module.css";
import { CapabilityControls } from "./controls";

export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await getCommerceSession();
  if (!session.isInternalStaff)
    throw new Error("Internal staff authority is required");
  let capabilities: Awaited<
    ReturnType<DatabaseSystemCapabilityAdmin["list"]>
  > | null = null;
  try {
    const db = getOptionalServiceDatabase();
    if (db && session.providerBacked)
      capabilities = await new DatabaseSystemCapabilityAdmin(db).list({
        requestId: `capabilities:${crypto.randomUUID()}`,
      });
  } catch {
    // An unavailable registry cannot be mistaken for disabled or enabled state.
    capabilities = null;
  }
  return (
    <AdministrationPage
      title="Capabilities"
      eyebrow="Production controls"
      description="Request activation with a distinct approver, or immediately stop new work. Recovery work has its own switch."
    >
      <p>
        Activation requires current evidence and a different approver within 24
        hours. External gates are independently enforced on every execution.{" "}
        <Link href="/internal/gates">
          Review external gates and provider tests
        </Link>
        .
      </p>
      {!capabilities ? (
        <section className={styles.panel}>
          <div className={styles.panelBody}>
            <h2>Capability registry unavailable</h2>
            <p>
              Connect the production control database and authenticate with your
              staff identity to inspect or change persisted capabilities. No
              activation is implied.
            </p>
          </div>
        </section>
      ) : capabilities.length === 0 ? (
        <p role="alert">
          No capabilities are configured. All work remains disabled until the
          production bootstrap is complete.
        </p>
      ) : (
        capabilities.map((capability) => (
          <section className={styles.panel} key={capability.capabilityKey}>
            <div className={styles.panelHeading}>
              <div>
                <h2>{capability.capabilityKey.replaceAll("_", " ")}</h2>
                <p>
                  Version {capability.rowVersion} · Changed by{" "}
                  {capability.changedBy}
                </p>
              </div>
              <StatusPill
                state={
                  capability.enabled ? "New work enabled" : "New work disabled"
                }
              />
            </div>
            <div className={styles.panelBody}>
              <p>
                Recovery work:{" "}
                {capability.recoveryEnabled ? "Enabled" : "Disabled"}
              </p>
              <p>{capability.changeReason}</p>
              <p>
                Activation authority:{" "}
                {capabilityApprovalRole(
                  capability.capabilityKey as SystemCapabilityKey,
                ).replaceAll("_", " ")}
              </p>
            </div>
            <CapabilityControls
              capability={capability}
              canOperate={session.roles.includes("internal_operator")}
              canApprove={session.roles.some(
                (role) =>
                  role ===
                  capabilityApprovalRole(
                    capability.capabilityKey as SystemCapabilityKey,
                  ),
              )}
            />
          </section>
        ))
      )}
    </AdministrationPage>
  );
}
