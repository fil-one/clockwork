import Link from "next/link";

import { Button, EmptyState, Skeleton, StatusBadge } from "@clockwork/ui";

import { t } from "@/src/i18n/en";

const designedStates = [
  {
    key: "partial",
    title: "state.partial.title",
    description: "state.partial.description",
    tone: "warning",
  },
  {
    key: "success",
    title: "state.success.title",
    description: "state.success.description",
    tone: "success",
  },
  {
    key: "validation",
    title: "state.validation.title",
    description: "state.validation.description",
    tone: "danger",
  },
  {
    key: "permission",
    title: "session.permission.title",
    description: "session.permission.description",
    tone: "warning",
  },
  {
    key: "stale",
    title: "state.stale.title",
    description: "state.stale.description",
    tone: "warning",
  },
  {
    key: "optimistic",
    title: "states.optimistic.title",
    description: "states.optimistic.description",
    tone: "neutral",
  },
  {
    key: "offline",
    title: "states.offline.title",
    description: "states.offline.description",
    tone: "neutral",
  },
  {
    key: "recoverable",
    title: "state.recoverable.title",
    description: "state.recoverable.description",
    tone: "warning",
  },
  {
    key: "fatal",
    title: "state.fatal.title",
    description: "state.fatal.description",
    tone: "danger",
  },
] as const;

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
        <article className="state-card">
          <StatusBadge>{t("state.loading.title")}</StatusBadge>
          <h2>{t("state.loading.title")}</h2>
          <p>{t("state.loading.description")}</p>
          <div className="skeleton-stack" aria-label={t("state.loading.title")}>
            <Skeleton height="3rem" label={t("state.loading.title")} />
            <Skeleton width="72%" label={t("state.loading.title")} />
          </div>
        </article>
        <EmptyState
          title={t("state.empty.title")}
          description={t("state.empty.description")}
          action={<Button>{t("action.createQuote")}</Button>}
        />
        {designedStates.map((state) => (
          <article
            className={`state-card state-card--${state.tone}`}
            key={state.key}
          >
            <StatusBadge tone={state.tone}>{t("common.status")}</StatusBadge>
            <h2>{t(state.title)}</h2>
            <p>{t(state.description)}</p>
            {state.key === "permission" ? (
              <Link href="/dashboard">{t("session.permission.action")}</Link>
            ) : (
              <Button variant="secondary">
                {state.key === "fatal" ? t("app.help") : t("action.retry")}
              </Button>
            )}
          </article>
        ))}
      </section>
    </main>
  );
}
