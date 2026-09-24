/**
 * The light entry point: locale metadata, the translator factory and types.
 * It imports no messages, so a client component may import it freely. Server
 * code gets a translator from `./server`; the catalogs themselves live in
 * `./catalogs`, which client code must never import.
 */
export * from "./locales";
export {
  createTranslator,
  type CatalogEntry,
  type MessageValues,
  type PluralEntry,
} from "./translator";
export type {
  MessageCatalog,
  MessageId,
  MessageModuleName,
  Translator,
} from "./catalogs";
