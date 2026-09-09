import { getTranslations } from "@/src/i18n/server";
import { use } from "react";
import { Skeleton } from "@clockwork/ui";

export default function ExperienceLoading() {
  const t = use(getTranslations());
  return (
    <main
      className="experience-main loading-page"
      id="main-content"
      aria-label={t("state.loading.title")}
    >
      <Skeleton width="28%" height="1rem" label={t("state.loading.title")} />
      <Skeleton width="66%" height="3.5rem" label={t("state.loading.title")} />
      <Skeleton height="14rem" label={t("state.loading.description")} />
      <Skeleton height="24rem" label={t("state.loading.description")} />
    </main>
  );
}
