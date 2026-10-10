# Sending MNDAs in Fil One Commerce

Open `https://commerce.fil.one/internal/mndas` and choose **New MNDA**. Enter
the partner signer's name and email and the company's legal name, then any
details you know. Choose **Prepare preview**, open the PDF, and choose **Confirm
and send**. The partner signs first; the selected Fil One countersigner signs
second. Nothing reaches the partner until you confirm.

## Who can do what

| Action                                                      | Permission         | Roles                                                                         |
| ----------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------- |
| Prepare, send, remind, void, fix an email, download, export | `mnda:send`        | `revenue`, `commerce_admin`, `internal_operator`, finance and legal approvers |
| Countersigners and the Fil One notice email (MNDA settings) | `signatory:manage` | `commerce_admin` only                                                         |

Every action and route checks the permission on the server, plus a staff session
with MFA and no assisted, impersonated or demo context. A session without MFA
sees a prompt to verify its sign-in; a session without the permission sees a
named access page.

Voiding, discarding or editing a draft, and fixing the partner email, are
limited to the person who prepared the MNDA or a commerce administrator. Anyone
with `mnda:send` can remind, refresh, download and duplicate. Every PDF download
is audited as `mnda.pdf_downloaded` and every export as `mnda.register_exported`
with its filters and row count.

## Preparing and previewing

The form asks for the partner signer first, then the company, then **Known
details**. Leave unknown details blank and the partner fills them in before
signing. **Our team enters the details** makes every detail required. New drafts
always name the partner's legal company. The retired **Partner completes details
when signing** mode took an internal reference instead; MNDAs already prepared
in it still send, refresh and download as before, and **Duplicate**, **Send
again** or **Edit details** on one opens the default mode with the legal name
blank to fill in.

