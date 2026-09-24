"use client";

import { startTransition, useActionState, type ChangeEvent } from "react";
import { Button } from "@clockwork/ui";
import { formattingLocales, languageNames } from "@/src/i18n";
import { useLocale, useTranslations } from "@/src/i18n/client";
import { saveLanguage } from "../(experience)/settings/actions";
import styles from "./demo-language-selector.module.css";

/**
 * Choosing a language applies it. A visitor at the demo entrance picks a
 * language and goes straight to the password; a separate "save" step is one
 * they reliably skip, and the page then stayed in English.
 *
 * `carriedBy` names a form elsewhere on the page that also submits the choice.
 * The password form passes its own id, so the language travels with the
 * password even when the change never reached the server first -- before
 * hydration, without JavaScript, or when the visitor submits mid-save.
 */
export function DemoLanguageSelector({ carriedBy }: { carriedBy?: string }) {
  const locale = useLocale();
  const t = useTranslations();
  const [state, action, pending] = useActionState(saveLanguage, {
    saved: false,
    error: false,
  });
  const apply = (event: ChangeEvent<HTMLSelectElement>) => {
    const form = new FormData();
    form.set("language", event.currentTarget.value);
    startTransition(() => action(form));
  };
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
        onChange={apply}
        {...(carriedBy ? { form: carriedBy } : {})}
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
      {carriedBy ? null : (
        <noscript>
          <Button type="submit">{t("settings.save")}</Button>
        </noscript>
      )}
      <span role="status" aria-live="polite" className={styles.status}>
        {pending
          ? t("settings.saving")
          : state.saved
            ? t("settings.saved")
            : state.error
              ? t("settings.error")
              : ""}
      </span>
    </form>
  );
}
