import { use } from "react";
import Link from "next/link";

import type { Translator } from "@/src/i18n";
import { getTranslations } from "@/src/i18n/server";

import {
  clientSafeEnablementItems,
  internalEnablementItems,
  type EnablementItem,
} from "./enablement-data";
import styles from "./enablement.module.css";

function EnablementLedger({
  items,
  label,
  t,
}: {
  items: readonly EnablementItem[];
  label: string;
  t: Translator;
}) {
  return (
    <ul className={styles.ledger} aria-label={label}>
      {items.map((item) => (
        <li key={item.id}>
          <div>
            <h3>{t(item.title)}</h3>
            <p>{t(item.description)}</p>
          </div>
          <Link href={item.href}>{t("common.open")}</Link>
        </li>
      ))}
    </ul>
  );
}

export function PartnerEnablement({
  roles,
  partnerName,
}: {
  roles: readonly string[];
  partnerName: string;
}) {
  const t = use(getTranslations());
  const clientSafe = clientSafeEnablementItems();
  const internal = internalEnablementItems(roles);
  return (
    <main className={styles.main} id="main-content">
      <header className={styles.header}>
        <h1>{t("partner.enablement.title")}</h1>
        <p>{t("partner.enablement.description", { partner: partnerName })}</p>
      </header>

      <section className={styles.section} aria-labelledby="share-with-clients">
        <div className={styles.sectionHeading}>
          <div>
            <h2 id="share-with-clients">
              {t("partner.enablement.clientSafe.title")}
            </h2>
            <p>{t("partner.enablement.clientSafe.description")}</p>
          </div>
          <span>
            {t("partner.enablement.clientSafe.count", {
              count: clientSafe.length,
            })}
          </span>
        </div>
        <p className={styles.boundary}>
          {t("partner.enablement.clientSafe.boundary")}
        </p>
        <EnablementLedger
          items={clientSafe}
          label={t("partner.enablement.clientSafe.label")}
          t={t}
        />
      </section>

      <aside className={styles.salesKit} aria-labelledby="sales-kit-v1">
        <p>{t("partner.enablement.salesKit.status")}</p>
        <h2 id="sales-kit-v1">{t("partner.enablement.salesKit.title")}</h2>
        <p>{t("partner.enablement.salesKit.description")}</p>
      </aside>

      <section className={styles.section} aria-labelledby="internal-to-desk">
        <div className={styles.sectionHeading}>
          <div>
            <h2 id="internal-to-desk">
              {t("partner.enablement.internal.title")}
            </h2>
            <p>{t("partner.enablement.internal.description")}</p>
          </div>
          <span>
            {t("partner.enablement.internal.count", {
              count: internal.length,
            })}
          </span>
        </div>
        <EnablementLedger
          items={internal}
          label={t("partner.enablement.internal.label")}
          t={t}
        />
      </section>
    </main>
  );
}
