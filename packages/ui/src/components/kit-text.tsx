"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * The generic words a few interactive components need when their caller does
 * not name them: the close control of a dialog, and the placeholder, empty and
 * loading text of an entity picker.
 *
 * The kit cannot import an application's messages, and it must not carry an
 * English default: a default is exactly how a Portuguese screen ends up with an
 * English button. So the application provides these once, in the reader's
 * language, around every surface that renders the kit (the web app does it in
 * its shell). A component that has neither an explicit prop nor a provider
 * above it throws, which a test or story finds immediately, instead of quietly
 * rendering English to a reader who chose Arabic.
 */
export interface KitText {
  /** A dialog's close control. */
  close: string;
  /** Placeholder of a search-as-you-type picker. */
  search: string;
  /** Shown when a picker's search matches nothing. */
  noMatches: string;
  /** Shown while a picker's options load. */
  loading: string;
}

const KitTextContext = createContext<KitText | null>(null);

/**
 * The words a component rendered outside `KitTextProvider` falls back to.
 * Only test harnesses set it (the web app's `vitest.setup.ts`, mirroring its
 * harness language); in the application every surface is inside a provider,
 * and one that is not fails loudly rather than rendering English.
 */
let harnessText: KitText | null = null;
export function setHarnessKitText(text: KitText | null) {
  harnessText = text;
}

export function KitTextProvider({
  text,
  children,
}: {
  text: KitText;
  children: ReactNode;
}) {
  return (
    <KitTextContext.Provider value={text}>{children}</KitTextContext.Provider>
  );
}

/** The provided words, or `null` outside a provider. Always call it; it is a hook. */
export function useKitText(): KitText | null {
  return useContext(KitTextContext) ?? harnessText;
}

/** Resolves one word: the explicit prop, else the provider's, else a loud failure. */
export function kitWord(
  explicit: string | undefined,
  provided: KitText | null,
  key: keyof KitText,
  component: string,
): string {
  const word = explicit ?? provided?.[key];
  if (word === undefined)
    throw new Error(
      // i18n-exempt: developer error; it fires in tests and stories, never for a reader
      `${component} has no ${key} text: pass it as a prop or render it inside KitTextProvider`,
    );
  return word;
}
