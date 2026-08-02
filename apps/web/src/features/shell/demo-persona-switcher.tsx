"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";

import { Button, Dialog, Select } from "@clockwork/ui";

import { t } from "@/src/i18n/en";

import styles from "./demo-persona-switcher.module.css";

export interface DemoPersonaChoice {
  value: string;
  label: string;
}

export interface DemoJourneyView {
  title: string;
  steps: readonly { route: string; intent: string }[];
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

/** Local demo state the reset clears alongside the seeded server fixtures. */
function clearLocalDemoState(): void {
  for (const key of Object.keys(window.localStorage))
    if (key.startsWith("clockwork-demo:")) window.localStorage.removeItem(key);
}

function JourneySteps({
  journey,
  pathname,
}: {
  journey: DemoJourneyView;
  pathname: string;
}) {
  // The step whose route the presenter is on, or the first one until they move.
  const activeIndex = Math.max(
    0,
    journey.steps.findIndex((step) => step.route === pathname),
  );
  return (
    <div className={styles.journey}>
      <span>{t("demo.panel.journey")}</span>
      <p className={styles.journeyTitle}>{journey.title}</p>
      <ol className={styles.steps}>
        {journey.steps.map((step, index) => (
          <li
            key={step.route}
            className={styles.step ?? ""}
            data-state={
              index === activeIndex
                ? "current"
                : index < activeIndex
                  ? "complete"
                  : "upcoming"
            }
          >
            <a
              href={step.route}
              {...(index === activeIndex ? { "aria-current": "step" } : {})}
            >
              {step.intent}
            </a>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * The single demo control surface: which persona is signed in, the journey that
 * persona came here to run, and the way back to seeded data.
 */
export function DemoPersonaSwitcher({
  personas,
  current,
  personaName,
  journey,
}: {
  personas: readonly DemoPersonaChoice[];
  current: string;
  personaName: string;
  journey?: DemoJourneyView | undefined;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [failed, setFailed] = useState(false);

  // One action restores both halves of the demo: the seeded fixtures the server
  // holds and the local state this browser accumulated.
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
      clearLocalDemoState();
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
            <JourneySteps journey={journey} pathname={pathname} />
          ) : null}
          {failed ? (
            <p className={styles.error} role="alert">
              {t("demo.panel.reset.failed")}
            </p>
          ) : null}
          <div className={styles.actions}>
            <Dialog
              title={t("app.demo.reset.confirm.title")}
              description={t("app.demo.reset.confirm.description")}
              closeLabel={t("app.demo.reset.confirm.cancel")}
              trigger={
                <Button variant="secondary" size="small" disabled={resetting}>
                  {resetting
                    ? t("demo.panel.resetting")
                    : t("demo.panel.reset")}
                </Button>
              }
              footer={
                <Button
                  variant="danger"
                  size="small"
                  onClick={() => void reset()}
                >
                  {t("app.demo.reset.confirm.action")}
                </Button>
              }
            >
              <p>{t("app.demo.reset.confirm.detail")}</p>
            </Dialog>
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
