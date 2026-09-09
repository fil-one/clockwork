import { getTranslations, getLocale } from "@/src/i18n/server";
import { formattingLocales } from "@/src/i18n";
import { OperationsHome } from "@/src/features/internal-ops/operations-home/operations-home";
import { loadOperationsHome } from "@/src/features/internal-ops/operations-home/server-loader";

export const dynamic = "force-dynamic";

export default async function Page() {
  return (
    <OperationsHome
      data={await loadOperationsHome(
        new Date(),
        await getTranslations(),
        formattingLocales[await getLocale()],
      )}
    />
  );
}
