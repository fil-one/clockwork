# Localization glossary and style guide

This glossary is binding for every translation lane and every reviewer. When a
term appears here, use the chosen form in that language and nothing from its
"Avoid" list. When the glossary and an existing catalog disagree, the glossary
wins and the catalog entry is a defect to fix when its lane next touches it.

It covers the seven translated interface languages: Spanish (`es`), French
(`fr`), German (`de`), Japanese (`ja`), Brazilian Portuguese (`pt`), Simplified
Chinese (`zh`), and Arabic for Gulf users (`ar`). English is the source.

The architecture and the record/legal-document policy are in
[localization.md](localization.md). This file decides words and typography.

## Changing this glossary

- Do not change a term inside a lane. If a lane needs a term that is missing, or
  thinks a choice is wrong, it adds a lane-local message that follows the
  nearest existing rule and records the question in its final report.
- The foundation follow-up is the only place this file changes. A change names
  the term, the old and new form per language, the reason, and every message ID
  that must move with it.
- A reviewer who finds a message using an "Avoid" form rejects it; there is no
  style exception for a single screen.
- Where a note says the choice is uncertain, the uncertainty is real: nobody has
  checked the named consoles for that term. Treat it as the best current answer,
  not as a citation.

## Language variants

| Code | Variant and audience                                                                                                       | Formatting locale |
| ---- | -------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `es` | European Spanish (Fil One Iberia, EU West customers). Use terms understood across regions; prefer Spain where they differ. | `es`              |
| `fr` | French (France).                                                                                                           | `fr-FR`           |
| `de` | German (Germany).                                                                                                          | `de-DE`           |
| `ja` | Japanese.                                                                                                                  | `ja-JP`           |
| `pt` | Brazilian Portuguese.                                                                                                      | `pt-BR`           |
| `zh` | Simplified Chinese, mainland terminology.                                                                                  | `zh-Hans-CN`      |
| `ar` | Modern Standard Arabic in Gulf business usage. Not a spoken dialect.                                                       | `ar-AE`           |

## Never translate

| Item                                    | Rule                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Fil One                                 | Never translated, transliterated, abbreviated, hyphenated or inflected. Latin script in `ja`, `zh` and `ar`. Not "FF", not "Filecoin Foundation".                                                                                                                                                                        |
| Fil One Commerce                        | Product name. "Commerce" is part of the name and is never translated (the old `app.product` entries "Comercio", "Comércio", "コマース", "商务", "الأعمال التجارية" are defects).                                                                                                                                         |
| Filecoin                                | Never translated.                                                                                                                                                                                                                                                                                                        |
| Provider and product names              | AWS, AWS Marketplace, Microsoft Azure, Azure Marketplace, Google Cloud, Google Cloud Marketplace, Stripe, WorkOS, DocuSign, Supabase, Netlify: as the vendor writes them, in Latin script.                                                                                                                               |
| Identifiers and references              | Record references (`EC-0047`, `INV-2026-0781`, `PQ-2026-0184-v3`), SKUs, product codes, UUIDs, request IDs, envelope IDs, tax codes, DNS record types (`TXT`), domain names, email addresses. Never translated, never split, never concatenated to a translated word without a space or separator chosen by the message. |
| Currency codes                          | `USD`, `EUR`, `GBP` stay as codes when a code is shown. Amounts are formatted by `Intl` (see Formatting).                                                                                                                                                                                                                |
| Acronyms kept as-is                     | API, PDF, CSV, JSON, URL, DNS, MFA, SSO, SLA, ACH, POC (see the term table for the long form), ID. `ja` and `zh` keep them half-width Latin.                                                                                                                                                                             |
| People, organizations and record titles | Names are data. Demo fixtures localize authored descriptive text through `demoText` (policy rule 4), never names.                                                                                                                                                                                                        |

Grammar around the brand:

