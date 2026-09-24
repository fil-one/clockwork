import type {
  CommandPaletteLabels,
  KitText,
  RenewalState,
  TermBarMessages,
} from "@clockwork/ui";

import type { MessageId, Translator } from "@/src/i18n";

/**
 * The UI kit's words in the reader's language.
 *
 * `@clockwork/ui` cannot import the application's messages and carries no
 * English defaults, so every surface that renders a kit component with words
 * of its own passes them in from here. A surface in any lane may call these
 * helpers; the message IDs stay inside the platform module.
 */

/** Generic words for kit components that take them from `KitTextProvider`. */
export function kitText(t: Translator): KitText {
  return {
    close: t("common.close"),
    search: t("common.search"),
    noMatches: t("common.noResults"),
    loading: t("common.loading"),
  };
}

/** Accessible name of a breadcrumb trail. */
export function breadcrumbsLabel(t: Translator): string {
  return t("platform.breadcrumbs");
}

const renewalStates: Readonly<Record<RenewalState, MessageId>> = {
  "auto-renews": "platform.term.state.autoRenews",
  evergreen: "platform.term.state.evergreen",
  "notice-open": "platform.term.state.noticeOpen",
  "non-renewing": "platform.term.state.nonRenewing",
  renewed: "platform.term.state.renewed",
  expired: "platform.term.state.expired",
};

/** Directional isolates the translator puts around inserted values in Arabic. */
const isolates = /^[⁨⁩]+|[⁨⁩]+$/gu;

/**
 * Splits one message at a placeholder, so a component can wrap the value in
 * its own element (a `<time>`) while the sentence stays one message in the
 * catalog and keeps the translator's word order.
 */
function aroundPlaceholder(
  t: Translator,
  id: MessageId,
  key: string,
): { before: string; after: string } {
  const marker = "\u0000";
  const [before = "", after = ""] = t(id, { [key]: marker }).split(marker);
  return {
    before: before.replace(isolates, ""),
    after: after.replace(isolates, ""),
  };
}

/** Every word a `TermBar` or `AccountTermRollup` says. */
export function termBarMessages(t: Translator): TermBarMessages {
  return {
    elapsed: (percent, days) => t("platform.term.elapsed", { percent, days }),
    remaining: (days) => t("platform.term.remaining", { days }),
    endDate: (date) => t("platform.term.endDate", { date }),
    endsOn: aroundPlaceholder(t, "platform.term.endsOn", "date"),
    noticeWindow: (start, end) =>
      t("platform.term.noticeWindow", { start, end }),
    renewalState: (state) => t(renewalStates[state]),
    sentences: (parts) =>
      parts
        .map((text) => t("platform.term.sentence", { text }))
        .reduce((first, second) =>
          t("common.join.sentences", { first, second }),
        ),
  };
}

/** Every word the command palette shows. */
export function commandPaletteLabels(t: Translator): CommandPaletteLabels {
  return {
    title: t("app.command.title"),
    description: t("app.command.description"),
    closeLabel: t("platform.command.close"),
    searchLabel: t("app.command.searchLabel"),
    placeholder: t("app.search.hint"),
    noResultsTitle: t("common.noResults"),
    noResultsLabel: t("app.command.noResults"),
    groupLabels: {
      navigation: t("app.command.group.navigation"),
      actions: t("app.command.group.actions"),
      records: t("app.command.group.records"),
    },
    keyHints: {
      move: t("platform.command.key.move"),
      select: t("platform.command.key.select"),
      close: t("common.close"),
    },
  };
}
