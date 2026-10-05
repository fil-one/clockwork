import Link from "next/link";

import { getRouteSession } from "@/src/features/shell/route-session";
import { getTranslations } from "@/src/i18n/server";

import { getCapabilityState } from "./capability-state";
import styles from "./billing-off-notice.module.css";

/**
 * Said once at the top of a billing or provisioning page while the billing
 * capability is switched off, so records there are not read as live invoices
 * or running services. Renders nothing once billing is on.
 */
export async function BillingOffNotice() {
  const capabilities = await getCapabilityState(
    await getRouteSession("internal"),
  );
  if (capabilities.isEnabled("billing")) return null;
  const t = await getTranslations();
  return (
    <div className={styles.notice} role="note">
      <strong>{t("operations.billingOff.title")}</strong>
      <p>{t("operations.billingOff.detail")}</p>
      <Link href="/internal/capabilities">
        {t("operations.billingOff.capabilities")}
      </Link>
    </div>
  );
}
