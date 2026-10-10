import type { HandoffRequestRecord } from "@clockwork/contracts";

import { getFormattingLocale, getTranslations } from "@/src/i18n/server";

import { HandoffRequestLine } from "./contract-handoff";
import styles from "./handoff.module.css";

const shown = 5;

/** The seller's handoffs on the home page, newest first. */
export async function OwnHandoffsCard({
  requests,
}: {
  requests: readonly HandoffRequestRecord[];
}) {
  const [t, locale] = await Promise.all([
    getTranslations(),
    getFormattingLocale(),
  ]);
  return (
    <section className={styles.card} aria-labelledby="home-handoffs">
      <div>
        <h2 id="home-handoffs">{t("operations.handoff.home.title")}</h2>
        <p className={styles.muted}>
          {requests.length === 0
            ? t("operations.handoff.home.empty")
            : t("operations.handoff.home.description")}
        </p>
      </div>
      {requests.length > 0 ? (
        <ul className={styles.list}>
          {requests.slice(0, shown).map((request) => (
            <HandoffRequestLine
              key={request.id}
              request={request}
              t={t}
              locale={locale}
              href={`/internal/contracts/${request.contractIds[0] ?? ""}`}
            />
          ))}
        </ul>
      ) : null}
      {requests.length > shown ? (
        <p className={styles.muted}>
          {t("operations.handoff.home.more", { count: shown })}
        </p>
      ) : null}
    </section>
  );
}
