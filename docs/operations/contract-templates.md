# Contract templates

Staff prepare Fil One agreements from templates with **New from template** on
the Contracts page (`/internal/contracts/templates`). A template is counsel's
approved wording stored as data, the fields a seller fills in, and the SHA-256
of counsel's source DOCX. Commerce never writes or edits agreement wording.

Until counsel supplies a template, its contract type is listed as **Template
pending from legal** and cannot be prepared. These are registered that way
today:

| Template id           | Contract type                 |
| --------------------- | ----------------------------- |
| `channel-partnership` | Channel partnership agreement |
| `customer-msa`        | Customer MSA                  |
| `order-form`          | Order form                    |
| `dpa`                 | Data processing addendum      |
| `security-annex`      | Security annex                |
| `nda-one-way`         | One-way NDA                   |
| `technology-partner`  | Technology partner agreement  |
| `sow`                 | Statement of work             |

Staff can still record any of these agreements manually, with their PDFs, with
**Record a contract** on the same page.

## Adding a template

You need counsel's approved DOCX, the date and name of the approval, and a list
of the blanks a seller fills in.

### 1. Pin counsel's DOCX

Put the file under `docs/legal/contracts/<template-id>/`, named as counsel named
it, and record its SHA-256:

```sh
mkdir -p docs/legal/contracts/channel-partnership
cp "~/Downloads/FIL One - Channel Partnership Agreement (approved).docx" \
  docs/legal/contracts/channel-partnership/
shasum -a 256 docs/legal/contracts/channel-partnership/*.docx
```

That hash identifies the legal wording. It is checked by a test against the file
in the repository, stored on every contract prepared from the template, and sent
to SignWell as document metadata, which Commerce checks again every time it
reads the document back. Never edit the DOCX in place: a new approval is a new
file and a new hash.

### 2. Write `template.json`

Create `packages/documents/src/contract-templates/<template-id>/template.json`:

```json
{
  "id": "channel-partnership",
  "contractType": "channel_partnership",
  "name": "Channel Partnership Agreement",
  "version": "2026-10-15",
  "requiresApproval": true,
  "source": {
    "path": "docs/legal/contracts/channel-partnership/FIL One - Channel Partnership Agreement (approved).docx",
    "sha256": "<the 64-character hash from step 1>",
    "counselApprovedBy": "<counsel's name and firm>",
    "counselApprovedOn": "2026-10-14"
  },
  "fields": [
    {
      "id": "partner_entity_type",
      "kind": "text",
      "required": true,
      "maxLength": 120,
      "label": {
        "en": "Partner entity type",
        "es": "Tipo de entidad del socio"
      },
      "help": { "en": "For example, Delaware corporation." }
    },
    {
      "id": "partnership_model",
      "kind": "choice",
      "required": true,
      "label": { "en": "Partnership model" },
      "options": [
        { "value": "referral", "label": { "en": "Referral" } },
        { "value": "resale", "label": { "en": "Resale" } }
      ]
    }
  ],
  "document": {
    "title": "CHANNEL PARTNERSHIP AGREEMENT",
    "blocks": [
      {
        "type": "paragraph",
        "text": "<counsel's first paragraph, with [[counterparty_name]] where the partner's name goes>"
      },
      { "type": "heading", "text": "<counsel's heading>" },
      { "type": "paragraph", "text": "<counsel's next paragraph>" },
      { "type": "pageBreak" }
    ]
  }
}
```

| Key                | Meaning                                                                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`               | Must match the stub it replaces (table above). Lowercase letters, digits and hyphens.                                                        |
| `contractType`     | The register type the prepared contract is filed under.                                                                                      |
| `name`             | English name, used in the PDF and in the SignWell document name and email subject (`Fil One <name> - <counterparty>`).                       |
| `version`          | Change it whenever the wording or fields change. Contracts already prepared keep their own version, hash and PDF.                            |
| `requiresApproval` | `true` means someone with contract approval rights, other than the person who prepared it, must approve before it can be sent.               |
| `source`           | Where counsel's DOCX is, its SHA-256 (step 1), who approved it and when.                                                                     |
| `fields`           | The blanks a seller fills in, in the order shown on the form.                                                                                |
| `document`         | Counsel's wording as `heading`, `paragraph` and `pageBreak` blocks. The signature page is added automatically and is not part of the blocks. |

#### Copying the wording

Copy each heading and paragraph of the DOCX into its own block, in order,
exactly as written. The only change you make is to replace each blank with a
token: `[[field_id]]`. Nothing else in the text may differ from counsel's file.

Literal brackets in counsel's text, such as `[ ]` checkboxes, are fine; only
double brackets are tokens. Every token must be declared, or the template fails
to load. A missing value is an error, never a blank in the PDF.

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

#### Fields

| `kind`       | Form control     | Value in the PDF                                                            |
| ------------ | ---------------- | --------------------------------------------------------------------------- |
| `text`       | Text box         | As typed, up to `maxLength` (default 200)                                   |
| `email`      | Email box        | As typed, lowercased                                                        |
| `date`       | Date picker      | `YYYY-MM-DD`                                                                |
| `number`     | Numeric box      | Whole number                                                                |
| `choice`     | Drop-down list   | The option's `value` (so write values as they should read in the agreement) |
| `line_items` | Line-item editor | A priced table; see [Line items](#line-items)                               |

`label`, `help` and option labels need `en`; add `es`, `fr`, `de`, `ja`, `pt`,
`zh` and `ar` so sellers see their own language. A missing language shows the
English label. A field with `"required": false` may be left blank and then
prints as nothing, so only make a field optional where counsel's text reads
correctly without it.

Values are limited to the characters the PDF font can draw (Latin script) and
may not contain `< > [ ] { }`, so a value can never turn into a token or a
signing tag.

#### Line items

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
heading or in the title, or the template fails to load.

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

### 3. Register it

In `packages/documents/src/contract-templates/registry.ts`, replace the stub
with the file:

```ts
import channelPartnership from "./channel-partnership/template.json";

export const contractTemplates: ContractTemplateRegistry = [
  availableTemplate(channelPartnership),
  // ...the other entries unchanged
];
```

`availableTemplate` validates the file when the app starts, so a mistake fails
the build and tests rather than a preparation.

### 4. Check it

```sh
# The DOCX hash matches, tokens are declared, ids are unique.
pnpm --filter @clockwork/documents exec vitest run src/contract-templates

# A specimen PDF with sample values, for counsel to compare with their file.
pnpm exec tsx scripts/render-contract-specimen.ts channel-partnership /tmp/specimen.pdf
```

Send the specimen to counsel. The renderer lays the wording out in its own
style, so counsel approves the specimen PDF as well as the DOCX. Then update
`registry.test.ts`, whose first test lists which templates are still pending.

### 5. Send in test mode first

Prepare one contract from the new template with your own email as the
counterparty signer, approve it from a second account, send it, and sign both
sides. Sending stays in SignWell test mode until `COMMERCE_CONTRACTS_TEST_MODE`
is set to `false`; test-mode signatures are not legally binding.

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
