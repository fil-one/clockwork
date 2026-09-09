"use client";

import { useActionState } from "react";
import { Button } from "@clockwork/ui";
import { formattingLocales, languageNames } from "@/src/i18n";
import { useLocale, useTranslations } from "@/src/i18n/client";
import { saveLanguage } from "../(experience)/settings/actions";
import styles from "./demo-language-selector.module.css";

export function DemoLanguageSelector() {
  const locale = useLocale();
  const t = useTranslations();
  const [state, action, pending] = useActionState(saveLanguage, {
    saved: false,
    error: false,
  });
  return (
    <form
      action={action}
      className={styles.form}
      aria-label={t("settings.language")}
    >
      <label htmlFor="demo-language">{t("settings.language")}</label>
      <select
        key={locale}
        id="demo-language"
        name="language"
        defaultValue={locale}
        disabled={pending}
      >
        {Object.entries(languageNames).map(([value, name]) => (
          <option
            key={value}
            value={value}
            lang={formattingLocales[value as keyof typeof languageNames]}
          >
            {name}
          </option>
        ))}
      </select>
      <Button type="submit" disabled={pending}>
        {t(pending ? "settings.saving" : "settings.save")}
      </Button>
      <span role="status" aria-live="polite" className={styles.status}>
        {state.saved
          ? t("settings.saved")
          : state.error
            ? t("settings.error")
            : ""}
      </span>
    </form>
  );
}
