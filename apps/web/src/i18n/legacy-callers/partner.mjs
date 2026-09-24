/**
 * partner lane: files still on a legacy i18n path, one per line.
 *
 * Delete a file's line when the file no longer needs the exemption. Never add
 * one: a new file starts on message IDs and the reader's formatting locale.
 * `legacy-callers.test.ts` fails on a line whose file no longer needs it, so
 * the list only shrinks. Each lane has its own list so two lanes never edit
 * the same file.
 */
export default {
  /** Still import `localizeCopy` / `translateInterfaceText`. */
  localizeCopy: [],
  /** Still format with a literal locale or the runtime's default locale. */
  literalLocales: [],
};
