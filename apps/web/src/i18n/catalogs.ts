import {
  isPluralMessage,
  isSameInAllLanguages,
  type MessageDefinition,
  type MessageDefinitions,
} from "./define";
import { locales, resolveLocale, type Locale } from "./locales";
import { adminGovernanceMessages } from "./messages/admin-governance";
import { adminPricingMessages } from "./messages/admin-pricing";
import { commonMessages } from "./messages/common";
import { customerMessages } from "./messages/customer";
import { customerCommercialMessages } from "./messages/customer-commercial";
import { demoMessages } from "./messages/demo";
import { enumMessages } from "./messages/enums";
import { experienceMessages } from "./messages/experience";
import { experienceDataMessages } from "./messages/experience-data";
import { operationsMessages } from "./messages/operations";
import { operationsFinanceMessages } from "./messages/operations-finance";
import { partnerMessages } from "./messages/partner";
import { platformMessages } from "./messages/platform";
import {
  createTranslator,
  type CatalogEntry,
  type MessageValues,
} from "./translator";

/**
 * Every message module, by owner. A lane adds messages only to its own module;
 * this registry is foundation-owned and does not change when a lane does.
 *
 * `prefixes` is the ID namespace a module's new messages must use, so two
 * lanes working in parallel cannot mint the same ID. Messages that existed
 * before the modules did keep their IDs (see `legacy-ids.ts`).
 */
export const messageModules = {
  common: { messages: commonMessages, prefixes: ["common."] },
  enums: {
    messages: enumMessages,
    prefixes: ["status.", "risk.", "role.", "region.", "recordKind.", "enum."],
  },
  partner: { messages: partnerMessages, prefixes: ["partner."] },
  // Split lanes keep one module and one prefix; each half edits its own file.
  customer: {
    messages: { ...customerMessages, ...customerCommercialMessages },
    prefixes: ["customer."],
  },
  experience: {
    messages: { ...experienceMessages, ...experienceDataMessages },
    prefixes: ["experience."],
  },
  adminPricing: {
    messages: adminPricingMessages,
    prefixes: ["adminPricing."],
  },
  adminGovernance: {
    messages: adminGovernanceMessages,
    prefixes: ["adminGovernance."],
  },
  operations: {
    messages: { ...operationsMessages, ...operationsFinanceMessages },
    prefixes: ["operations."],
  },
  platform: { messages: platformMessages, prefixes: ["platform."] },
  demo: { messages: demoMessages, prefixes: ["demo."] },
} as const satisfies Record<
  string,
  { messages: MessageDefinitions; prefixes: readonly string[] }
>;

type Modules = typeof messageModules;
export type MessageModuleName = keyof Modules;
export type MessageId = {
  [M in MessageModuleName]: keyof Modules[M]["messages"] & string;
}[MessageModuleName];
export type MessageCatalog = Readonly<Record<MessageId, CatalogEntry>>;
export type Translator = (id: MessageId, values?: MessageValues) => string;

function entryFor(message: MessageDefinition, locale: Locale): CatalogEntry {
  if (isSameInAllLanguages(message)) return message.en;
  if (isPluralMessage(message))
    return {
      count: message.count,
      forms: Object.fromEntries(
        Object.entries(message[locale]).map(([category, form]) => [
          category,
          typeof form === "string" ? form : form.sameAsEnglish,
        ]),
      ),
    };
  if (locale === "en") return message.en;
  const value = message[locale];
  return typeof value === "string" ? value : value.sameAsEnglish;
}

function compose(locale: Locale): MessageCatalog {
  const catalog: Record<string, CatalogEntry> = {};
  const owner = new Map<string, string>();
  for (const [name, { messages }] of Object.entries(messageModules)) {
    for (const [id, message] of Object.entries(
      messages as MessageDefinitions,
    )) {
      const existing = owner.get(id);
      if (existing)
        throw new Error(
          `Message ID "${id}" is defined in both ${existing} and ${name}`,
        );
      owner.set(id, name);
      catalog[id] = entryFor(message, locale);
    }
  }
  return Object.freeze(catalog);
}

/**
 * One flat catalog per language. The server sends only the selected one to the
 * browser; this module is never imported by client code.
 */
export const catalogs: Readonly<Record<Locale, MessageCatalog>> = Object.freeze(
  Object.fromEntries(locales.map((locale) => [locale, compose(locale)])),
) as Readonly<Record<Locale, MessageCatalog>>;

export function translatorFor(locale: string): Translator {
  const resolved = resolveLocale(locale);
  return createTranslator(catalogs[resolved], resolved);
}
