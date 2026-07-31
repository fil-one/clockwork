import { EmptyState } from "@clockwork/ui";
import { t } from "@/src/i18n/en";

export default function ChooseOrganizationPage() {
  return (
    <main className="app-shell">
      <EmptyState
        title={t("app.account.choose.title")}
        description={t("app.account.choose.description")}
      />
    </main>
  );
}
