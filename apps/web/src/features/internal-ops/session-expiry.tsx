"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@clockwork/ui";
import { useTranslations } from "@/src/i18n/client";

/**
 * Server actions and uploads skip the proxy that refreshes the WorkOS
 * session, so once the access token expires they are refused with a
 * session-expired code. `router.refresh()` is a request through the proxy:
 * it refreshes the session, or sends a signed-out reader to sign in, and it
 * keeps what is on the page. The promise settles once the refreshed route
 * has rendered.
 */
export function useSessionRefresh(): () => Promise<void> {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const waiting = useRef<(() => void)[]>([]);
  useEffect(() => {
    if (!pending) for (const resolve of waiting.current.splice(0)) resolve();
  }, [pending]);
  return useCallback(
    () =>
      new Promise<void>((resolve) => {
        waiting.current.push(resolve);
        startTransition(() => router.refresh());
      }),
    [router],
  );
}

/**
 * The control beside a session-expired refusal. It refreshes the session in
 * place, so whatever the reader entered stays on the page to submit again.
 */
export function SessionExpiredReload({
  onReloaded,
}: {
  onReloaded?: () => void;
}) {
  const t = useTranslations();
  const refreshSession = useSessionRefresh();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="secondary"
      size="small"
      loading={busy}
      onClick={() => {
        setBusy(true);
        void refreshSession()
          .then(() => onReloaded?.())
          .finally(() => setBusy(false));
      }}
    >
      {t("operations.session.reload")}
    </Button>
  );
}
