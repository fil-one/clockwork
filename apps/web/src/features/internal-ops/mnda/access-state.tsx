import type { MndaErrorCode } from "@clockwork/contracts";
import { ApplicationStatePanel, buttonClassName } from "@clockwork/ui";
import { getTranslations } from "@/src/i18n/server";
import type { MessageId } from "@/src/i18n";
import styles from "./workspace.module.css";

const states: Partial<
  Record<MndaErrorCode, { title: MessageId; description: MessageId }>
> = {
  forbidden: {
    title: "operations.mnda.access.forbiddenTitle",
    description: "operations.mnda.access.forbiddenDescription",
  },
  mfa_required: {
    title: "operations.mnda.access.mfaTitle",
    description: "operations.mnda.access.mfaDescription",
  },
};

/** A named page state for a session that cannot open the MNDA workspace, in
 * place of a generic error. */
export async function MndaAccessState({ code }: { code: MndaErrorCode }) {
  const t = await getTranslations();
  const state = states[code] ?? {
    title: "operations.mnda.access.unavailableTitle",
    description: "operations.mnda.access.unavailableDescription",
  };
  return (
    <main className={styles.main} id="main-content">
      <h1>{t("operations.mnda.title")}</h1>
      <ApplicationStatePanel
        state={code === "forbidden" ? "permission" : "recoverable-error"}
        title={t(state.title)}
        description={t(state.description)}
        action={
          code === "mfa_required" ? (
            <a className={buttonClassName()} href="/access/mfa">
              {t("operations.mnda.access.mfaAction")}
            </a>
          ) : (
            <a
              className={buttonClassName({ variant: "secondary" })}
              href="/internal"
            >
              {t("operations.mnda.access.home")}
            </a>
          )
        }
      />
    </main>
  );
}
