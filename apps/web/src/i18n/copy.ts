import type { MessageId, Translator } from "./catalogs";
import { legacyEnglish } from "./legacy-english";

/**
 * LEGACY. Maps authored English text back to a message ID.
 *
 * Any string missing from the map silently stays English, and identical English
 * with different meanings collides on one translation. That is how screens
 * ended up half English. New code calls `t("some.id")` directly; ESLint limits
 * these two functions to the files listed in `eslint/i18n-legacy/*.mjs`, and a
 * lane deletes its entry there when it migrates the file.
 */
const messageIds = new Map<string, MessageId>(
  Object.entries(legacyEnglish).map(([id, text]) => [text, id as MessageId]),
);

/** @deprecated Use `t(id)`. Only for authored interface copy, never records. */
export function translateInterfaceText(text: string, t: Translator): string {
  const id = messageIds.get(text);
  if (!id) return text;
  const translated = t(id);
  // The ID was renamed or removed by its owner: keep the old behaviour.
  return translated === id ? text : translated;
}

/** @deprecated Use `t(id)`. Only for authored interface copy, never records. */
export function localizeCopy<T>(copy: T, t: Translator): T {
  if (typeof copy === "string") return translateInterfaceText(copy, t) as T;
  if (Array.isArray(copy))
    return (copy as readonly unknown[]).map((value) =>
      localizeCopy(value, t),
    ) as T;
  if (copy && typeof copy === "object")
    return Object.fromEntries(
      Object.entries(copy as Record<string, unknown>).map(([key, value]) => [
        key,
        localizeCopy(value, t),
      ]),
    ) as T;
  return copy;
}
