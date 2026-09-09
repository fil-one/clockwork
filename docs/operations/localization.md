# Interface languages

Settings (`/settings`, also linked from the profile menu) offers English,
Spanish, French, German, Japanese, Brazilian Portuguese, Simplified Chinese, and
Arabic for Gulf users. Arabic uses professional written Arabic and `ar-AE`
formatting; it is not a phonetic transcription of a spoken Gulf dialect.

The preference persists for one year in this browser using an HttpOnly,
SameSite=Lax cookie (Secure in production). It is independent of organization,
role, currency, and timezone. It does not synchronize between devices. An
unsupported cookie value falls back to English. Language selection does not
change authorization or commercial capability controls.

Server translations are request-scoped. The root layout supplies the selected
catalog to client components and sets document language and direction. Arabic
uses an RTL shell and mobile drawer. Currency formatting preserves integer minor
units and the record's currency; a locale change is not a conversion.

The catalogs cover navigation, settings, shared states and workflow actions,
operational overview, and shared customer/partner interface copy, including
agreement authority, order confirmation, and payment-provider warnings. Some
specialized administration text and provider-returned messages still appear in
their original language. Record names, user-entered content, identifiers,
provider statuses, and executed legal documents are not machine-translated.

Use explicit message IDs for new interface text. `localizeCopy` is only for
known authored interface copy objects; do not apply it to API records, customer
text, or legal documents. Add every message to all eight typed catalogs.
Interpolation is single-pass so braces within record values remain literal.

Review focused on preserving negation, permission/authority boundaries,
destructive actions, data freshness/partial-read limitations, and distinctions
between estimated, invoiced, recorded, and provider-confirmed amounts. This was
an engineering and language review, not independent native-speaker or legal
certification. Placeholder parity and catalog coverage tests accompany browser
checks for all eight preferences, reload persistence, mobile width, RTL, and
concurrent request isolation.
