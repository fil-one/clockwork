import { Skeleton } from "@clockwork/ui";

import { t } from "@/src/i18n/en";

export default function ExperienceLoading() {
  return (
    <main
      className="experience-main loading-page"
      id="main-content"
      aria-label={t("state.loading.title")}
    >
      <Skeleton width="28%" height="1rem" label={t("state.loading.title")} />
      <Skeleton width="66%" height="3.5rem" label={t("state.loading.title")} />
      <div className="stat-grid">
        {[0, 1, 2, 3].map((item) => (
          <Skeleton key={item} height="8rem" label={t("state.loading.title")} />
        ))}
      </div>
      <Skeleton height="24rem" label={t("state.loading.description")} />
    </main>
  );
}
