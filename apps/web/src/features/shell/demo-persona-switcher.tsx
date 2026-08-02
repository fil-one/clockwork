"use client";

import { useState } from "react";

import { Button, Select } from "@clockwork/ui";

import { t } from "@/src/i18n/en";

import styles from "./demo-persona-switcher.module.css";

export interface DemoPersonaChoice {
  value: string;
  label: string;
}

function csrfToken(): string {
  if (typeof document === "undefined") return "";
  return (
    document.cookie
      .split(";")
      .map((part) => part.trim().split("="))
      .find(([key]) => key === "clockwork-csrf")
      ?.slice(1)
      .join("=") ?? ""
  );
}

/**
 * Presenter control for a demo deploy: which persona is signed in, what that
 * persona came here to do, and a way back to seeded data. It is rendered only
 * where the demo opt-in already selected fixture identity.
 */
export function DemoPersonaSwitcher({
  personas,
  current,
  personaName,
  journey = "",
}: {
  personas: readonly DemoPersonaChoice[];
  current: string;
  personaName: string;
  journey?: string;
}) {
  const [open, setOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [failed, setFailed] = useState(false);

  const reset = async () => {
    setResetting(true);
    setFailed(false);
    const token = csrfToken();
    try {
      const response = await fetch("/api/demo/reset", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { "x-csrf-token": token } : {}),
        },
        body: "{}",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("reset rejected");
      window.location.reload();
    } catch {
      setFailed(true);
      setResetting(false);
    }
  };

  return (
    <aside className={styles.panel} aria-label={t("demo.panel.title")}>
      {open ? (
        <div className={styles.body}>
          <div className={styles.head}>
            <span className={styles.title}>{t("demo.panel.title")}</span>
            <button
              type="button"
              className={styles.toggle}
              onClick={() => setOpen(false)}
            >
              {t("demo.panel.close")}
            </button>
          </div>
          <Select
            label={t("demo.panel.persona")}
            value={current}
            options={personas}
            onChange={(event) =>
              window.location.assign(
                `/demo/persona?persona=${encodeURIComponent(event.currentTarget.value)}`,
              )
            }
          />
          {journey ? (
            <p className={styles.journey}>
              <span>{t("demo.panel.journey")}</span>
              {journey}
            </p>
          ) : null}
          {failed ? (
            <p className={styles.error} role="alert">
              {t("demo.panel.reset.failed")}
            </p>
          ) : null}
          <div className={styles.actions}>
            <Button
              variant="secondary"
              size="small"
              disabled={resetting}
              onClick={() => void reset()}
            >
              {resetting ? t("demo.panel.resetting") : t("demo.panel.reset")}
            </Button>
            <a
              className="cw-button cw-button--quiet cw-button--small"
              href="/demo"
            >
              {t("demo.panel.browse")}
            </a>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={styles.launcher}
          onClick={() => setOpen(true)}
          aria-label={t("demo.panel.open")}
        >
          {personaName}
        </button>
      )}
    </aside>
  );
}
