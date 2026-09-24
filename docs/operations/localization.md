# Interface languages

Settings (`/settings`, also linked from the profile menu) offers English,
Spanish, French, German, Japanese, Brazilian Portuguese, Simplified Chinese, and
Arabic for Gulf users. Arabic uses professional written Arabic and `ar-AE`
formatting; it is not a phonetic transcription of a spoken Gulf dialect. Words,
register and typography for every language are decided in the
[localization glossary](localization-glossary.md), which is binding.

The preference persists for one year in this browser using an HttpOnly,
SameSite=Lax cookie (Secure in production). It is independent of organization,
role, currency, and timezone. It does not synchronize between devices. An
unsupported cookie value falls back to English. Language selection does not
change authorization or commercial capability controls.

## What is translated, and what is not

- Everything the product writes is a message: labels, headings, help text, table
  headers, statuses, empty states, errors, pagination, computed phrases.
- Record names, user-entered content, identifiers, provider statuses and
  executed legal documents are not machine-translated. A production record is a
  plain string and is shown as written.
- Demo fixtures stand in for user-entered content. Where a fixture field needs
  to read naturally in every language it uses `demoText` (all eight languages),
  resolved once at the demo read boundary. Production projection sources never
  see these values.
- Generated PDF documents are not translated: their language belongs to the
  account, not to the reader's interface language.
- Amounts, dates and quantities are facts. They are formatted in the reader's
  interface language (`formattingLocales`) and placed into a message as values;
  the account decides the currency and the persona or account decides the time
  zone. A language change is never a currency conversion, and integer minor
  units are preserved.

## How messages are organized

Messages live in `apps/web/src/i18n/messages/`, one module per translation lane
plus two shared modules:

| Module                                                                                                                             | Owner                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `common.ts`                                                                                                                        | Shared interface words; read-only for lanes                                    |
| `enums.ts`                                                                                                                         | Closed sets: statuses, risk, roles, regions, record kinds; read-only for lanes |
| `partner.ts`, `customer.ts`, `experience.ts`, `admin-pricing.ts`, `admin-governance.ts`, `operations.ts`, `platform.ts`, `demo.ts` | The lane of the same name                                                      |

Each message names all eight languages through `defineMessages`, so a missing
language is a type error. Plural messages give each language exactly the CLDR
categories its rules select (Arabic six, Japanese and Chinese one), also typed.
`apps/web/src/i18n/catalogs.ts` composes one flat catalog per language from the
modules; `apps/web/src/i18n/ownership.ts` maps source paths to lanes.

Server code gets a translator from `getTranslations()` in `@/src/i18n/server`
and the reader's formatting tag from `getFormattingLocale()`. Client components
use `useTranslations()` and `useFormattingLocale()` from `@/src/i18n/client`.
The root layout sends only the selected catalog to the browser; client code
never imports the all-language catalogs. There is no English fallback: a
translator is a required parameter wherever one is needed.

Interpolation is single-pass, so braces inside record values remain literal. In
Arabic every inserted value is wrapped in Unicode directional isolates, so an
identifier, email address or amount cannot reorder the sentence around it.
`richText` places React elements (a `<time>`, a link) inside one message rather
than splitting a sentence around them.

## Checks

`apps/web/src/i18n/catalogs.test.ts` fails when a language is incomplete, a
placeholder differs between languages, a plural message is missing a CLDR
category, a translation is identical to English without a `sameAsEnglish` or
`sameInAllLanguages` marker, a new opaque `ui.<number>` ID appears, a new ID is
outside its module's namespace, a lane uses another lane's messages, or a value
breaks the mechanically checkable typography rules in the glossary.

ESLint rejects, in the web app, the legacy English-text lookup (`localizeCopy`,
`translateInterfaceText`), imports of the all-language catalogs outside the root
layout, `translatorFor("en")`, and `Intl` or `toLocale*` calls with a literal or
missing locale. Files still on a legacy path are listed per lane in
`apps/web/src/i18n/legacy-callers/`; those lists only shrink, and a test fails
on an entry that is no longer needed.

`node scripts/i18n-scan.mjs [paths...]` (also `pnpm i18n:scan`) reports
interface text that bypasses the catalogs, per file and line. A line that must
stay as written carries `// i18n-exempt: <reason>`; a whole file carries
`// i18n-exempt-file: <reason>` in its first twenty lines.

Review focused on preserving negation, permission/authority boundaries,
destructive actions, data freshness/partial-read limitations, and distinctions
between estimated, invoiced, recorded, and provider-confirmed amounts. This was
an engineering and language review, not independent native-speaker or legal
certification. Placeholder parity and catalog coverage tests accompany browser
checks for all eight preferences, reload persistence, mobile width, RTL, and
concurrent request isolation.
