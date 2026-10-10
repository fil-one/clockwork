# Adding a signed document type

Every document Commerce sends through SignWell runs on one `SigningEngine`
([ADR 0012](../adr/0012-one-signing-engine.md)). A new kind of signed document
is a declaration plus the pieces the engine cannot know: where the request is
stored, how its PDF is made, how SignWell receives it, and what the screen says.
A new counsel template is not a new type; see
[contract templates](contract-templates.md).

The worked example is counterparty paper: a partner's own PDF, recorded in the
contract register, sent for the Fil One countersignature with a Fil One
signature page appended.

## 1. Declaration

Add a `SigningDocumentType` to `packages/contracts/src/signing.ts`. It names the
SignWell binding key, the signers in order with the fields each completes and
whether staff may correct their email, the document name, file name, subject and
message, whether two-person approval applies, whether the sender is copied, and
the error and history prefixes.

`counterpartyPaperSigning` declares the counterparty (order 1, correctable) and
the Fil One countersigner (order 2), the `commerce_contract_id` binding key,
`two_person` approval and the `CONTRACT` and `contract` prefixes, so its errors
and history read like a template contract's. The engine refuses at construction
a declaration without exactly two signers, or with a correctable signer its
store or SignWell client cannot correct.

A declared signer can sit out a given request: the store's view lists only those
who sign it. Counterparty paper the counterparty already signed lists Fil One
alone: the engine then expects SignWell's copy to name that one recipient, with
its fields, and reminds them. Voiding does not depend on the list; it reads
SignWell's document and refuses once anyone has signed it.

## 2. Store

The store adapter (`packages/workflows/src/signing/stores.ts`) translates the
type's record for the engine and declares what its table can keep beyond state
and error: `signer_correction` and `cancel_code`. It refuses a change carrying
anything else rather than drop it.

Counterparty paper shares `commerce_contract_signing` and the contract adapter
with template contracts. The table records `document_type` and
`counterparty_signs`
(`supabase/migrations/001460_contract_counterparty_paper.sql`), both fixed at
creation. The database also refuses a counterparty-paper request unless the
contract is on their paper and has an uploaded PDF with the request's hash, and
keeps that PDF while the request exists. A type on a table of its own needs a
repository with the same lease, frozen terminal state and hash-checked executed
PDF, and an adapter of its own.

## 3. Document and SignWell binding

The PDF is made by `packages/documents` and stored, with its hash, as the
request's prepared document before anything is sent. SignWell scans the whole
PDF for text tags such as `{{signature:1:y}}`, where the number is the
recipient's place in signing order, so the PDF must carry exactly the tags the
declaration expects and nothing SignWell would read as a field. Before sending,
the engine checks the fields SignWell found against the declaration. While
SignWell may still be extracting them it keeps waiting, within the same bounded
interval as for a draft still being created; a draft whose fields still differ
after that waits in attention (`signwell_fields_mismatch`) until it is voided,
and is never sent.

`renderCounterpartyPaper`
(`packages/documents/src/counterparty-paper/render.tsx`) checks the uploaded PDF
against the hash it was read with, draws any form fields of its own into its
pages exactly as they are stored and removes the form, appends the signature
page and returns the merged PDF. A form it cannot draw exactly (a field with no
stored appearance, `NeedAppearances`, an XFA-only form) is refused with
`CONTRACT_PAPER_FORM_UNREADABLE`, never stripped. The request's `templateHash`
is the uploaded PDF's SHA-256, which SignWell's copy must carry as
`template_sha256`. The signature page wording is interim pending counsel
(`EXT-LEGAL-01`); its version is stored on each request.

The SignWell client builds the draft's recipients:
`SignWellContractClient.createCounterpartyPaperDraft` lists the counterparty and
then Fil One, or Fil One alone. The workflow facade (`ContractSigningWorkflow`)
holds one engine per declaration and runs each request on its own type's.

## 4. Screens

The facade keeps the type's error codes, so existing messages apply. New
preparation errors need entries in the screen's error copy. Counterparty paper
adds a **Send for Fil One signature** card on an unsigned contract on their
paper with a PDF, where the seller picks the PDF, the countersigner and whether
the counterparty signs in SignWell first. Once prepared, the contract's signing
panel takes over: approval, send, reminders, **Fix email**, void and the
executed PDF work as for templates. The signing table keeps one request per
contract, so a request that was voided, declined or expired blocks sending that
contract again: the panel says so and links to recording the contract again, and
**Someone else will sign** is not offered for counterparty paper.

## 5. Tests

| Check                                                         | Where                                                                     |
| ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| The whole signing lifecycle against the new type              | `packages/workflows/src/signing/scenarios.test.ts` (add a harness)        |
| Behaviour only the type has (Fil One alone signing)           | `packages/workflows/src/contracts.test.ts`                                |
| The rendered PDF, as a text golden                            | `packages/documents/src/counterparty-paper/render.integration.test.ts`    |
| Database rules                                                | `supabase/tests/1460_contract_counterparty_paper.test.sql`                |
| Repository preparation                                        | `packages/db/src/repositories/contracts.integration.test.ts`              |
| End to end through the database, renderer and SignWell client | `apps/web/src/features/internal-ops/contracts/engine.integration.test.ts` |
| Server action and screens                                     | `actions.test.ts`, `client-components.test.tsx` in the same folder        |

Sending stays in SignWell test mode until `COMMERCE_CONTRACTS_TEST_MODE=false`.
Before turning it off for a new type, send one request in test mode and sign it,
to confirm SignWell places the fields from the text tags.
