import Link from "next/link";

import {
  ApplicationStatePanel,
  Button,
  SkeletonGroup,
  type ApplicationState,
} from "@clockwork/ui";

import { t, type MessageId } from "@/src/i18n/en";

export const stateGalleryStateKeys = [
  "loading",
  "empty",
  "partial",
  "optimistic",
  "success",
  "validation",
  "permission",
  "stale",
  "offline",
  "recoverable-error",
  "fatal-error",
] as const satisfies readonly ApplicationState[];

const designedStates = [
  {
    state: "loading",
    title: "state.loading.title",
    description: "state.loading.description",
  },
  {
    state: "empty",
    title: "state.empty.title",
    description: "state.empty.description",
  },
  {
    state: "partial",
    title: "state.partial.title",
    description: "state.partial.description",
  },
  {
    state: "optimistic",
    title: "states.optimistic.title",
    description: "states.optimistic.description",
  },
  {
    state: "success",
    title: "state.success.title",
    description: "state.success.description",
  },
  {
    state: "validation",
    title: "state.validation.title",
    description: "state.validation.description",
  },
  {
    state: "permission",
    title: "session.permission.title",
    description: "session.permission.description",
  },
  {
    state: "stale",
    title: "state.stale.title",
    description: "state.stale.description",
  },
  {
    state: "offline",
    title: "states.offline.title",
    description: "states.offline.description",
  },
  {
    state: "recoverable-error",
    title: "state.recoverable.title",
    description: "state.recoverable.description",
  },
  {
    state: "fatal-error",
    title: "state.fatal.title",
    description: "state.fatal.description",
  },
] as const satisfies readonly {
  state: (typeof stateGalleryStateKeys)[number];
  title: MessageId;
  description: MessageId;
}[];

function stateAction(state: ApplicationState) {
  if (
    state === "loading" ||
    state === "offline" ||
    state === "optimistic" ||
    state === "success"
  )
    return undefined;
  if (state === "empty") return <Button>{t("action.createQuote")}</Button>;
  if (state === "permission")
    return <Link href="/dashboard">{t("session.permission.action")}</Link>;
  if (state === "validation")
    return <Button variant="secondary">Review value</Button>;
  if (state === "stale")
    return <Button variant="secondary">Review latest version</Button>;
  return (
    <Button variant="secondary">
      {state === "fatal-error" ? t("app.help") : t("action.retry")}
    </Button>
  );
}

export function StateGallery() {
  return (
    <main className="experience-main" id="main-content">
      <header className="page-header">
        <div>
          <p className="eyebrow">{t("states.eyebrow")}</p>
          <h1>{t("states.title")}</h1>
          <p className="page-description">{t("states.description")}</p>
        </div>
      </header>
      <section className="state-grid" aria-label={t("states.title")}>
        {designedStates.map((state) => (
          <ApplicationStatePanel
            className="state-card"
            description={t(state.description)}
            details={
              state.state === "loading" ? (
                <SkeletonGroup label={t("state.loading.title")} rows={2} />
              ) : undefined
            }
            key={state.state}
            state={state.state}
            title={t(state.title)}
            action={stateAction(state.state)}
          />
        ))}
      </section>
    </main>
  );
}
