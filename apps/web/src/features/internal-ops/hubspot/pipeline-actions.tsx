"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@clockwork/ui";

import { useTranslations } from "@/src/i18n/client";

import { refreshHubSpotData } from "./actions";

/** Reads HubSpot again now. It imports nothing and changes no record. */
export function RefreshHubSpotButton() {
  const t = useTranslations();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await refreshHubSpotData().catch(() => ({
              ok: false as const,
              code: "UNEXPECTED",
            }));
            setFailed(!result.ok);
            router.refresh();
          })
        }
      >
        {pending
          ? t("operations.hubspot.pipeline.refreshing")
          : t("operations.hubspot.pipeline.refresh")}
      </Button>
      <span className="cw-sr-only" role="status" aria-live="polite">
        {failed ? t("operations.hubspot.error.HUBSPOT_UNAVAILABLE") : ""}
      </span>
    </>
  );
}

/** Copies this filtered view's address, which carries no extra access. */
export function CopyViewLink() {
  const t = useTranslations();
  const [copied, setCopied] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="quiet"
        onClick={() => {
          void navigator.clipboard
            ?.writeText(window.location.href)
            .then(() => setCopied(true))
            .catch(() => setCopied(false));
        }}
      >
        {copied
          ? t("operations.hubspot.pipeline.copied")
          : t("operations.hubspot.pipeline.copy")}
      </Button>
      <span className="cw-sr-only" role="status" aria-live="polite">
        {copied ? t("operations.hubspot.pipeline.copied") : ""}
      </span>
    </>
  );
}
