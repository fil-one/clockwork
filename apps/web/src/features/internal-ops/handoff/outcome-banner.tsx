"use client";

import { StateBanner } from "@clockwork/ui";

import { useTranslations } from "@/src/i18n/client";

import { SessionExpiredReload } from "../session-expiry";
import { handoffErrorMessage } from "./model";

export type HandoffOutcome =
  { tone: "success"; message: string } | { tone: "danger"; code: string };

/** The result of a handoff action in the reader's words. */
export function HandoffOutcomeBanner({
  outcome,
  onReloaded,
}: {
  outcome: HandoffOutcome | null;
  onReloaded: () => void;
}) {
  const t = useTranslations();
  return (
    <>
      <p className="cw-sr-only" role="status" aria-live="polite">
        {outcome?.tone === "success" ? outcome.message : ""}
      </p>
      {outcome?.tone === "success" ? (
        <StateBanner tone="success" title={outcome.message} />
      ) : null}
      {outcome?.tone === "danger" ? (
        <div role="alert">
          <StateBanner
            tone="danger"
            title={t(handoffErrorMessage(outcome.code))}
            {...(outcome.code === "SESSION_EXPIRED"
              ? { action: <SessionExpiredReload onReloaded={onReloaded} /> }
              : {})}
          />
        </div>
      ) : null}
    </>
  );
}
