# Contract templates

Staff prepare Fil One agreements from templates with **New from template** on
the Contracts page (`/internal/contracts/templates`). A template is agreement
wording stored as data: headings, paragraphs and tables with `[[field]]` tokens,
the fields a seller fills in, the optional sections a contract may include, and
the SHA-256 of that content.

Templates live in the template store, a table in the Commerce database, and
commerce administrators manage them in Commerce (`contract_template:manage`).
Agreement wording never goes in this repository, which is public. It holds only
the guided demo's sample templates and a test fixture.

Staff can still record any agreement manually, with its PDFs, with **Record a
contract** on the same page.

## Making a template live

1. **Import or draft.** On **Prepare from template**, choose **Manage
   templates** (`/internal/contracts/manage-templates`), then **New template
   version**. Import a template file (format below) or start blank. Commerce
   checks a file and lists any problems before anything is saved. The result is
   a draft: version 1 of a new template, or the next version of an existing
   template key.
2. **Edit the draft.** The editor covers the basics, fields, optional sections,
   worked-out figures and the wording block by block. Give it a source note that
   says where the wording came from, for example
   `Counsel draft 8 Sept 2026, clean`. The note is kept with the version and
   never printed.
3. **Check the specimen.** **Preview specimen PDF** renders the template with
   every optional section in, including each alternative a choice field selects,
   and every field showing its default or a sample value. Share it with counsel
   when they review the wording.
4. **Activate for use.** Your name and the time are recorded as the activation,
   on the version and in the audit log, and sellers prepare from it at once. The
   version in use before it is retired. Activation records who put a version
   into use; it is not a record of counsel's approval.
5. **Change it later.** An activated version is fixed. **Duplicate as new
   version** starts a draft from it, and activating that draft retires the old
   one. **Retire** takes a template out of use; a retired version can be
   activated again. **Download JSON** gives you the file of any version.

Creating, editing, activating, retiring and discarding are audited as
`contract_template.*` events. A prepared contract keeps the template key, the
version label (such as `v3`) and the content hash. The database refuses a
preparation against anything but the active version with that hash, and refuses
any change to a version a contract was prepared from, or to the record of who
activated or retired a version. A seller whose form was built for a version that
has since been replaced or retired is asked to reload. A discarded draft's
version number is never reused, and its audit event keeps its content.

A stored version whose content no longer passes the checks or matches its hash
is left out of the templates sellers see, and its page offers only **Retire**.

Before relying on a new template, prepare one contract from it with your own
email as the counterparty signer, approve it from a second account, send it and
sign both sides. Sending stays in SignWell test mode until
`COMMERCE_CONTRACTS_TEST_MODE` is set to `false`; test-mode signatures are not
legally binding.

In the guided demo, sellers fill in the sample templates and preview the PDF,
and administrators can check a file and preview its specimen. Preparing and
every change to the template store are refused.

## Template file format

```json
{
  "id": "channel-partnership",
  "contractType": "channel_partnership",
  "name": "Channel Partnership Agreement",
  "requiresApproval": true,
  "sourceNote": "Counsel draft 8 Sept 2026, clean",
  "fields": [
    {
      "id": "partnership_model",
      "kind": "choice",
      "required": true,
      "label": { "en": "Elected commercial model" },
      "default": "Option B (default)",
      "options": [
        {
          "value": "Option B (default)",
          "label": { "en": "Option B (default)" }
        },
        { "value": "Option A", "label": { "en": "Option A" } }
      ]
    },
    {
      "id": "referral_fee_percent",
      "kind": "percent",
      "required": true,
      "label": { "en": "Referral fee" },
      "help": { "en": "Percent of first-year fees." }
    }
  ],
  "sections": [
    {
      "id": "option_a",
      "label": { "en": "Option A hard gate" },
      "when": { "field": "partnership_model", "in": ["Option A"] }
    },
    { "id": "schedule_e", "label": { "en": "Schedule E: Exclusivity" } }
  ],
  "derived": [],
  "document": {
    "title": "CHANNEL PARTNERSHIP AGREEMENT",
    "blocks": [
      { "type": "heading", "text": "2. FEES" },
      {
        "type": "paragraph",
        "text": "**2.1 Referral fee.** Partner earns [[referral_fee_percent]]% of the fees its accounts pay in their first year."
      },
      {
        "type": "table",
        "section": "option_a",
        "widths": [1, 10, 2],
        "rows": [
          ["#", "Question", "Answer"],
          ["1", "Will Partner resell under its own paper?", "Yes / No"]
        ]
      },
      { "type": "pageBreak" }
    ]
  }
}
```

