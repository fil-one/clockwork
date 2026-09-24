import type { Metadata } from "next";
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
import type { MessageId, Translator } from "@/src/i18n";
import { getTranslations } from "@/src/i18n/server";
import { richText } from "@/src/i18n/rich";
import { CapabilityControls } from "./controls";

export const dynamic = "force-dynamic";

const capabilityLabels: Readonly<Record<SystemCapabilityKey, MessageId>> = {
  new_business: "adminGovernance.capabilities.key.newBusiness",
  legal: "adminGovernance.capabilities.key.legal",
  billing: "adminGovernance.capabilities.key.billing",
  partner: "adminGovernance.capabilities.key.partner",
  marketplace: "adminGovernance.capabilities.key.marketplace",
  teardown: "adminGovernance.capabilities.key.teardown",
};

const roleLabels: Readonly<Record<string, MessageId>> = {
  internal_operator: "role.internalOperator",
  finance_approver: "role.financeApprover",
  legal_approver: "role.legalApprover",
  destructive_action_approver: "role.destructiveActionApprover",
};

/** A stored key as a label; an unknown key is shown as stored. */
function keyLabel(
  t: Translator,
  labels: Readonly<Record<string, MessageId>>,
  key: string,
): string {
  const id = Object.hasOwn(labels, key) ? labels[key] : undefined;
  return id ? t(id) : key.replaceAll("_", " ");
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("adminGovernance.capabilities.title") };
}

export default async function Page() {
  const session = await getCommerceSession();
  if (!session.isInternalStaff)
    // i18n-exempt: thrown to the route's error boundary, which shows its own copy
    throw new Error("Internal staff authority is required");
  const t = await getTranslations();
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
      title={t("adminGovernance.capabilities.title")}
      eyebrow={t("adminGovernance.capabilities.eyebrow")}
      description={t("adminGovernance.capabilities.description")}
    >
      <p>
        {richText(t, "common.join.sentences", {
          first: t("adminGovernance.capabilities.guidance"),
          second: (
            <Link href="/internal/gates">
              {t("adminGovernance.capabilities.reviewGates")}
            </Link>
          ),
        })}
      </p>
      {!capabilities ? (
        <section className={styles.panel}>
          <div className={styles.panelBody}>
            <h2>{t("adminGovernance.capabilities.unavailable")}</h2>
            <p>{t("adminGovernance.capabilities.unavailableDetail")}</p>
          </div>
        </section>
      ) : capabilities.length === 0 ? (
        <p role="alert">{t("adminGovernance.capabilities.none")}</p>
      ) : (
        capabilities.map((capability) => (
          <section className={styles.panel} key={capability.capabilityKey}>
            <div className={styles.panelHeading}>
              <div>
                <h2>
                  {keyLabel(t, capabilityLabels, capability.capabilityKey)}
                </h2>
                <p>
                  {t("adminGovernance.capabilities.versionChangedBy", {
                    version: capability.rowVersion,
                    actor: capability.changedBy,
                  })}
                </p>
              </div>
              <StatusPill
                state={t(
                  capability.enabled
                    ? "adminGovernance.capabilities.newWorkEnabled"
                    : "adminGovernance.capabilities.newWorkDisabled",
                )}
                tone={capability.enabled ? "success" : "warning"}
              />
            </div>
            <div className={styles.panelBody}>
              <p>
                {t(
                  capability.recoveryEnabled
                    ? "adminGovernance.capabilities.recoveryEnabled"
                    : "adminGovernance.capabilities.recoveryDisabled",
                )}
              </p>
              <p>{capability.changeReason}</p>
              <p>
                {t("adminGovernance.capabilities.activationAuthority", {
                  role: keyLabel(
                    t,
                    roleLabels,
                    capabilityApprovalRole(
                      capability.capabilityKey as SystemCapabilityKey,
                    ),
                  ),
                })}
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
