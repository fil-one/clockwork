import { en, type MessageId, type createTranslator } from "./en";

export type Translator = ReturnType<typeof createTranslator>;
const messageIds = new Map<string, MessageId>(
  Object.entries(en).map(([id, text]) => [text, id as MessageId]),
);

/** Only use for authored interface copy, never customer data or legal documents. */
export function translateInterfaceText(text: string, t: Translator): string {
  const id = messageIds.get(text);
  return id ? t(id) : text;
}

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