| Key                | Meaning                                                                                                                                         |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`               | The template key, shared by every version. Lowercase letters, digits and hyphens. Sellers' links use it.                                        |
| `contractType`     | The register type the prepared contract is filed under.                                                                                         |
| `name`             | English name, used in the PDF and in the SignWell document name and email subject (`Fil One <name> - <counterparty>`).                          |
| `requiresApproval` | `true` means someone with contract approval rights, other than the person who prepared it, must approve before it can be sent.                  |
| `sourceNote`       | Optional. Where the wording came from. Not part of the content hash and never printed.                                                          |
| `fields`           | The blanks a seller fills in, in the order shown on the form.                                                                                   |
| `sections`         | Optional parts of the agreement. See [Optional sections](#optional-sections).                                                                   |
| `derived`          | Figures worked out from numeric fields. See [Worked-out figures](#worked-out-figures).                                                          |
| `document`         | The wording as `heading`, `paragraph`, `table` and `pageBreak` blocks. The signature page is added automatically and is not part of the blocks. |

A file downloaded from a version imports as it is. A file may be up to 900 KB.

### Wording

Copy each heading and paragraph of the source into its own block, in order, and
put each blank's token where the blank was: `[[field_id]]`. `**text**` prints
bold. A `table` block has `rows` of up to six cells; the first row is a heading
unless `"header": false`, and optional `widths` set relative column widths. In
the editor, cells are separated by `|`; write `\|` for a `|` inside a cell.
Tokens work in table cells too.

Literal brackets, such as `[ ]` checkboxes, are fine; only double brackets are
tokens. Every token must be declared, or the template is refused. A missing
value is an error, never a blank in the PDF. Text must use characters the PDF
fonts draw (Latin script and common punctuation), so a symbol such as `≥` is
refused: write it in words. Braces, `{` and `}`, are reserved for signing tags
and refused anywhere in the wording, the title and the name.

These tokens are always available and need no field:

| Token                     | Value                           |
| ------------------------- | ------------------------------- |
| `[[counterparty_name]]`   | Counterparty legal name         |
| `[[effective_date]]`      | Effective date, as `YYYY-MM-DD` |
| `[[signer_name]]`         | Counterparty signer's name      |
| `[[signer_email]]`        | Counterparty signer's email     |
| `[[signer_title]]`        | Counterparty signer's job title |
| `[[countersigner_name]]`  | Fil One countersigner's name    |
| `[[countersigner_title]]` | Fil One countersigner's title   |

### Fields

| `kind`       | Form control     | Value in the PDF                                                            |
| ------------ | ---------------- | --------------------------------------------------------------------------- |
| `text`       | Text box         | As typed, up to `maxLength` (default 200, at most 2000)                     |
| `email`      | Email box        | As typed, lowercased                                                        |
| `date`       | Date picker      | `YYYY-MM-DD`                                                                |
| `number`     | Numeric box      | Whole number                                                                |
| `decimal`    | Numeric box      | Up to six decimal places, printed with thousands separators                 |
| `percent`    | Numeric box, `%` | 0 to 100, up to four decimal places, as typed; write `%` after the token    |
| `choice`     | Drop-down list   | The option's `value` (so write values as they should read in the agreement) |
| `line_items` | Line-item editor | A priced table; see [Line items](#line-items)                               |

`label`, `help` and option labels need `en`; add `es`, `fr`, `de`, `ja`, `pt`,
`zh` and `ar` so sellers see their own language. A missing language shows the
English label. `default` is the value the form starts with. `section` makes a
field part of an optional section: it is asked for, and printed, only when the
section is in. A field with `"required": false` may be left blank and then
prints as nothing, so only make a field optional where the text reads correctly
without it. There are no business limits on numbers: a percentage can be any
figure from 0 to 100, and the approval step is where a figure is questioned.

Values are limited to the characters the PDF font can draw (Latin script) and
may not contain `< > [ ] { }`, so a value can never turn into a token or a
signing tag. Choice option values and defaults print too, so a template whose
options or defaults break these rules is refused when it is saved.

### Optional sections

A section is a part of the agreement a contract includes or leaves out: an
option, a schedule, an annex. Mark each block that belongs to it with
`"section": "<id>"`. Sellers tick a section on the form, starting from its
`default`. A section with `when` follows a choice field instead: it is in
exactly when that field holds one of the listed values, and sellers cannot tick
it. A token of a section field may only appear in blocks of the same section.

The sections a contract included are kept with its signing request, and a
preparation that replaces a voided contract starts with the same ones ticked.

### Worked-out figures

A `derived` entry works out a figure from numeric fields and prints it as
`[[id]]`, for example an illustrative commission:

```json
{
  "id": "earn_one",
  "op": "percent_of",
  "of": ["first_year_rate", "illustrative_spend"],
  "decimals": 0
}
```

`percent_of` takes a percent and an amount; `product` and `sum` take two or more
operands. An operand is a required numeric field, an earlier figure or a number
such as `5`. Results print with thousands separators and `decimals` places,
rounded half up.

### Line items

An order form, SOW or DPA schedule that prices services declares a `line_items`
field and puts its token in a paragraph of its own, where the table goes:

```json
{
  "id": "order_lines",
  "kind": "line_items",
  "required": true,
  "label": { "en": "Order lines" }
}
```

```json
{ "type": "paragraph", "text": "[[order_lines]]" }
```

The token prints as a table: item and region with an optional description, unit
price, quantity, term, discount and extended price, then the subtotal before
discounts, the discounts and the total with its currency. It uses the indicative
pricing summary's fonts and money formatting. A `line_items` field is always
required and takes no `maxLength`; its token cannot sit inside other text, in a
heading, a table or the title, or the template is refused.

Sellers type lines in or choose **Import from pricing scenario**, which copies a
saved scenario's lines and currency (their own scenarios, or every one for a
commerce administrator). Every line stays editable, unit price included, and
**Detach scenario** drops the link to the scenario while keeping the lines.

When the contract is prepared, the server checks:

- The table has 1 to 20 lines in one currency.
- Each line's extended price equals what the pricing calculator computes from
  its unit price, quantity, term and discount.
- Each line's quantity is at least the minimum of the in-force rate with the
  same item, region and unit, read from the price books at that moment. The
  browser's own figure is ignored. A line that matches no in-force rate, such as
  a service typed in by hand, has no minimum.
- Cells use the pricing summary's Latin characters, without `< > [ ] { }` and
  without invisible format characters such as zero-width spaces or right-to-left
  overrides.

Unit prices are not checked against a price book: a seller may enter any price,
and the approval step is where a price is questioned.

A table imported from a scenario is named in the contract's pricing notes,
compared with the scenario as it is when the contract is prepared. The note
gives the scenario's version and the day its list prices were read only when the
scenario is unchanged and every line still carries its scenario line's item,
region, unit, unit price, minimum and discount. Otherwise it says the lines were
edited after import and names them, or that the scenario has changed since. A
detached table gets no note. A scenario the seller can no longer open stops the
preparation until it is detached.

The table's header and total labels are Commerce's wording, so counsel approves
them with the rest of the specimen.

### A specimen from the command line

```sh
pnpm exec tsx scripts/render-contract-specimen.ts template.json /tmp/specimen.pdf
```

The script checks the file as the store does, prints any problems, and writes
the same specimen as **Preview specimen PDF**. `--demo <template-id>` renders
one of the demo's sample templates.

## How signing works

1. **Prepare.** The seller fills in the form. Commerce renders the PDF, stores
   it with its hash, and files a draft in the register.
2. **Approve.** If the template requires it, a person with contract approval
   rights other than the preparer approves it or sends it back with a reason.
   The database refuses a send before approval and refuses an approval by the
   preparer.
3. **Send.** Commerce creates an unsent SignWell draft, records its id, then
   sends it. The counterparty signs first, then the Fil One countersigner chosen
   from the countersigners set up in the MNDA register.
4. **Track.** SignWell callbacks only prompt Commerce to read the document back;
   the register status follows what SignWell reports.
5. **Archive.** When both have signed, the signed PDF with SignWell's signing
   record is stored with its hash and the contract is marked executed, in one
   step. SignWell emails the signed PDF to the signers and to the person who
   prepared the request.

A request that never reached SignWell can be discarded. Once it has, it is
voided in Commerce, with a reason, until the counterparty signs: Commerce reads
SignWell first, deletes the SignWell copy, and marks the request canceled. The
register row returns to draft and keeps the prepared PDF and the history. The
preparer can void their own request; anyone else needs contract approval rights.

If someone deletes the document in SignWell directly, the next refresh or
callback marks the request **SignWell no longer has this document** instead of
failing, and callbacks keep succeeding. Void it in Commerce to close it. The
same holds when SignWell's copy names other signers or does not belong to the
contract: nothing from that copy is applied, the request waits in attention
(`signwell_signers_mismatch` or `signwell_binding_mismatch`), and it can be
voided. A request is never voided once SignWell shows the counterparty's
signature, even when a bounced countersigner email has put it in attention.

When the counterparty's email bounced or was mistyped, **Fix email** on the
signing panel sends the request to the corrected address, until the counterparty
starts signing. Commerce records the new email as pending, asks SignWell to
change the recipient, and keeps the email once SignWell shows it; if SignWell's
answer is lost, the next refresh settles it. The signer's name stays, because it
may be printed in the agreement. The history records the address replaced. Once
the counterparty has started signing, or when a different person must sign,
choose **Someone else will sign**: Commerce voids the request with that reason
(no reason is typed), and the template's prepare page opens with the earlier
values and the signer left blank. The new preparation is a new contract record
and needs approval again where the template requires it; the voided one stays in
the register as a draft. For an uploaded PDF, choose the new signer in **Prepare
for signature** on the same contract instead. The same people who may void a
request may fix its email.

### Uploaded PDFs

Any unsigned contract with an uploaded main PDF or counterparty draft can be
sent for signature, on either party's paper: their agreement, or a term sheet,
channel terms letter, affiliate letter or teaming agreement Fil One drafted in
Word and uploaded as a PDF. **Prepare for signature** on the contract appends
the Fil One signature page to the chosen PDF and prepares it for SignWell,
pinned to that PDF's SHA-256. Choose **The counterparty, then Fil One** to have
them sign the added page first (the default on Fil One's paper), or **Fil One
only** when the counterparty already signed the PDF (the default on theirs, and
allowed on Fil One's paper for a signed scan). It always needs approval; a
commerce administrator may approve their own with a reason. For **Fil One
only**, the approval step says that the counterparty has already signed the PDF,
because the signature page states that their signature appears in it: the
approver checks the preview before approving. The signing panel then works as
for a template contract.

The signature page is on the PDF's paper size, A4 or Letter. It names both
parties (Fil One as FIL One LLC), states that each signs by an authorized
representative (or, for **Fil One only**, that the counterparty's signature
appears in the document), allows counterparts and electronic signatures, and
gives a name, title and date block for each signer and the PDF's SHA-256. Its
version is stored on each request; a change to the wording is a new version, and
requests already prepared keep theirs.

Form fields in the PDF are drawn into the page exactly as they look and removed,
so SignWell asks only for the signatures on the added page. A PDF whose form
cannot be drawn exactly is refused: print it to a flat PDF, upload that and send
it again. A draft SignWell still finds other fields in is held for a void and
never sent, and so is one whose SignWell copy would not email the preparer the
signed PDF (`signwell_copied_contacts_mismatch`). A PDF that was sent for
signature cannot be removed from the contract.

### Sending again

A contract has one current signing request. Once it was declined, expired or
voided, it can be sent again from the same record:

- **Send again** on the signing panel sends the same document to the same
  people, as a new request. A confirmed email correction carries over.
- For an uploaded PDF, **Prepare for signature** under the panel sends a
  different PDF, or the same one to a different signer.

The new request needs approval again where the first did. The ended request is
kept, unchanged, under **Earlier requests** on the panel, with the PDF it was
sent from. A completed request is never replaced, and an executed contract is
not sent again. A template voided because someone else will sign is prepared
again from the template, since the signer's name is printed in it.

Reminders go to whoever signs next and are spaced at least a minute apart,
counted from the last reminder. Each one is recorded in the contract's history
as `contract.reminded` with its recipient.

Downloading a contract PDF, exporting the register (which includes signed MNDAs
for readers of the MNDA register) and downloading a sales library PDF are each
audited, as `contract.file_downloaded`, `contract.register_exported` and
`sales_collateral.downloaded`.

## Configuration

| Variable                             | Effect                                                                                                                     |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `COMMERCE_CONTRACTS_SIGNING_ENABLED` | `true` turns on sending. Also needs `SIGNWELL_API_KEY` and `SIGNWELL_WEBHOOK_ID`, shared with MNDAs.                       |
| `COMMERCE_CONTRACTS_TEST_MODE`       | Anything other than `false` sends in SignWell test mode. Each request keeps the mode it was prepared in.                   |
| `COMMERCE_DOCUMENT_STORE`            | Where new PDFs are written. Only `postgres` exists today; any other value stops document reads and writes until supported. |

Deployed environments set the first two from Terraform (`deploy/app/main.tf`).
Sending is on unless the GitHub environment variable
`COMMERCE_CONTRACTS_SIGNING_ENABLED` is `false`; staging sends in test mode and
production sends live.

Recording contracts, uploading PDFs, the renewal notices list and the sales
library need none of these.

## Document storage

Contract and sales library PDFs are stored in the backed-up PostgreSQL database
(`commerce_stored_documents`), PDF only, at most 25 MB each, and each is checked
against its SHA-256 whenever it is opened. Contract rows record a storage
backend and key rather than the bytes, so a Fil One S3-compatible store can be
added as another `ContractDocumentStore` and selected with
`COMMERCE_DOCUMENT_STORE` without changing the contract tables; files already
stored keep being read from the database. As with MNDAs (ADR 0011), this is not
an S3 Object Lock or certified regulatory archive.
