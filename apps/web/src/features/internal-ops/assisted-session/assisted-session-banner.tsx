import {
  exitAssistedSession,
  exitProviderAssistedSession,
} from "@/src/auth/actions";
import { use } from "react";

import { formatOperationalTimestamp } from "@/src/features/internal-ops/presentation";
import { getFormattingLocale, getTranslations } from "@/src/i18n/server";
import { richText } from "@/src/i18n/rich";

import type { AssistedSessionView } from "./repository";
import styles from "./assisted-session-banner.module.css";

export function AssistedSessionBanner({
  session,
  providerManaged = false,
}: {
  session: AssistedSessionView;
  providerManaged?: boolean;
}) {
  const expiresAt = session.expiresAt.toISOString();
  const t = use(getTranslations());
  const formattingLocale = use(getFormattingLocale());
  return (
    <aside
      className={styles.banner}
      aria-label={t("operations.assisted.active")}
    >
      <div className={styles.title}>
        <span aria-hidden="true" />
        <strong>{t("operations.assisted.active")}</strong>
      </div>
      <dl>
        <div>
          <dt>{t("operations.assisted.effectiveAccount")}</dt>
          <dd>{session.targetAccountName}</dd>
        </div>
        <div>
          <dt>{t("operations.assisted.staffActor")}</dt>
          <dd>
            {session.actualActorName !== session.actualActorEmail
              ? t("common.join.labels", {
                  first: session.actualActorName,
                  second: session.actualActorEmail,
                })
              : session.actualActorName}
          </dd>
        </div>
        <div>
          <dt>{t("operations.assisted.reasonAndExpiry")}</dt>
          <dd>
            {richText(t, "operations.assisted.reasonExpires", {
              reason: session.reason,
              time: (
                <time dateTime={expiresAt}>
                  {formatOperationalTimestamp(expiresAt, formattingLocale)}
                </time>
              ),
            })}
          </dd>
        </div>
      </dl>
      <p>{t("operations.assisted.serverSession", { id: session.id })}</p>
      <form
        action={
          providerManaged ? exitProviderAssistedSession : exitAssistedSession
        }
      >
        <button type="submit">{t("operations.assisted.exit")}</button>
      </form>
    </aside>
  );
}
