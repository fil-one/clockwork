"use client";

import { useActionState } from "react";
import { Button } from "@clockwork/ui";
import { languageNames } from "@/src/i18n";
import { useLocale, useTranslations } from "@/src/i18n/client";
import { saveLanguage } from "./actions";
import styles from "./settings.module.css";

export function LanguageSettings() {
  const locale = useLocale();
  const t = useTranslations();
  const [state, action, pending] = useActionState(saveLanguage, {
    saved: false,
    error: false,
  });
  return (
    <main id="main-content" className={styles.main}>
      <header>
        <h1>{t("settings.title")}</h1>
        <p>{t("settings.description")}</p>
      </header>
      <section className={styles.panel} aria-labelledby="language-title">
        <h2 id="language-title">{t("settings.language")}</h2>
        <p id="language-description">{t("settings.language.description")}</p>
        <form action={action}>
          <label htmlFor="language">{t("settings.language.label")}</label>
          <select
            key={locale}
            id="language"
            name="language"
            defaultValue={locale}
            aria-describedby="language-description"
            disabled={pending}
          >
            {Object.entries(languageNames).map(([value, name]) => (
              <option key={value} value={value} lang={value}>
                {name}
              </option>
            ))}
          </select>
          <Button type="submit" disabled={pending}>
            {t(pending ? "settings.saving" : "settings.save")}
          </Button>
          <p role="status" aria-live="polite">
            {state.saved
              ? t("settings.saved")
              : state.error
                ? t("settings.error")
                : ""}
          </p>
        </form>
        <p>{t("settings.language.records")}</p>
      </section>
    </main>
  );
}
