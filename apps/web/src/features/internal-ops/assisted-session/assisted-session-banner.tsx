import {
  exitAssistedSession,
  exitProviderAssistedSession,
} from "@/src/auth/actions";

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
  return (
    <aside className={styles.banner} aria-label="Assisted mode active">
      <div className={styles.title}>
        <span aria-hidden="true" />
        <strong>Assisted mode active</strong>
      </div>
      <dl>
        <div>
          <dt>Effective account</dt>
          <dd>{session.targetAccountName}</dd>
        </div>
        <div>
          <dt>Staff actor</dt>
          <dd>
            {session.actualActorName}
            {session.actualActorName !== session.actualActorEmail
              ? ` · ${session.actualActorEmail}`
              : ""}
          </dd>
        </div>
        <div>
          <dt>Reason and expiry</dt>
          <dd>
            {session.reason} · expires{" "}
            <time dateTime={expiresAt}>{expiresAt}</time>
          </dd>
        </div>
      </dl>
      <p>
        Server session {session.id} preserves the immutable staff actor and
        effective account on every authorized action.
      </p>
      <form
        action={
          providerManaged ? exitProviderAssistedSession : exitAssistedSession
        }
      >
        <button type="submit">Exit assisted mode</button>
      </form>
    </aside>
  );
}
