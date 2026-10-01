"use client";
import { usePathname, useRouter } from "next/navigation";
import { isLocale, localeNames, locales } from "../lib/i18n";
import { useI18n } from "./i18n-provider";
export function LanguageSelector() {
  const { locale, t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  return (
    <label className="language-selector">
      <span className="sr-only">{t("sales.language")}</span>
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z" />
      </svg>
      <select
        value={locale}
        onChange={(event) => {
          const next = event.currentTarget.value;
          if (!isLocale(next)) return;
          const suffix = pathname.replace(
            /^\/(en|es|fr|de|ja|pt|zh|ar)(?=\/|$)/,
            "",
          );
          const query = new URL(window.location.href).searchParams.toString();
          router.push(
            `/${next}${suffix}${query ? `?${query}` : ""}${window.location.hash}`,
          );
        }}
      >
        {locales.map((value) => (
          <option key={value} value={value} lang={value}>
            {localeNames[value]}
          </option>
        ))}
      </select>
    </label>
  );
}
