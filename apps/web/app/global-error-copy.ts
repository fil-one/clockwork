// i18n-exempt-file: the only surface that renders without the catalog (the root layout that provides it has failed); every value mirrors platform.globalError.* and global-error-copy.test.ts holds them equal
import { resolveLocale, rtlLocales, type Locale } from "@/src/i18n/locales";

/**
 * The words of the last-resort error page, in every interface language.
 *
 * `global-error.tsx` replaces the root layout, so the `LanguageProvider` and
 * its catalog are gone by the time it renders, and importing the catalog into
 * the root bundle would send every language's messages to every visitor. This
 * table is a copy of the four `platform.globalError.*` messages; the test
 * beside it fails if a value here drifts from the catalog, so the catalog stays
 * the one place a translator edits.
 */
export interface GlobalErrorCopy {
  title: string;
  description: string;
  /** Contains `{reference}`. */
  reference: string;
  retry: string;
}

export const globalErrorCopy: Readonly<Record<Locale, GlobalErrorCopy>> = {
  en: {
    title: "This page could not be loaded",
    description: "The application failed to start. Try again.",
    reference: "If it keeps happening, quote this reference: {reference}",
    retry: "Try again",
  },
  es: {
    title: "No se ha podido cargar esta página",
    description: "La aplicación no ha podido iniciarse. Inténtelo de nuevo.",
    reference: "Si vuelve a ocurrir, indique esta referencia: {reference}",
    retry: "Volver a intentarlo",
  },
  fr: {
    title: "Impossible de charger cette page",
    description: "L’application n’a pas pu démarrer. Réessayez.",
    reference:
      "Si le problème persiste, communiquez cette référence : {reference}",
    retry: "Réessayer",
  },
  de: {
    title: "Diese Seite konnte nicht geladen werden",
    description:
      "Die Anwendung konnte nicht gestartet werden. Versuchen Sie es erneut.",
    reference:
      "Falls das Problem weiterhin auftritt, nennen Sie diese Referenz: {reference}",
    retry: "Erneut versuchen",
  },
  ja: {
    title: "このページを読み込めませんでした",
    description:
      "アプリケーションを起動できませんでした。もう一度お試しください。",
    reference: "問題が続く場合は、次の参照番号をお伝えください：{reference}",
    retry: "再試行",
  },
  pt: {
    title: "Não foi possível carregar esta página",
    description: "O aplicativo não conseguiu iniciar. Tente novamente.",
    reference: "Se continuar acontecendo, informe esta referência: {reference}",
    retry: "Tentar novamente",
  },
  zh: {
    title: "无法加载此页面",
    description: "应用启动失败。请重试。",
    reference: "如果问题持续出现，请提供此参考编号：{reference}",
    retry: "重试",
  },
  ar: {
    title: "تعذّر تحميل هذه الصفحة",
    description: "تعذّر تشغيل التطبيق. حاول مرة أخرى.",
    reference: "إذا تكررت المشكلة، فاذكر هذا المرجع: {reference}",
    retry: "إعادة المحاولة",
  },
};

/**
 * The reader's language without the (failed) root layout.
 *
 * The page the reader was on carried the chosen language in `<html lang>`;
 * that attribute is read before this boundary replaces the document. When the
 * failure happened on the first request there is no such page, and the
 * browser's own language preference is the best remaining signal. The
 * preference cookie is `httpOnly` and cannot be read here.
 */
export function globalErrorLocale(
  pageLanguage: string | undefined,
  browserLanguages: readonly string[],
): Locale {
  if (pageLanguage) return resolveLocale(pageLanguage);
  for (const language of browserLanguages) {
    const locale = resolveLocale(language);
    if (locale !== "en" || language.toLowerCase().startsWith("en"))
      return locale;
  }
  return "en";
}

export function isRightToLeft(locale: Locale): boolean {
  return rtlLocales.has(locale);
}