- `es`, `fr`, `de`: no article before "Fil One" ("Fil One calcula", "Fil One
  calcule", "Fil One berechnet"). `de` must not build a compound with the brand
  ("Fil One-Team", "Fil One-Kosten" are wrong; write "Ihr Team bei Fil One",
  "Kosten von Fil One").
- `pt`: the company takes the feminine article ("a Fil One", "da Fil One"); the
  product takes the masculine ("o Fil One Commerce").
- `ar`: the company takes feminine agreement ("تحسب Fil One", "تؤكد Fil One").
- `ja`, `zh`: a half-width space separates "Fil One" from adjacent kana, kanji
  or Han characters ("Fil One の担当者", "Fil One 团队"), except next to
  full-width punctuation.

Tax names are localized, not kept as English acronyms:

| Source         | es                        | fr                  | de                                   | ja         | pt                   | zh     | ar                   |
| -------------- | ------------------------- | ------------------- | ------------------------------------ | ---------- | -------------------- | ------ | -------------------- |
| Sales tax (US) | impuesto sobre las ventas | taxe sur les ventes | Verkaufssteuer (US)                  | 売上税     | imposto sobre vendas | 销售税 | ضريبة المبيعات       |
| VAT (EU, UK)   | IVA                       | TVA                 | Umsatzsteuer (USt. in tight columns) | 付加価値税 | IVA                  | 增值税 | ضريبة القيمة المضافة |

The old `format.tax.*` values already follow this table.

## Register and voice

Plain, precise, and idiomatic, as a careful native product writer at a serious
B2B infrastructure company would write it. No marketing voice, no exclamation,
no filler.

| Lang | Address                                                                   | Sentences                                                                              | Buttons and menu items                                                                                                                                                                      | Headings                                                       |
| ---- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| es   | usted, everywhere. Never tú, never vos.                                   | Imperative in usted form ("Elija", "Revise", "Inténtelo de nuevo").                    | Infinitive ("Crear presupuesto", "Guardar").                                                                                                                                                | Sentence case, noun phrase or infinitive.                      |
| fr   | vous.                                                                     | Imperative vous form ("Choisissez", "Réessayez").                                      | Infinitive ("Créer un devis", "Enregistrer").                                                                                                                                               | Sentence case, noun phrase or infinitive.                      |
| de   | Sie. Never du.                                                            | Sie form ("Wählen Sie", "Versuchen Sie es erneut").                                    | Infinitive, object first ("Angebot erstellen", "Speichern").                                                                                                                                | Nouns capitalized per German grammar, otherwise sentence case. |
| ja   | です・ます in sentences; no personal pronouns (avoid あなた).             | です・ます, polite requests with 〜してください.                                       | Noun phrase: サ変 verbal nouns drop する ("作成", "承認", "見積もりを作成"); native verbs keep the dictionary form ("閉じる", "開く", "戻る", "続ける"). Never 〜する/〜させる on a button. | Noun phrase ("見積もりの完成", not "見積もりを完成させる").    |
| pt   | você (third-person verb forms).                                           | Imperative in você form ("Escolha", "Revise", "Tente novamente").                      | Infinitive ("Criar cotação", "Salvar").                                                                                                                                                     | Sentence case.                                                 |
| zh   | Concise business register; 您 only where a direct address is unavoidable. | Short declaratives; 请 + verb for instructions.                                        | Verb-object, no particles ("创建报价", "保存").                                                                                                                                             | Noun phrase.                                                   |
| ar   | Direct address, masculine singular imperative is the accepted default.    | MSA; prefer impersonal or passive constructions where they read naturally ("يُسجَّل"). | Verbal noun (masdar): "إنشاء عرض سعر", "حفظ", "فتح".                                                                                                                                        | Noun phrase.                                                   |

The old catalogs follow these conventions except where the inconsistency list
below says otherwise; the largest single gap is Spanish tú (99 messages).

## Typography (binding)

All languages:

- Typographic ellipsis `…` (U+2026), never three full stops.
- Sentence case for headings and buttons. English Title Case must not leak into
  any language.
- No trailing full stop on buttons, menu items, table headers, field labels,
  chips and short status labels. Full sentences keep their final punctuation.
- Never translate or reformat "Fil One", "Filecoin", product or SKU codes, or
  identifiers.
- Placeholders (`{name}`) are words: keep them, move them where the grammar
  needs them, never split a sentence around them.

Per language:

- `fr` — U+202F narrow no-break space before `;`, `!`, `?`; U+00A0 no-break
  space before `:` and inside guillemets `« … »`; typographic apostrophe `’`
  (U+2019), never `'`; quotation marks `« »`.
- `de` — quotation marks `„…“`; formal Sie; no English-style Title Case; no
  compound with "Fil One".
- `es` — opening `¿` and `¡` with every `?` and `!`; usted; sentence case;
  quotation marks `«…»` (or `“…”` inside them).
- `pt` — quotation marks `“…”`; você; sentence case.
- `ja` — full-width punctuation `。、「」（）：`; no trailing `。` on buttons,
  labels and headings; です・ます in sentences, noun-phrase labels; half-width
  Latin letters and digits; half-width space between a Latin word and Japanese
  text; no space between a digit and a Japanese counter or unit (`30日`, `2件`,
  `6か月`); no space next to full-width punctuation.
- `zh` — full-width punctuation `，。：；（）“”`; no space between two Han
  characters; half-width space between Han characters and Latin words or digits
  (`Fil One 团队`, `最近 30 天`), none next to full-width punctuation;
  half-width Latin letters and digits; mainland terminology only
  (软件 not 軟體, 默认 not 預設, 信息 not 資訊, 账户 not 帳戶, 文件 not 檔案).
- `ar` — Arabic comma `،`, question mark `؟`, semicolon `؛`; MSA; no tatweel
  (`ـ`, U+0640), including after a proclitic before a Latin word (write "لحساب
  Northstar" or restructure, not "لـ Northstar"); Latin-script names and codes
  stay left-to-right inside RTL text and need no manual direction marks in
  messages (the formatter adds its own). When a message starts or ends with a
  placeholder that may hold Latin text, the component isolates it (`<bdi>` or
  `unicode-bidi: isolate`); never put U+200E or U+200F into catalog text. The
  shell mirrors layout for RTL; icons that imply direction (back, next) mirror,
  numbers and Latin codes do not.

### Mechanically enforced subset

`catalogs.test.ts` enforces these; everything else above is enforced by review.

- `...` is banned in every locale.
- `fr`: no ASCII apostrophe; U+202F before `;`, `!` and `?`; U+00A0 before a
  word-final colon and inside guillemets.
- `de`, `pt`: no ASCII double quotes.
- `es`: a value containing `?` must contain `¿`; a value containing `!` must
  contain `¡`.
- `ja`, `zh`: no ASCII `,` `.` `:` `;` `!` `?` `(` `)` adjacent to a CJK
  character; no full-width Latin letters or digits.
- `zh`: no space between two Han characters.
- `ar`: no ASCII `,` `;` `?` adjacent to an Arabic letter; no tatweel.

## Numbers, dates, currency, plurals

- The interface language governs number, date and list formatting, through
  `formattingLocales[uiLocale]`. The account governs currency; the persona or
  account governs time zone. A language change never converts an amount.
- Never pre-render an amount, date, duration or quantity into a message ("$8,400
  proposed resale", "Updated Jul 30", "280 TB"). Pass the formatted value as a
  placeholder: `{amount} proposed resale`.
- Storage quantities use
  `Intl.NumberFormat(locale, { style: "unit", unit: "terabyte" })`. That yields
  `280 TB` in most locales, `280 To` in `fr` and `280 تيرابايت` in `ar`. Accept
  Intl's output.
- Plurals are plural messages (`count: "count"` plus one object of forms per
  language; see `apps/web/src/i18n/define.ts`). Each language supplies exactly
  the categories its rules select (Node 24, ICU 78.3): `en`, `de` one/other;
  `es`, `fr`, `pt` one/many/other (`many` is for exact millions: "1 000 000 de
  résultats"); `ja`, `zh` other only; `ar` zero/one/two/few/many/other. The
  translator selects the form and formats the count in the reader's locale.
  Never build a plural by appending "s", never pick a form with `count === 1`,
  and never put a count and its noun in separate messages. A form may say the
  number in words ("Un résultat", "نتيجتان").

What Node 24.18.1 (ICU 78.3) produces, for reference:

| Locale       | 1234.5  | 8400 USD      | 8400 EUR    | 23 Sep 2026, `dateStyle: "medium"` |
| ------------ | ------- | ------------- | ----------- | ---------------------------------- |
| `en-US`      | 1,234.5 | $8,400.00     | €8,400.00   | Sep 23, 2026                       |
| `es`         | 1234,5  | 8400,00 US$   | 8400,00 €   | 23 sept 2026                       |
| `fr-FR`      | 1 234,5 | 8 400,00 $US  | 8 400,00 €  | 23 sept. 2026                      |
| `de-DE`      | 1.234,5 | 8.400,00 $    | 8.400,00 €  | 23.09.2026                         |
| `ja-JP`      | 1,234.5 | $8,400.00     | €8,400.00   | 2026/09/23                         |
| `pt-BR`      | 1.234,5 | US$ 8.400,00  | € 8.400,00  | 23 de set. de 2026                 |
| `zh-Hans-CN` | 1,234.5 | US$8,400.00   | €8,400.00   | 2026年9月23日                      |
| `ar-AE`      | 1,234.5 | ‏8,400.00 US$ | ‏8,400.00 € | 23‏/09‏/2026                       |

Arabic: `ar-AE` produces Latin (Western Arabic) digits, with a U+200F
right-to-left mark before currency amounts and between date parts; month names
are Arabic ("23 سبتمبر 2026، 6:05 م غرينتش+4" for a Dubai-zone timestamp). We
accept that output. Arabic-Indic digits (`١٬٢٣٤٫٥`) appear only if someone
forces `numberingSystem: "arab"` or formats with bare `ar`; do neither. Within
one view, every number comes from the same formatter so digits never mix.
`fr-FR` uses U+202F as the grouping separator and U+00A0 before the currency
sign; tests that compare formatted strings must compare against `Intl` output,
not hand-typed spaces.

## Term table

Columns: the chosen term per language, then the forms to avoid (grep for them in
review), then a note. "Uncertain" means the choice is reasoned but has not been
checked against the named consoles.

### Commercial documents and pricing

| English                                    | es                             | fr                     | de                                              | ja                          | pt                    | zh                      | ar                   | Avoid                                                                                                                                                               | Note                                                                                                                                                                                                                                            |
| ------------------------------------------ | ------------------------------ | ---------------------- | ----------------------------------------------- | --------------------------- | --------------------- | ----------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| quote                                      | presupuesto                    | devis                  | Angebot                                         | 見積もり (document: 見積書) | cotação               | 报价 (document: 报价单) | عرض سعر              | es: cotización, oferta · pt: proposta, orçamento · zh: 报价方案 · ar: عرض (alone)                                                                                   | A priced, versioned offer to one buyer; issuing it does not create an order. `es`: "cotización" is Latin American and "oferta" collides with a catalog offer. `pt`: "proposta" reads as a proposal, "orçamento" as an estimate.                 |
| offer (catalog or PAYG offer)              | oferta                         | offre                  | Tarif                                           | オファー                    | oferta                | 方案                    | باقة                 | de: Angebot (that is a quote) · zh: 报价 · ar: عرض                                                                                                                  | A sellable configuration a buyer picks before a quote exists. Marketplace "private offer" follows the provider's own term: oferta privada, offre privée, privates Angebot, プライベートオファー, oferta privada, 私有报价 (uncertain), عرض خاص. |
| order                                      | pedido                         | commande               | Auftrag                                         | 注文                        | pedido                | 订单                    | طلب                  | de: Bestellung (that is the buyer's purchase order) · ar: أمر (alone)                                                                                               | The commitment created by accepting an issued quote. `ar` "طلب" also means request; always qualify requests ("طلب تجديد").                                                                                                                      |
| order form                                 | formulario de pedido           | formulaire de commande | Auftragsformular                                | 注文書                      | formulário de pedido  | 订购单                  | نموذج الطلب          | fr: bon de commande (that is the PO) · zh: 订单表单 (reads as a web form)                                                                                           | The rendered document the buyer accepts.                                                                                                                                                                                                        |
| purchase order (PO)                        | orden de compra                | bon de commande        | Bestellung; reference: Bestellnummer            | 発注書                      | ordem de compra       | 采购订单                | أمر الشراء           | pt: pedido de compra (collides with pedido) · de: Bestellreferenz                                                                                                   | The buyer's own document. A PO reference never changes pinned terms.                                                                                                                                                                            |
| agreement                                  | acuerdo                        | accord                 | Vereinbarung                                    | 契約                        | acordo                | 协议                    | اتفاقية              | es/fr/pt: contrato/contrat when the source says agreement · de: Vertrag (alone)                                                                                     | The governing legal instrument. `es`, `fr`, `pt` keep "contrato/contrat" for "customer paper" (the customer's own contract), so the two stay distinct.                                                                                          |
| amendment                                  | modificación                   | avenant                | Vertragsänderung                                | 契約変更                    | aditivo               | 合同变更 (short: 变更)  | تعديل تعاقدي         | es: enmienda · de: Änderung (alone, in headings) · pt: alteração · zh: 修订 (reserved for revision)                                                                 | A change to an active order or agreement.                                                                                                                                                                                                       |
| revision (of a quote)                      | revisión                       | révision               | Überarbeitung                                   | 改訂版                      | revisão               | 修订版                  | النسخة المعدّلة      | de: Revision (means internal audit) · ar: الإصدار (that is version)                                                                                                 | "Revision 3" of a quote series.                                                                                                                                                                                                                 |
| version                                    | versión                        | version                | Version                                         | バージョン                  | versão                | 版本                    | الإصدار              | —                                                                                                                                                                   | Identical to English in `fr`/`de` is correct.                                                                                                                                                                                                   |
| execute (an agreement)                     | formalizar                     | conclure               | abschließen                                     | 締結                        | firmar                | 签订                    | إبرام                | es: ejecutar · fr: exécuter · de: ausführen · pt: executar · zh: 执行 · ar: تنفيذ                                                                                   | Legal act of entering the agreement; the avoid forms mean "run".                                                                                                                                                                                |
| issue (a quote, an invoice)                | emitir                         | émettre                | ausstellen                                      | 発行                        | emitir                | 出具 (invoice: 开具)    | إصدار                | de: ausgeben · zh: 发布, 发出                                                                                                                                       | 发布 means publish.                                                                                                                                                                                                                             |
| price book                                 | lista de precios               | grille tarifaire       | Preisliste                                      | 価格表                      | tabela de preços      | 价目表                  | قائمة الأسعار        | libro de precios · livre de prix · Preisbuch · 価格ブック · livro de preços · 价格簿 · دفتر الأسعار                                                                 | Versioned, currency-scoped source of list and transfer prices.                                                                                                                                                                                  |
| rate card                                  | tarifa                         | barème tarifaire       | Preisblatt                                      | 料金表                      | tabela de tarifas     | 费率表                  | جدول الأسعار         | de: Tarif (reserved for offer)                                                                                                                                      | Per-unit rates inside a price book.                                                                                                                                                                                                             |
| transfer price                             | precio de cesión               | prix de cession        | Einkaufspreis (internal: Partner-Einkaufspreis) | 仕切価格                    | preço de repasse      | 供货价                  | سعر التوريد          | precio de transferencia · prix de transfert · Transferpreis, Verrechnungspreis · 移転価格, 仕入価格 · preço de transferência · 转移价格, 内部转移价格 · سعر التحويل | The price Fil One charges the partner; private to the partner. The avoid forms are the intercompany tax term (or, in `ar`, money transfer). Uncertain for `de` and `ar`; confident for `fr`, `ja`, `zh`.                                        |
| resale price                               | precio de reventa              | prix de revente        | Wiederverkaufspreis                             | 再販価格                    | preço de revenda      | 转售价                  | سعر إعادة البيع      | —                                                                                                                                                                   | Set by the partner; the only price the end client sees.                                                                                                                                                                                         |
| floor price                                | precio mínimo                  | prix plancher          | Preisuntergrenze                                | 下限価格                    | preço mínimo          | 底价                    | الحد الأدنى للسعر    | —                                                                                                                                                                   |                                                                                                                                                                                                                                                 |
| margin floor                               | margen mínimo                  | marge minimale         | Mindestmarge                                    | 最低利益率                  | margem mínima         | 最低利润率              | الحد الأدنى للهامش   | —                                                                                                                                                                   |                                                                                                                                                                                                                                                 |
| discount authority                         | límite de descuento autorizado | délégation de remise   | Rabattbefugnis                                  | 値引き権限                  | alçada de desconto    | 折扣权限                | صلاحية الخصم         | es: autoridad de descuento                                                                                                                                          | Who may approve how much discount. `pt` "alçada" is the native term for an approval limit.                                                                                                                                                      |
| exception (pricing or policy)              | excepción                      | exception              | Ausnahme                                        | 例外                        | exceção               | 例外                    | استثناء              | zh: 异常 (means error; keep it for failures)                                                                                                                        | A decision outside policy that needs approval.                                                                                                                                                                                                  |
| capacity                                   | capacidad                      | capacité               | Kapazität                                       | 容量                        | capacidade            | 容量                    | السعة                | —                                                                                                                                                                   |                                                                                                                                                                                                                                                 |
| committed capacity                         | capacidad contratada           | capacité souscrite     | vertraglich zugesagte Kapazität                 | 契約容量                    | capacidade contratada | 承诺容量                | السعة المتعاقد عليها | de: zugesagte Kapazität (alone), vertragliche Kapazität                                                                                                             |                                                                                                                                                                                                                                                 |
| term (commitment length)                   | duración                       | durée                  | Laufzeit                                        | 契約期間                    | prazo                 | 期限                    | المدة                | es: plazo (reads as deadline)                                                                                                                                       | "12 months".                                                                                                                                                                                                                                    |
| service term                               | duración del servicio          | durée du service       | Servicelaufzeit                                 | サービス期間                | prazo do serviço      | 服务期限                | مدة الخدمة           | de: Dienstlaufzeit                                                                                                                                                  |                                                                                                                                                                                                                                                 |
| notice window                              | plazo de preaviso              | période de préavis     | Kündigungsfrist                                 | 通知期間                    | aviso prévio          | 通知期                  | فترة الإشعار         | de: Mitteilungsfrist, Mitteilungstermin · pt: aviso (alone)                                                                                                         | The period in which non-renewal must be notified.                                                                                                                                                                                               |
| renewal                                    | renovación                     | renouvellement         | Verlängerung                                    | 契約更新                    | renovação             | 续约                    | التجديد              | ja: 更新 (alone; that is refresh)                                                                                                                                   |                                                                                                                                                                                                                                                 |
| region (cloud region)                      | región                         | région                 | Region                                          | リージョン                  | região                | 区域                    | المنطقة              | ja: 地域 · zh: 地区                                                                                                                                                 | "US East", "EU West" are proper names; keep them in English unless a lane defines localized region labels as an enum.                                                                                                                           |
| route (direct, referral, resale, two-tier) | modalidad de venta             | mode de vente          | Vertriebsweg                                    | 販売形態                    | modalidade de venda   | 销售模式                | مسار البيع           | es/fr/pt: canal · ja: チャネル · zh: 渠道 · ar: القناة                                                                                                              | How a deal is sold. Never the same word as channel.                                                                                                                                                                                             |
| channel                                    | canal                          | canal                  | Kanal                                           | チャネル                    | canal                 | 渠道                    | القناة               | ar: المسار                                                                                                                                                          | Partner channel, or a projection channel in internal text.                                                                                                                                                                                      |

### Channel and partner economics

| English                | es                                     | fr                                    | de                      | ja                   | pt                                  | zh           | ar                         | Avoid                                                                   | Note                                                                                                                                              |
| ---------------------- | -------------------------------------- | ------------------------------------- | ----------------------- | -------------------- | ----------------------------------- | ------------ | -------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| partner                | socio                                  | partenaire                            | Partner                 | パートナー           | parceiro                            | 合作伙伴     | الشريك                     | es: asociado, compañero                                                 | `es`: "partner" is common in Spain but "socio" is already consistent in the catalogs; uncertain which the big consoles prefer for Spain.          |
| reseller               | revendedor                             | revendeur                             | Reseller                | リセラー             | revendedor                          | 经销商       | شريك إعادة البيع           | de: Wiederverkäufer (in role names) · zh: 转售商                        | Buys at transfer price and resells.                                                                                                               |
| distributor            | distribuidor                           | distributeur                          | Distributor             | ディストリビューター | distribuidor                        | 分销商       | الموزّع                    | —                                                                       | Two-tier route.                                                                                                                                   |
| referral               | recomendación                          | apport d'affaires                     | Empfehlung              | 紹介                 | indicação                           | 推荐         | الإحالة                    | es: referido, referencia                                                | Referral partner: socio prescriptor, apporteur d'affaires, Empfehlungspartner, 紹介パートナー, parceiro de indicação, 推荐合作伙伴, شريك الإحالة. |
| end client             | cliente final                          | client final                          | Endkunde                | エンド顧客           | cliente final                       | 终端客户     | العميل النهائي             | ja: エンドクライアント (calque), 最終顧客 · zh: 最终客户                | `ja` uncertain; エンドユーザー is common in distribution but reads as an individual.                                                              |
| merchant of record     | vendedor responsable de la transacción | vendeur responsable de la transaction | Merchant of Record      | 販売主体             | vendedor responsável pela transação | 交易责任商户 | التاجر المسؤول عن المعاملة | de: verantwortlicher Verkäufer · ja: 販売責任者 (both read as a person) | The legal seller that contracts with and invoices the buyer. `de` keeps the established English term; `ja` uncertain.                             |
| deal registration      | registro de oportunidades              | enregistrement d'opportunité          | Deal-Registrierung      | 案件登録             | registro de oportunidade            | 商机报备     | تسجيل الفرص                | de: Chancenregistrierung, Chance · zh: 商机登记                         |                                                                                                                                                   |
| protected deal         | oportunidad protegida                  | opportunité protégée                  | geschützter Deal        | 保護対象案件         | oportunidade protegida              | 受保护商机   | فرصة محمية                 | —                                                                       |                                                                                                                                                   |
| commission             | comisión                               | commission                            | Provision               | コミッション         | comissão                            | 佣金         | العمولة                    | de: Kommission                                                          |                                                                                                                                                   |
| accrual (commission)   | devengo (comisión devengada)           | commission acquise                    | aufgelaufene Provision  | 計上額               | comissão provisionada               | 计提         | العمولة المستحقة           | es: acumulación                                                         | Earned, not yet paid.                                                                                                                             |
| holdback               | retención                              | retenue                               | Einbehalt               | 留保額               | valor retido                        | 暂扣款       | المبلغ المحتجز             | pt: retenção (reserved for data retention)                              |                                                                                                                                                   |
| clawback               | recuperación de comisión               | reprise de commission                 | Provisionsrückforderung | 返還                 | estorno de comissão                 | 追回         | استرداد العمولة            | —                                                                       |                                                                                                                                                   |
| payout                 | pago al socio                          | versement                             | Auszahlung              | 支払い               | repasse                             | 付款         | صرف المستحقات              | es: desembolso                                                          |                                                                                                                                                   |
| statement (commission) | liquidación de comisiones              | relevé de commissions                 | Provisionsabrechnung    | 明細書               | demonstrativo                       | 结算单       | كشف العمولات               | es: estado de cuenta (a bank statement)                                 |                                                                                                                                                   |

### Service lifecycle

| English                | es                       | fr                      | de                          | ja               | pt                       | zh             | ar                    | Avoid                                                                            | Note                                                                                         |
| ---------------------- | ------------------------ | ----------------------- | --------------------------- | ---------------- | ------------------------ | -------------- | --------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| proof of concept (POC) | prueba de concepto (POC) | preuve de concept (POC) | Proof of Concept (POC)      | PoC（概念実証）  | prova de conceito (POC)  | 概念验证 (POC) | إثبات المفهوم (POC)   | de: Machbarkeitsnachweis                                                         | The abbreviation stays "POC" (ja "PoC"). The long form on first mention in explanatory text. |
| trial                  | periodo de prueba        | essai                   | Testphase                   | トライアル       | período de teste         | 试用           | الفترة التجريبية      | de: Test · pt: teste (alone) · ar: التجربة · es: prueba (alone)                  |                                                                                              |
| PAYG (pay as you go)   | pago por uso             | paiement à l'usage      | nutzungsbasierte Abrechnung | 従量課金         | pagamento conforme o uso | 按量付费       | الدفع حسب الاستخدام   | de: nutzungsabhängige Zahlung                                                    |                                                                                              |
| sandbox                | entorno de pruebas       | environnement de test   | Testumgebung                | サンドボックス   | ambiente de testes       | 沙盒           | بيئة الاختبار         | —                                                                                | `zh` 沙箱 is also mainland usage; keep 沙盒 for consistency.                                 |
| provisioning           | aprovisionamiento        | provisionnement         | Bereitstellung              | プロビジョニング | provisionamento          | 开通           | التهيئة               | ar: التوفير                                                                      |                                                                                              |
| entitlement            | derecho de uso           | droit d'utilisation     | Nutzungsrecht               | 利用権           | direito de uso           | 权益           | الاستحقاق             | de: Berechtigung (means permission) · es/fr/pt: derechos/droits/direitos (alone) |                                                                                              |
| egress                 | tráfico de salida        | trafic sortant          | ausgehender Datenverkehr    | 送信データ転送   | tráfego de saída         | 出站流量       | حركة البيانات الصادرة | calques of "egress"                                                              | `ja` uncertain.                                                                              |
| offboarding            | baja                     | fin de service          | Offboarding                 | 利用終了         | encerramento             | 服务终止       | إنهاء الخدمة          | fr: sortie, clôture · de: Austritt · zh: 退出 (means sign out)                   | Ending a service with retrieval, final billing and retention review.                         |
| teardown               | desmantelamiento         | démantèlement           | Rückbau                     | 撤去             | desmantelamento          | 拆除           | التفكيك               | pt: desativação (reversible; softens a destructive act)                          | Destructive and irreversible. Rule 6 applies.                                                |
| retention              | conservación             | conservation            | Aufbewahrung                | 保持             | retenção                 | 保留           | الاحتفاظ              | —                                                                                |                                                                                              |
| retention hold         | bloqueo por conservación | blocage de conservation | Aufbewahrungssperre         | 保持ロック       | bloqueio de retenção     | 保留锁定       | حجز الاحتفاظ          | legal-hold terms unless the source says legal hold                               | `ja`, `zh`, `ar` uncertain.                                                                  |

### Billing and finance

| English             | es                     | fr                    | de                   | ja               | pt                   | zh         | ar                  | Avoid                                                                      | Note                                                                                                                                            |
| ------------------- | ---------------------- | --------------------- | -------------------- | ---------------- | -------------------- | ---------- | ------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| invoice             | factura                | facture               | Rechnung             | 請求書           | fatura               | 发票       | فاتورة              | zh: 账单 (a bill or statement)                                             |                                                                                                                                                 |
| credit note         | factura rectificativa  | avoir                 | Gutschrift           | クレジットノート | nota de crédito      | 贷项通知单 | إشعار دائن          | es: abono, nota de crédito · ja: 貸方票 (accounting jargon)                | `es`: the Spanish legal document. `zh` uncertain.                                                                                               |
| remittance          | aviso de pago          | avis de paiement      | Zahlungsavis         | 送金通知         | aviso de pagamento   | 付款通知   | إشعار التحويل       | —                                                                          |                                                                                                                                                 |
| collections         | cobros                 | recouvrement          | Forderungsmanagement | 債権回収         | cobrança             | 收款       | التحصيل             | zh: 催收 (debt-collector sense)                                            |                                                                                                                                                 |
| dunning             | reclamación de impagos | relance               | Mahnwesen            | 督促             | régua de cobrança    | 催款       | المطالبة بالسداد    | de: Mahnverfahren (a court procedure) · pt: cobrança (that is collections) |                                                                                                                                                 |
| dispute             | disputa                | litige                | Streitfall           | 異議             | contestação          | 争议       | النزاع              | ja: 紛争 (implies litigation)                                              | `ja` uncertain.                                                                                                                                 |
| chargeback          | contracargo            | rétrofacturation      | Rückbuchung          | チャージバック   | chargeback           | 拒付       | رد المبالغ المدفوعة | pt: estorno (a refund reversal)                                            |                                                                                                                                                 |
| refund              | reembolso              | remboursement         | Erstattung           | 返金             | reembolso            | 退款       | استرداد             | —                                                                          |                                                                                                                                                 |
| reconciliation      | conciliación           | rapprochement         | Abstimmung           | 照合             | conciliação          | 对账       | المطابقة            | de: Abgleich                                                               |                                                                                                                                                 |
| three-way tie-out   | cuadre a tres bandas   | rapprochement à trois | Dreiwege-Abstimmung  | 三者照合         | conciliação tripla   | 三方核对   | المطابقة الثلاثية   | calques of "tie-out"; de: Dreifachabgleich                                 |                                                                                                                                                 |
| month-end close     | cierre mensual         | clôture mensuelle     | Monatsabschluss      | 月次締め         | fechamento mensal    | 月结       | الإقفال الشهري      | —                                                                          | Distinct from Close (dialog).                                                                                                                   |
| variance            | diferencia             | écart                 | Abweichung           | 差異             | divergência          | 差异       | الفرق               | —                                                                          |                                                                                                                                                 |
| ledger (operating)  | registro operativo     | registre opérationnel | Betriebsregister     | 業務台帳         | registro operacional | 运营台账   | السجل التشغيلي      | es: libro mayor (general ledger only)                                      | "Quote ledger" is a list: lista de presupuestos, liste des devis, Angebotsliste, 見積もり一覧, lista de cotações, 报价列表, قائمة عروض الأسعار. |
| aging (receivables) | antigüedad             | ancienneté            | Forderungsalter      | 経過日数         | antiguidade          | 账龄       | أعمار الديون        | —                                                                          |                                                                                                                                                 |

### Governance and operations

| English                    | es                           | fr                     | de                  | ja                  | pt                         | zh            | ar                | Avoid                                                                 | Note                                                                                                                                                        |
| -------------------------- | ---------------------------- | ---------------------- | ------------------- | ------------------- | -------------------------- | ------------- | ----------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| approval                   | aprobación                   | approbation            | Genehmigung         | 承認                | aprovação                  | 审批          | الموافقة          | de: Freigabe (reserved for release)                                   | Verb: aprobar, approuver, genehmigen, 承認, aprovar, 批准, الموافقة على.                                                                                    |
| approver                   | aprobador                    | approbateur            | genehmigende Person | 承認者              | aprovador                  | 审批人        | الموافِق          | de: Freigebende, Genehmiger (as a bare role noun)                     |                                                                                                                                                             |
| decline (a quote, renewal) | declinar                     | décliner               | ablehnen            | 辞退                | recusar                    | 拒绝          | رفض               | —                                                                     | Must differ from reject.                                                                                                                                    |
| reject (an approval)       | rechazar                     | rejeter                | zurückweisen        | 却下                | rejeitar                   | 驳回          | ردّ               | es: rechazar for decline · fr: refuser for both                       |                                                                                                                                                             |
| assisted mode              | modo asistido                | mode assisté           | Assistenzmodus      | 代理操作モード      | modo assistido             | 代操作模式    | الوضع المساعد     | zh: 协助模式 (loses "on behalf of")                                   | Staff acting for a customer account under their own identity.                                                                                               |
| operator                   | operador                     | opérateur              | Operator            | オペレーター        | operador                   | 操作员        | المشغّل           | de: Bediener · ja: 担当者 (that is owner)                             |                                                                                                                                                             |
| queue                      | cola                         | file d'attente         | Warteschlange       | キュー              | fila                       | 队列          | قائمة الانتظار    | —                                                                     |                                                                                                                                                             |
| evidence                   | evidencia                    | preuve                 | Nachweis            | 証跡                | evidência                  | 证据          | الدليل            | es: prueba(s) (collides with trial and test) · ja: 証拠 (legal proof) | Tax documents: justificantes fiscales, justificatifs fiscaux, Steuernachweise, 税務証憑, comprovantes fiscais, 税务凭证, المستندات الضريبية.                |
| audit trail                | registro de auditoría        | piste d'audit          | Audit-Trail         | 監査証跡            | trilha de auditoria        | 审计跟踪      | سجل التدقيق       | zh: 审计时间线                                                        |                                                                                                                                                             |
| record (noun)              | registro                     | enregistrement         | Datensatz           | 記録                | registro                   | 记录          | السجل             | fr: dossier, données · de: Akte · ja: レコード                        | The legal "agreement record" may use dossier/Akte only in signing copy that means the legal file.                                                           |
| workspace                  | espacio de trabajo           | espace de travail      | Arbeitsbereich      | ワークスペース      | espaço de trabalho         | 工作区        | مساحة العمل       | —                                                                     |                                                                                                                                                             |
| account                    | cuenta                       | compte                 | Konto               | アカウント          | conta                      | 账户          | الحساب            | zh: 帐户                                                              |                                                                                                                                                             |
| account owner (role)       | propietario de la cuenta     | propriétaire du compte | Kontoinhaber        | アカウント所有者    | proprietário da conta      | 账户所有者    | مالك الحساب       | es/pt: titular · de: Eigentümer                                       |                                                                                                                                                             |
| owner (assignee)           | responsable                  | responsable            | Verantwortliche(r)  | 担当者              | responsável                | 负责人        | المسؤول           | —                                                                     | Separate message IDs from the role.                                                                                                                         |
| organization               | organización                 | organisation           | Organisation        | 組織                | organização                | 组织          | المؤسسة           | —                                                                     |                                                                                                                                                             |
| provider (third party)     | proveedor                    | prestataire            | Anbieter            | プロバイダー        | provedor                   | 服务商        | المزوّد           | fr: fournisseur                                                       | Payment, signing, support, marketplace providers.                                                                                                           |
| supplier (procurement)     | proveedor                    | fournisseur            | Lieferant           | 仕入先              | fornecedor                 | 供应商        | المورّد           | ja: サプライヤー                                                      | Supplier onboarding: alta de proveedores, référencement fournisseur, Lieferantenaufnahme, 仕入先登録, cadastro de fornecedores, 供应商准入, تسجيل الموردين. |
| webhook                    | webhook                      | webhook                | Webhook             | Webhook             | webhook                    | Webhook       | Webhook           | ar: الويب هوك                                                         | Latin script in every language.                                                                                                                             |
| up to date / stale         | actualizado / desactualizado | à jour / non à jour    | aktuell / veraltet  | 最新 / 最新ではない | atualizado / desatualizado | 最新 / 非最新 | محدّث / غير محدّث | fr: obsolète · zh: 已过时                                             | Record freshness. "Refresh": actualizar, actualiser, aktualisieren, 再読み込み, atualizar, 刷新, تحديث.                                                     |

### Amounts: estimated, invoiced, recorded, provider-confirmed

These four are never interchangeable (policy rule 6). A translation that turns
an estimate into an invoiced amount, or a recorded payment into a confirmed one,
is a defect.

| English                     | es                          | fr                          | de                     | ja                   | pt                       | zh           | ar              | Avoid                                              |
| --------------------------- | --------------------------- | --------------------------- | ---------------------- | -------------------- | ------------------------ | ------------ | --------------- | -------------------------------------------------- |
| estimated                   | estimado                    | estimé                      | geschätzt              | 推定                 | estimado                 | 预计         | تقديري          | forms meaning "billed" or "final"                  |
| invoiced                    | facturado                   | facturé                     | in Rechnung gestellt   | 請求済み             | faturado                 | 已开票       | مفوتر           | es/pt: cobrado (means collected)                   |
| recorded (payment recorded) | registrado                  | enregistré                  | erfasst                | 記録済み             | registrado               | 已记录       | مسجّل           | forms meaning "paid" or "received"                 |
| provider-confirmed          | confirmado por el proveedor | confirmé par le prestataire | vom Anbieter bestätigt | プロバイダー確認済み | confirmado pelo provedor | 服务商已确认 | مؤكد من المزوّد | forms without the provider as the confirming party |
| collected (cash received)   | cobrado                     | encaissé                    | vereinnahmt            | 回収済み             | recebido                 | 已收款       | محصّل           | —                                                  |

"Record payment" is not "pay": registrar pago, enregistrer le paiement, Zahlung
erfassen, 支払いを記録, registrar pagamento, 记录付款, تسجيل دفعة (the existing
`projection.action.pay` values are correct and tested).

## Homographs: one English word, separate message IDs

Each sense gets its own message ID, even when the English is identical. The
shared ones already exist and are read-only for lanes:

| Sense                              | Message ID                                                                                         |
| ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| Open (status) / Open (action)      | `status.open` / `common.open`                                                                      |
| Draft (status) / Draft (verb)      | `status.draft` / `common.draftAction`                                                              |
| Review (status) / Review (verb)    | `status.inReview`, `status.review` ("Needs review") / `common.review`                              |
| Order (commercial) / Sort order    | `recordKind.order` / `common.sortOrder`                                                            |
| Close (dialog) / Month-end close   | `common.close` / `common.monthEndClose`                                                            |
| Pending, Due, Overdue              | `status.pending`, `status.due`, `status.overdue`; invoice-agreeing forms `status.invoice.*`        |
| Due {date} (deadline phrase)       | `common.dueOn`                                                                                     |
| Owner (role) / Owner (assignee)    | `role.owner` / `common.owner`                                                                      |
| Active (generic, order, agreement) | `status.active`, `status.order.active`; agreement "in force" is a lane message until one is needed |

| English             | Sense                   | es                | fr                 | de               | ja           | pt              | zh                             | ar              |
| ------------------- | ----------------------- | ----------------- | ------------------ | ---------------- | ------------ | --------------- | ------------------------------ | --------------- |
| Open                | status                  | Abierto/Abierta   | Ouvert/Ouverte     | Offen            | 未完了       | Aberto/Aberta   | 未结 (invoice), 未完成 (quote) | مفتوح/مفتوحة    |
| Open                | action                  | Abrir             | Ouvrir             | Öffnen           | 開く         | Abrir           | 打开                           | فتح             |
| Draft               | noun, status            | Borrador          | Brouillon          | Entwurf          | 下書き       | Rascunho        | 草稿                           | مسودة           |
| Draft               | verb                    | Redactar          | Rédiger            | Entwerfen        | 下書きを作成 | Redigir         | 起草                           | صياغة           |
| Review              | noun, status            | En revisión       | En cours d'examen  | In Prüfung       | 確認中       | Em análise      | 审核中                         | قيد المراجعة    |
| Review              | verb                    | Revisar           | Examiner           | Prüfen           | 確認         | Revisar         | 审核                           | مراجعة          |
| Order               | commercial order        | Pedido            | Commande           | Auftrag          | 注文         | Pedido          | 订单                           | طلب             |
| Order               | sort order              | Orden             | Ordre de tri       | Sortierung       | 並べ替え順   | Ordem           | 排序                           | الترتيب         |
| Close               | dialog, menu            | Cerrar            | Fermer             | Schließen        | 閉じる       | Fechar          | 关闭                           | إغلاق           |
| Close               | month-end close         | Cierre            | Clôture            | Abschluss        | 締め         | Fechamento      | 结账                           | الإقفال         |
| Pending             | status                  | Pendiente         | En attente         | Ausstehend       | 保留中       | Pendente        | 待处理                         | قيد الانتظار    |
| Due                 | payment due (status)    | Pendiente de pago | À régler           | Fällig           | 未払い       | A pagar         | 待付款                         | مستحقة الدفع    |
| Overdue             | past due (status)       | Vencida           | En retard          | Überfällig       | 期限超過     | Vencida         | 已逾期                         | متأخرة          |
| Due {date}          | deadline phrase         | Vence el {date}   | Échéance le {date} | Fällig am {date} | 期限 {date}  | Vence em {date} | {date} 到期                    | تستحق في {date} |
| Active              | service running         | Activo            | Actif              | Aktiv            | 稼働中       | Ativo           | 运行中                         | نشطة            |
| Active              | agreement in force      | Vigente           | En vigueur         | In Kraft         | 有効         | Vigente         | 生效中                         | سارية           |
| Issue               | verb (issue a quote)    | Emitir            | Émettre            | Ausstellen       | 発行         | Emitir          | 出具                           | إصدار           |
| Issue               | support issue           | Incidencia        | Incident           | Problem          | 問題         | Chamado         | 问题                           | مشكلة           |
| Record              | noun                    | Registro          | Enregistrement     | Datensatz        | 記録         | Registro        | 记录                           | السجل           |
| Record              | verb (record a payment) | Registrar         | Enregistrer        | Erfassen         | 記録         | Registrar       | 登记                           | تسجيل           |
| Charge              | fee or line             | Cargo             | Frais              | Gebühr           | 料金         | Encargo         | 费用                           | رسوم            |
| Charge              | verb (charge a card)    | Cobrar            | Débiter            | Belasten         | 請求         | Cobrar          | 扣款                           | خصم             |
| Settle / settlement | commission settlement   | Liquidación       | Règlement          | Abrechnung       | 精算         | Liquidação      | 结算                           | تسوية           |
| Release             | release a hold          | Liberar           | Lever              | Aufheben         | 解除         | Liberar         | 解除                           | رفع الحجز       |
| Release             | software release        | Versión           | Version            | Release          | リリース     | Versão          | 版本                           | إصدار           |
| Owner               | role                    | Propietario       | Propriétaire       | Inhaber          | 所有者       | Proprietário    | 所有者                         | المالك          |
| Owner               | assignee                | Responsable       | Responsable        | Verantwortlich   | 担当者       | Responsável     | 负责人                         | المسؤول         |

`fr` "Vérifier" is for "check"; "Examiner" is the review of a request or record.

Status adjectives agree with their noun in `es`, `fr`, `pt` and `ar`. A status
chip shared by nouns of different gender needs either one message per noun class
or a noun-free form ("En curso", "En cours", "Em andamento").

## Legal and authority copy (policy rule 6)

Preserve negation, scope, and who may act exactly: "does not", "only", "cannot",
"must", "void", "teardown", "decline", and the four amount states above. A
translation that softens, shifts, or flips any of them is a defect.

| Lang | Watch for                                                                                                                                                                                           |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| es   | "no" before the verb it negates; "solo" must scope the same element as "only"; do not merge "rechazar" (reject) and "declinar" (decline).                                                           |
| fr   | "ne … que" for "only"; keep "ne … pas" and "aucun" on the verb or noun the source negates; "refuser" and "rejeter" are different acts.                                                              |
| de   | "nicht" versus "kein"; do not add "noch" ("not yet") where the source is a flat "does not"; "nur" placement; "ablehnen" versus "zurückweisen".                                                      |
| ja   | 〜ません / 〜ない must sit on the right verb; 「注文は確定しません」 ("the order is not confirmed") is not "does not place an order" (注文は作成されません); 「のみ」 for "only"; 辞退 versus 却下. |
| pt   | "não" before the verb; "só/somente/apenas" scope; "desativação" is reversible and must not stand in for teardown.                                                                                   |
| zh   | 不会 / 不得 / 仅; 仅 must precede what it limits; 拒绝 versus 驳回.                                                                                                                                 |
| ar   | لا / لن / ليس with the correct verb; فقط and إلا scope; do not merge رفض and ردّ.                                                                                                                   |

## Existing-catalog inconsistencies

Found in the flat catalogs as they stood before the foundation migration. The
migration kept every value; each item below is fixed by the lane that owns the
message ID when it next touches it (see `lanes.json` for ownership).

### Meaning errors (fix first)

- `orders.accept.unavailable.description`, all seven locales: "issued quote"
  became "accepted quote" (es aceptada, fr accepté, de angenommenen, ja受諾済み,
  pt aceita, zh 已接受, ar مقبول).
- `workflow.confirm.detail`, es fr de ar: "a decline, rejection, or teardown
  request" collapsed to one refusal word plus teardown; the rejection case is
  lost.
- `quotes.issue.description`: de "noch keine Bestellung" adds "not yet" and uses
  the PO word; ja 「注文は確定しません」 says the order is not confirmed rather
  than not created.
- `state.validation.description`, de: "Mindestangebot" ("minimum offer") for
  "the selected offer minimum".
- `app.product`, es ja pt zh ar: the product name "Commerce" was translated.
- `ui.42`, `cp.commercial.quoteStages.1`, `ui.37`,
  `partner.detail.transfer.description`, `partner.detail.merchant.description`:
  "route" rendered as channel in es, fr, de (Kanal), ja, pt, zh.
- `cp.partner.transferPrice`, `cp.partner.boundary`: de "Verrechnungspreis" and
  ja 移転価格 are the intercompany tax term.
- `status.blocked`, ar: "محظور" means prohibited; use "متوقف".
- `dashboard.openQuotes`, zh: 开放报价 means "quotes open to the public";
  use 未完成报价.
- `dashboard.empty.services`, `partner.description`,
  `app.account.choose.description`, zh: 活跃 ("lively") for active;
  use 运行中 or 有效.

### Register

- es uses tú in 99 messages and usted in 4 (`clientReview.title`,
  `clientReview.name`, `clientReview.visible`, `clientReview.seller`). tú
  messages: `quotes.form.description`, `quotes.form.offerHelp`,
  `quotes.form.reviewTitle`, `quotes.form.reviewDescription`,
  `quotes.form.expiryHelp`, `quotes.form.expiryFuture`,
  `quotes.form.partnerDescription`, `quotes.issue.description`,
  `quotes.issue.refresh`, `quotes.issue.pricingReview`,
  `quotes.issue.documentUnavailable`, `quotes.issue.rendering`,
  `cp.common.noMatchBody`, `cp.common.permissionTitle`,
  `cp.common.permissionBody`, `cp.common.errorBody`,
  `cp.common.freshnessStaleBody`, `cp.customer.dashboardGreeting`,
  `cp.customer.accountDescription`,
  `cp.customer.collections.procurement.description`,
  `cp.customer.collections.marketplace.description`,
  `cp.customer.collections.support.description`,
  `cp.commercial.externalPayment`, `operations.stale`, `ui.26`, `ui.49`,
  `ui.59`, `ui.61`, `ui.72`, `ui.75`, `ui.85`, `ui.106`, `ui.108`, `ui.110`,
  `settings.description`, `settings.language.description`, `settings.error`,
  `demo.access.title`, `demo.access.description`, `demo.access.invalid`,
  `demo.landing.title`, `app.command.noResults`,
  `app.command.action.customerQuote`, `app.command.action.inviteUser`,
  `app.command.action.registerDeal`, `app.command.action.partnerQuote`,
  `app.command.action.globalSearch`, `app.command.action.reviewApprovals`,
  `app.account.choose.title`, `app.account.choose.description`,
  `app.account.choose.empty.description`, `app.offline`, `app.online`,
  `session.expired.title`, `session.expired.description`,
  `session.mfa.description`, `session.permission.title`,
  `session.permission.description`, `action.returnHome`,
  `agreements.execute.binding`, `agreements.execute.validation.authority`,
  `agreements.execute.validation.attestation`, `agreements.execute.accepted`,
  `quotes.builder.description`, `quotes.builder.created`,
  `orders.accept.unavailable.description`, `orders.accept.validation.po`,
  `orders.accept.validation.serviceStart`, `orders.accept.validation.authority`,
  `orders.accept.validation.confirmation`,
  `account.offboarding.validation.effectiveAt`,
  `account.offboarding.validation.confirmation`,
  `account.offboarding.requested`, `partner.description`,
  `partner.quotes.description`, `partner.renewals.description`,
  `partner.brand.description`, `partner.access.title`,
  `partner.access.description`, `partner.detail.notFound.description`,
  `partner.detail.quote.issue.description`,
  `partner.detail.quote.cancel.description`,
  `partner.quote.new.disabled.unconfirmed`,
  `partner.quote.new.disabled.created`, `partner.quote.new.success`,
  `support.description`, `signing.description`, `signing.failed`,
  `state.empty.description`, `state.validation.title`,
  `state.stale.description`, `state.fatal.description`,
  `projection.action.conflict`, `signing.serverSelected`, `signing.unchanged`,
  `signing.choose.title`, `signing.demo.unavailable.description`,
  `workflow.confirm.title`, `workflow.confirm.detail`.
- ja buttons and headings in 〜する/〜させる form: `clientReview.respond`,
  `clientReview.requestOrder`, `clientReview.requestChanges`,
  `clientReview.decline`, `quotes.issue.title`.
- de, fr, pt: no du, tu or tu-forms found.

### Terminology

- Quote, es: "cotización" in most messages, "oferta" in
  `quotes.form.reviewDescription`, `quotes.issue.description`,
  `quotes.issue.refresh`, `quotes.issue.documentUnavailable`,
  `quotes.issue.rendering`, `quotes.issue.synchronizing`, `quotes.issue.title`,
  `quotes.issue.action`, `quotes.issue.working`, `quotes.issue.retry`,
  `partner.detail.quote.issue.description`. Glossary: presupuesto.
- Quote, pt: "cotação" in `clientReview.*`, `quotes.form.*`, `quotes.issue.*`,
  `cp.*`; "proposta" in `nav.quotes`, `nav.partner.quotes`,
  `action.createQuote`, `dashboard.openQuotes`, `quotes.title`,
  `quotes.builder.*`, `orders.accept.*`, `partner.quotes.*`,
  `partner.detail.quote.*`, `partner.quote.new.*`, `partner.brand.description`,
  `state.empty.description`, `projection.action.convertPoc`,
  `projection.action.price`. Glossary: cotação.
- Issue, zh: 发布 (`quotes.form.reviewDescription`, `quotes.issue.*`,
  `partner.detail.quote.issue.description`), 发出 (`quotes.description`,
  `quotes.builder.created`,
  `partner.detail.quote.issue.title`), 出具 (`cp.commercial.*`,
  `orders.accept.source`). Glossary: 出具. de: "ausgegeben"
  (`quotes.description`), "Ausgabe" (`quotes.builder.created`,
  `partner.detail.quote.issue.title`) versus "ausstellen".
- Offer, de: "Angebot" (= quote) in `quotes.form.description`,
  `quotes.form.offerHelp`, `quotes.form.partnerDescription`,
  `cp.commercial.quoteStages.0`. ar: "عرض" for offer in the same keys.
- Order, de: "Bestellung" in `quotes.issue.accept`, `quotes.issue.description`,
  `quotes.form.reviewDescription`, `clientReview.requestOrder`; "Auftrag"
  elsewhere.
- Purchase order, pt: "pedido de compra" in `cp.commercial.orderConfirmation`,
  `cp.commercial.orderTermsHelp`; "ordem de compra" elsewhere. fr: "bon de
  commande" used for the order form in `cp.commercial.orderArtifactRetention`.
- Order form, zh: 订单表单 in `orders.accept.prepared`,
  `cp.commercial.orderArtifactRetention`.
- Agreement, pt: "contrato" in `cp.commercial.agreementAuthority`,
  `cp.commercial.agreementReview`, `cp.commercial.orderConfirmation`,
  `cp.partner.deskDescription`, `cp.partner.agreementClock`; "acordo" elsewhere.
- Amendment: pt "alterações"
  (`cp.customer.collections.amendments.searchPlaceholder`), ja 変更 and de
  "Änderungen" in the same key and in `orders.description`;
  zh 修订 (`nav.amendments`, `orders.amendment`,
  `projection.action.applyAmendment`) collides with quote revision.
- Transfer price: de "Transferpreis" (`quotes.form.partnerDescription`,
  `partner.quotes.description`) versus "Verrechnungspreis";
  ja 仕切価格, 移転価格 and 仕入価格 (`partner.quotes.description`,
  `internal.priceBooks.description`);
  zh 转移价格 versus 内部转移价格 (`partner.quotes.description`); es, fr, pt, ar
  calques throughout.
- End client: ja 最終顧客 (`cp.partner.boundary`);
  zh 最终客户 (`quotes.form.partnerDescription`, `cp.partner.boundary`).
- Merchant of record: de and ja values read as a person
  (`cp.partner.merchantOfRecord`).
- Renewal, ja: bare 更新 (`nav.partner.renewals`, `ui.22`, `ui.36`, `ui.38`,
  `cp.partner.renewalReview`) collides with refresh 更新 (`ui.124`, `ui.31`,
  `ui.16`).
- Notice, de: "Mitteilungstermin", "Mitteilungsfrist", "Verlängerungsmitteilung"
  (`ui.22`, `ui.23`, `ui.36`, `ui.37`) versus "Kündigungsfrist". pt: bare
  "aviso" throughout.
- Approval, de: "Freigabe" in most keys, "genehmigen" in
  `projection.action.approveException`,
  `cp.customer.collections.users.description`.
- Account owner: es "titular" (`cp.common.permissionBody`,
  `cp.customer.quotePermissionNote`, `cp.customer.accountPermissionNote`) versus
  "propietario" (`session.permission.description`,
  `projection.action.readOnly`); pt "titular" versus "proprietário" in the same
  keys; de "Eigentümer" (`session.permission.description`).
- Operator: de "Bediener" (`ui.26`, `ui.75`); ja 担当者 for operator (`ui.26`,
  `ui.72`, `ui.75`) equals owner (`ui.90`).
- Trial: de "Tests", pt "testes", ar "التجارب", es "pruebas" in `nav.payg`,
  `nav.internal.paygOffers`.
- Evidence, es: "pruebas" (`workflow.confirm.detail`, `ui.98`,
  `agreements.description`, `detail.description`, `internal.gates.description`,
  `internal.collections.description`), "prueba" (`agreements.execute.accepted`),
  "evidencia" (`cp.commercial.orderArtifactRetention`).
  ja: 証拠 (`cp.commercial.orderArtifactRetention`,
  `internal.collections.description`) versus 証跡;
  tax 証憑 versus 証跡 (`ui.108`, `account.description`).
- Supplier, ja: サプライヤー (`cp.customer.collections.procurement.description`)
  versus 仕入先. zh: 准入 versus 入驻 (`ui.108`, `account.description`).
- Entitlement, de: "Berechtigungen" (`orders.description`) and
  "Berechtigungsprozess" (`partner.sandboxes.description`) mean permissions.
- Teardown, pt: "desativação" (`projection.action.requestTeardown`, `ui.110`,
  `workflow.confirm.detail`).
- Offboarding: fr "sortie" versus "clôture"
  (`cp.customer.accountPermissionNote`); de "Austritt" versus "Offboarding"
  (same key); zh 退出 throughout.
- Dunning: de "Mahnverfahren" (`projection.action.evaluateDunning`); pt
  "cobrança" (`projection.action.evaluateDunning`,
  `internal.collections.description`).
- Exception, zh: 异常 (`nav.group.internal.queues`, `internal.queues.title`,
  `app.command.action.reviewApprovals`)
  versus 例外 (`projection.action.approveException`,
  `projection.action.rejectException`).
- Review, zh: 审查 (`action.review`, `approval.reviewApprove`,
  `nav.internal.approvals`, `ui.49`, `ui.106`, `ui.110`) versus 审核.
- Accept, ja: 受諾 (`orders.accept.unavailable.title`,
  `orders.accept.unavailable.description`, `orders.accept.validation.authority`,
  `dashboard.empty.services`) versus 承諾.
- Region: ja 地域 and zh 地区 in `chart.capacity`.
- Deal registration: de "Chancenregistrierung" (`nav.partner.registrations`,
  `partner.registration.title`), "Chance registrieren" (`action.register`),
  "Partnerchance" (`app.command.action.registerDeal`) versus
  "Deal-Registrierung" (`cp.partner.registrationReview`);
  zh 商机登记 throughout.
- Record: ja レコード (`action.open`, `state.success.title`,
  `workflow.confirm.detail`, `app.command.action.globalSearch`,
  `states.offline.description`) versus 記録; de "Akte" (`signing.unchanged`,
  `signing.returned`, `signing.demo.unavailable.description`,
  `partner.detail.portfolio.eyebrow`) versus "Datensatz"; fr "dossier" and
  "données" (`cp.common.freshness*`) versus "enregistrement".
- Provider, fr: "fournisseur" (`signing.*`, `internal.gates.description`,
  `ui.59`) versus "prestataire" (`cp.commercial.paymentWebhook`,
  `cp.commercial.externalPayment`,
  `cp.customer.collections.support.description`).
- Status label, fr: "État" (`common.status`); use "Statut".
- Webhook, ar: "الويب هوك" (`cp.commercial.paymentWebhook`) versus Latin
  "Webhook" (`nav.internal.webhookReplay`).
- Brand grammar: pt "do Fil One" (`app.footer`); de compounds "Fil One-Team"
  (`quotes.issue.pricingReview`) and "Fil One-Kosten"
  (`partner.detail.transfer.description`); ja "Fil Oneは"/"Fil Oneの" without
  the space (`quotes.form.partnerDescription`, `quotes.issue.pricingReview`,
  `cp.partner.transferPrice`).
- Keyboard shortcut: `app.command.shortcut` translates the macOS key name in es
  ("Comando K"), fr ("Commande K"), de ("Befehl K"), pt ("Comando K"); show the
  key glyph ("⌘K") in every language.

### Typography

- Fixed by the foundation: every French value now uses U+202F before `;`, `!`,
  `?` and U+00A0 before a colon (38 values, including
  `quotes.issue.synchronizing`, `cp.common.freshnessPartialBody`,
  `cp.common.unsavedTitle`, `operations.providerSummary`,
  `operations.invoiceSummary`, `app.account.switched`,
  `projection.action.rejected`, `projection.action.confirm.title`), and the
  Arabic tatweel in `dashboard.description` ("لـ Northstar" became "لحساب
  Northstar"). `catalogs.test.ts` now enforces both.
- zh digits touching Han characters (38 other messages use the space): `ui.23`,
  `dashboard.empty.capacity`, `internal.renewals.description`.
- ja space between a count and its counter: fixed in the plural messages the
  foundation converted (`operations.*`, `customer.account.*`,
  `platform.term.count`); check any others when you touch them.
- No findings for `...`, ASCII apostrophes in fr, ASCII double quotes in de/pt,
  `¿`/`¡` pairing in es, ASCII punctuation next to CJK, full-width Latin, spaces
  between Han characters, or traditional characters in zh.

### Values identical to English

A translation identical to English fails `catalogs.test.ts` unless it is marked.
The marker is per language, so German keeping "Status" does not exempt Spanish:

- `de: sameAsEnglish("Status")` in a message: this language deliberately uses
  the English form. The marker must equal the English text, so an English edit
  forces the translator to look again.
- `sameInAllLanguages("Fil One", "product name")` for the whole message: never
  translated. The reason is required and is read in review.
- A value with no letters outside placeholders (`{action}?`) needs no marker.

Decisions on the values the migration found identical (all marked in the
modules; each lane may revisit its own):

| Value                                                                          | Locales        | Decision | Why                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------ | -------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fil One, Fil One Commerce                                                      | all            | Keep     | Product and company name.                                                                                                                                                                                |
| Marketplace (`nav.marketplace`, partner nav)                                   | es, fr, de, pt | Keep     | AWS, Azure and Google Cloud keep "Marketplace" in these languages ("AWS Marketplace", "Azure Marketplace"); the nav item names that channel. ja マーケットプレイス, zh 云市场, ar السوق الإلكتروني stay. |
| Demo (`app.demo.short`)                                                        | es, de, pt     | Keep     | The loanword is the normal badge text in all three.                                                                                                                                                      |
| Status                                                                         | de, pt         | Keep     | Both languages use "Status" in product UI.                                                                                                                                                               |
| Version, Details, Support, Navigation                                          | fr, de         | Keep     | Native words with the same spelling.                                                                                                                                                                     |
| Action(s), Date, Document(s), Service, Commissions, Migrations, Administration | fr             | Keep     | Native words with the same spelling.                                                                                                                                                                     |
| `{count} export` / `{count} exports`                                           | fr             | Keep     | "un export", "des exports" is standard French product usage.                                                                                                                                             |
| Envelope (`signing.demo.envelope`)                                             | pt             | Keep     | DocuSign's pt-BR interface calls it "envelope".                                                                                                                                                          |
| Opportunity (partner registrations column)                                     | de             | Keep     | The CRM term used by German sales teams (Salesforce de: "Opportunity").                                                                                                                                  |
| Command K (`app.command.shortcut`)                                             | ja, zh, ar     | Change   | Show the key glyphs "⌘K" in every language (and "Ctrl K" where the shell shows it), not the English key name. Platform lane.                                                                             |
| Comando K / Commande K / Befehl K                                              | es, fr, de, pt | Change   | Same: key names are not translated; use "⌘K". Platform lane.                                                                                                                                             |