Problems appear next to the field with a specific message (for example a
reserved character such as `<` or `[`, a partner email equal to the
countersigner's, or a malformed email), and the first problem receives focus.

The preview lists the partner, countersigner, notice email, effective date and
the details the partner will fill in. **Edit details** reopens the filled form.
The next preview replaces the previous unsent draft, which moves to **Closed**
as "Replaced by an edited draft". If the notice email changes while a seller is
working, the preview is refused with a message to prepare it again. **Discard
draft** closes a draft that will not be sent.

When the legal name matches an existing MNDA that is not voided (ignoring case,
accents, punctuation and a trailing suffix such as Inc. or LLC), the form and
preview show the existing MNDA's status, date and preparer with a link to it.
The database keeps the normalized name (`normalized_company`, computed by
`commerce_mnda_normalize_company`) so stored names and lookups always agree.

The same check covers the contract register: a recorded agreement of any type
with the same company (for example an NDA on the partner's paper, or an MSA)
shows its type, status, effective date and owner with a link to the contract.
Drafts whose signing request was voided are left out. The lookup applies
`commerce_mnda_normalize_company` to `counterparty_name` in the query. It is a
warning only and appears for staff who may read contracts (`contract:read`,
which every role with `mnda:send` holds).

## The agreement

This is the supplied English template; the legal clauses are unchanged. Names
and addresses may use Latin script, including accented and Latin Extended
letters (Łódź, Nguyễn). The PDF embeds its fonts (Tinos, Arimo and Cousine, SIL
Open Font License), so every viewer renders it the same way. Enter the entity
type without a leading article, for example `Delaware corporation`; the
agreement prints "a" or "an" to match. When the partner fills in the entity
type, the agreement keeps "a".

The effective date prints as "October 2, 2026". Long emails, URLs and names wrap
inside their column. The signature page names the agreement and both parties,
and every page footer carries the short request reference, template version and
page number.

The Fil One notice email (template `ATTN: email:` in the opening paragraph and
the signature page notices block) is the **MNDA settings** notice email, by
default `james@fil.one`. It is independent of the countersigner; the notices
"Attention" line still names the selected countersigner. Each draft keeps the
notice email and countersigner it was prepared with. Changing either applies to
new drafts only; drafts prepared before the setting existed keep the
countersigner's email.

## Register

The register pages through every MNDA, newest first. Search covers company,
partner signer name and email, and preparer. Status filters and **Only mine**
live in the address, so links can open a filtered view:

| Filter             | Address                                                |
| ------------------ | ------------------------------------------------------ |
| Waiting on partner | `/internal/mndas?status=sent,viewed`                   |
| Waiting on Fil One | `/internal/mndas?status=awaiting_countersignature`     |
| Needs attention    | `/internal/mndas?status=attention`                     |
| Signed             | `/internal/mndas?status=completed`                     |
| Drafts             | `/internal/mndas?status=draft,preparing,ready,sending` |
| Closed             | `/internal/mndas?status=declined,expired,canceled`     |

Add `&mine=1` for the signed-in seller's own MNDAs, `q=` for a search and
`page=` for a page. Replaced and discarded drafts appear only under **Closed**.

Each row shows the sent date and the days outstanding while the MNDA is open.
**Needs attention** rows say why and what to do: a bounced partner email ("Fix
the email and SignWell sends it again"), a request SignWell stopped ("Void it,
then send it again"), a document deleted directly in SignWell ("Void it here to
close it"), or a SignWell copy that no longer matches the MNDA ("Void it, then
send it again"). A copy no longer matches when its signers differ from the
MNDA's partner and Fil One countersigner (for example a recipient changed
directly in SignWell; error `signwell_signers_mismatch`) or when it is not bound
to this request (`signwell_binding_mismatch`). Commerce applies nothing from
such a copy and audits it as `mnda.signwell_mismatch`. Void deletes it in
SignWell unless SignWell shows that someone signed it; then the void is refused.
If SignWell's copy matches again, the next refresh restores the status. A send
that did not finish says so; **Continue** opens its preview and sending again
never creates a second SignWell request.

**Export CSV** downloads the filtered register (company, partner signer and
email, status, countersigner, preparer, created, sent, days outstanding,
completed, effective date, test mode, void reason, request ID). PDFs download as
`Fil-One-MNDA_<Company>_<date>_draft.pdf` (effective date) or `..._signed.pdf`
(completion date). An export stops at the newest 10,000 matching MNDAs; the page
says so above the register when more match, and the response carries
`x-mnda-export-truncated: true`.

The open page refreshes the register every 15 seconds while the tab is visible.
**Refresh** on a row reconciles a missed callback. SignWell sends automatic
reminders, and expiry is 30 days. **Remind** names who is reminded: the partner,
or the Fil One countersigner once the partner has signed. Manual reminders are a
minute apart.

## After sending

- **Fix email** replaces a bounced or mistyped partner email while the partner
  has not started signing. SignWell sends the request to the new address
  (`PATCH /documents/{id}/recipients`); the signer's name stays, because it may
  be printed in the agreement. The new address is recorded as pending first. A
  clear SignWell refusal (4xx) drops it. If the answer is lost (timeout or 5xx),
  Commerce reads the document back and keeps whatever SignWell shows; if that
  read also fails, the pending address stays accepted until the next successful
  refresh settles it. Audited as `mnda.signer_correction_requested` and
  `mnda.signer_corrected` (or `..._refused`, `..._dropped`).
- **Someone else will sign** voids the MNDA (recorded as a signer change, shown
  in each reader's language) and opens a new draft with the same company details
  and a blank signer.
- **Void** is available for drafts, sent and opened MNDAs and those needing
  attention, never once the partner has signed. It asks for a reason, re-reads
  the request in SignWell, and deletes it there (`DELETE /documents/{id}`),
  which stops signing. If the partner signed in the meantime the void is
  refused; if both sides signed, the signed copy is kept. When the delete's
  answer is lost, Commerce reads the document back: gone means the void is
  recorded with its reason. Commerce keeps the original PDF, the record and the
  reason, audited as `mnda.voided`.
- **Send again** (closed MNDAs) and **Duplicate** (open ones) start a new draft
  prefilled from the row, dated today.
- A document deleted directly in SignWell (404 on two reads) moves to **Needs
  attention**; a person voids it. It is never closed automatically.

## Completion notices

The sender is a SignWell copied contact (`copied_contacts`) on every new
request, so SignWell emails the sender the completed agreement when both sides
have signed. The countersigner and partner receive it as recipients. A sender
who is also the countersigner is not copied twice. No Commerce email is sent.
Before sending, Commerce reads the SignWell draft. If SignWell reports copied
contacts and they leave out the sender, sending stops. If the draft does not
report copied contacts at all, sending continues and the server logs "MNDA
copied contacts not reported by SignWell" with the request and document IDs; the
send audit event records `copiedContacts: "unreported"` (otherwise
`"verified"`). SignWell's update-and-send request has no copied-contacts field,
so the contact is set only when the draft is created. Requests created before
this change have no copied contact.

## MNDA settings

`/internal/mndas/settings` (commerce administrators) holds the notice email and
the countersigners. Saving the notice email is audited as
`mnda.settings_changed` with the previous and new value, and a save from a stale
page is refused. Countersigner changes are audited as `mnda.signer_configured`.
Deactivate a countersigner who should no longer sign; existing MNDAs are not
affected.

## Deployment

Each GitHub environment has protected `SIGNWELL_API_KEY` and
`SIGNWELL_WEBHOOK_ID` secrets and variable `COMMERCE_MNDA_ENABLED=true`.
Register separate SignWell callbacks:

- `https://clockwork-staging.fil.one/api/v1/webhooks/signwell`
- `https://clockwork.fil.one/api/v1/webhooks/signwell`

Terraform injects credentials and runs staging in non-binding test mode;
production uses live mode. SignWell API pay-as-you-go billing must be active for
volume above the free allowance. Plan/billing changes remain in SignWell.

### Staff roles and access

Staff hold one of three roles:

- `revenue`: sellers. Home, MNDAs and indicative pricing. No operations,
  billing, provisioning or platform tools.
- `commerce_admin`: everything every internal role can do, plus MNDA signatory
  and notice settings and the **Team** page. Migration 001441 promotes one
  person: James Kurz (`james@fil.one`), while he holds `internal_operator` in
  the Fil One staff organization in staging or production. Every other staff
  member keeps their role.
- `internal_operator`: the operations workspace for the platform team.

After the deploy that carries 001441, James signs in, opens **Team** and changes
R.W. Holleman's role to commerce administrator. That change is made and audited
under James's name.

A commerce administrator adds, re-roles and removes staff at `/internal/team`.
The page creates the WorkOS identity and organization membership with the server
WorkOS key and records every change in the audit log. It sends no email: tell
the person to sign in with their work address. Removing access deletes the
person's staff membership and deactivates their WorkOS organization membership;
their history stays. Neither the page nor the provisioning secret can remove the
last commerce administrator.

A person's authenticator counts as enrolled from their first verified in-app MFA
check (`/access/mfa`). Staff authority checks that require an enrolled
authenticator (capabilities, catalog, provider references, finance decisions)
pass from then on; the enrollment is recorded in the audit log.

The deployment path remains for a first administrator or when the page is not
available. An optional protected `CLOCKWORK_STAFF_PROVISIONING` secret contains
one explicit `{email,name,title,role}` request. `role` is `revenue` (the
default), `commerce_admin` or `internal_operator`. To change an existing staff
member's role, add `"updateRole": true`; without it a different role fails
closed. The migration task checks the bootstrapped environment, database host,
organization, authorizing operator (an internal operator or commerce
administrator) and approved email domain before creating the WorkOS identity and
local role. Existing conflicting identities fail closed. It records an audit
event/outbox entry, preserves the actual WorkOS binding and is safe to rerun. It
does not email invitations, generate passwords, claim email verification or
enroll another person's MFA. Remove the secret after successful provisioning and
deploy again. Staff domain configuration includes `fil.org,fil.one`. The user
must verify their email and enroll their own authenticator through the
organization's required MFA policy on first login. A verified in-app MFA
challenge may also be requested. The [revenue team guide](revenue-team-guide.md)
walks a new seller through it.

## Recovery and verification

- Retry a pending/error request from its preview (**Continue**). It keeps the
  same provider binding. Never recreate a live request merely because its first
  send response timed out.
- If SignWell completion is visible but Commerce still shows pending, refresh.
  Failed PDF retrieval leaves the request incomplete locally, allowing recovery.
- A callback returning 503 is retryable. Unknown document IDs are acknowledged
  without creating records; callbacks for the other deployment are ignored. A
  callback for an MNDA whose SignWell copy no longer matches is acknowledged
  once the MNDA is recorded as needing attention.
- Sending a draft whose SignWell document was deleted, or whose SignWell copy no
  longer matches, records the reason on the row instead of a connection problem,
  and the preview says the MNDA was not sent.
- Choose tests using [change validation](#change-validation). When a complete
  provider qualification is needed, use non-binding test mode with embedded
  signing and notifications off; exercise both signers and retrieve the final
  PDF. Test mode documents are not legally binding and do not count toward API
  billing.
- Disabling the feature prevents provider operations. Originals and completed
  artifacts remain readable to authorized staff. Database backups retain
  evidence.

See [ADR 0011](../adr/0011-standalone-commerce-mnda.md) for boundaries and
storage guarantees. Production acceptance requires a successful deployment plus
the staff user's own first login; an automated role test cannot complete their
MFA.

## Change validation

For PDF copy, spacing or configured-value changes, run the existing MNDA render
tests and inspect a representative PDF's affected pages. If pagination changes,
inspect every page. Check the notice email and countersigner values in the
output when changing their rendering. Use the pinned Node version and Poppler:

```sh
pnpm --filter @clockwork/documents exec vitest run --config vitest.integration.config.ts src/mnda/render.integration.test.ts
pnpm --filter @clockwork/documents exec vitest run src/mnda/article.test.ts
pnpm --filter @clockwork/documents typecheck
```

The render tests include a field-placement check: for every detail mode with
short and long values, each SignWell field box must sit inside the page and
overlap no printed text. Keep it passing when changing layout.

Only add SignWell test-mode extraction/placement checks when field tags, field
dimensions, placement, fonts, requiredness or provider payloads change. Cover
the affected partner-detail modes; delete disposable test drafts afterward.
Repeat the complete two-signer flow when signing order, recipient routing,
send/retry, callbacks or completed-document retrieval changes, or when a
concrete provider failure remains unresolved. Use the corresponding workflow,
adapter, access or database tests for those changes:

```sh
pnpm --filter @clockwork/workflows exec vitest run src/mnda.test.ts
pnpm --filter @clockwork/integrations exec vitest run src/esign/signwell.test.ts
pnpm --filter @clockwork/web exec vitest run src/features/internal-ops/mnda
DIRECT_DATABASE_URL=... pnpm --filter @clockwork/db exec vitest run --config vitest.integration.config.ts src/repositories/mnda.integration.test.ts
```

Do not send live agreements as a test of a cosmetic tweak.

Once the relevant checks pass, proceed to the required CI and deployment gates.
Use the deployment smoke result and focused verification of the changed
behavior; do not repeat unrelated flows or recreate the user's existing drafts.
General scope and stop rules are in the
[contributor guide](../contributing.md#proportionate-validation).

## Partner-completed details

The default **Our team starts; partner completes missing details** lets staff
enter the legal company name, recipient name/email and any known information.
Unknown jurisdiction, address, notice contact/email or signer title may be left
blank. Only missing details become required signing fields. Known street and
city/region/postal/country values are preserved independently, including when
only half the address is known. Supplied values are printed in the agreement.
The short name defaults to the legal name and remains editable; clearing it
restores that default. Review the partner's completed information before
countersigning.

In the retired **Partner completes details when signing** mode (MNDAs prepared
before it was retired), Commerce still sets the effective date, notice email and
Fil One countersigner. SignWell requires every legal-name, entity-description,
notice-address/email/contact, and signatory-name/title field before the partner
can finish. Repeated fields offer the value already entered. The SignWell
document is titled "Mutual NDA: Fil One" in this mode and "Mutual NDA: Fil One
and {legal name}" otherwise. The internal reference is not substituted for the
partner's legal name; the executed PDF is the authoritative record of
partner-entered details.

## Production address

`commerce.fil.one` is the canonical product address. Its DNS and ACM certificate
are managed in `fil-one/infrastructure`; Commerce attaches the issued
certificate to its existing production HTTPS listener. Set the production GitHub
variable `CLOCKWORK_CANONICAL_HOSTNAME=commerce.fil.one` only after the
certificate is issued and WorkOS permits the new callback and sign-out URL. The
original `CLOCKWORK_HOSTNAME=clockwork.fil.one` continues to identify the
existing service and DNS zone. Browser navigation redirects to Commerce;
provider webhooks and in-flight auth callbacks continue working on the old
address. Users sign in again on the new hostname because their session cookies
belong to the old hostname.
