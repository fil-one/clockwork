import { Button, EmptyState, StatusBadge, TermBar } from "@clockwork/ui";

import { t } from "@/src/i18n/en";

export default function HomePage() {
  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="app-brand">
          <span className="app-mark" aria-hidden="true">
            C
          </span>
          {t("app.name")}
        </div>
        <StatusBadge tone="success">Foundation ready</StatusBadge>
      </header>
      <section className="hero">
        <p className="eyebrow">{t("home.eyebrow")}</p>
        <h1>{t("home.title")}</h1>
        <p className="hero-copy">{t("home.description")}</p>
      </section>
      <section className="demo-grid" aria-label="Foundation component examples">
        <article className="demo-card">
          <h2>Term intelligence</h2>
          <p>The notice window is visible before the account reaches it.</p>
          <TermBar
            label={t("home.term")}
            start={new Date("2026-01-01T00:00:00Z")}
            noticeDate={new Date("2026-11-01T00:00:00Z")}
            end={new Date("2026-12-31T00:00:00Z")}
            now={new Date("2026-07-31T16:00:00Z")}
          />
        </article>
        <EmptyState
          title={t("home.empty.title")}
          description={t("home.empty.description")}
          action={<Button>{t("home.action")}</Button>}
        />
      </section>
    </main>
  );
}
