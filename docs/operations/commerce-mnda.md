# Sending MNDAs in Fil One Commerce

Open `https://commerce.fil.one/internal/mndas`, choose **New MNDA**, enter the
counterparty and notice details, and select the Fil One countersigner. Preview
and open the PDF, then confirm **Send for signature**. The counterparty signs
first; Fil One countersigns second. James Kurz (`james@fil.one`, CFO/CSO) is the
initial default. Staff operators, finance and legal approvers can add Marta or
another authorized countersigner, change the default, and deactivate an old
signer. Existing drafts retain their original signer snapshot; create a new
draft to change it.

The register shows the latest 200 requests. It supports filtering, status
refresh, reminders, original PDFs and completed PDFs with the provider audit
trail. Provider callbacks update the register; the open page refreshes it every
15 seconds. Manual **Refresh** reconciles missed callbacks. Provider automatic
reminders are enabled, expiry is 30 days, and manual reminders have a one-minute
cooldown. Use SignWell for cancellation of documents already bound to the
provider.

This is the supplied English template. Its PDF font supports Latin-script names
and addresses; unsupported glyphs are rejected rather than silently removed. Use
a reviewed Latin-script legal name/address. Entity type should omit the initial
article, e.g. `Delaware corporation`. Legal clauses are preserved. Fil One
notice attention and both Fil One email references use the selected
countersigner's snapshot, including `james@fil.one` when James is selected. They
do not use the logged-in sender's address. Existing PDFs are immutable; create a
new preview to pick up layout changes or a different countersigner
configuration.

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
  and notice settings and the **Team** page. Migration 001441 made the Fil One
  staff who held `internal_operator` in staging and production (James Kurz and
  R.W. Holleman on 4 October 2026) commerce administrators.
- `internal_operator`: the operations workspace for the platform team.

A commerce administrator adds, re-roles and removes staff at `/internal/team`.
The page creates the WorkOS identity and organization membership with the server
WorkOS key and records every change in the audit log. It sends no email: tell
the person to sign in with their work address. Removing access deletes the
person's staff membership and deactivates their WorkOS organization membership;
their history stays.

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

- Retry a pending/error request from its original PDF preview. It keeps the same
  provider binding. Never recreate a live request merely because its first send
  response timed out.
- If SignWell completion is visible but Commerce still shows pending, refresh.
  Failed PDF retrieval leaves the request incomplete locally, allowing recovery.
- A callback returning 503 is retryable. Unknown document IDs are acknowledged
  without creating records; callbacks for the other deployment are ignored.
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
inspect every page. Check selected countersigner values in the output when
changing their rendering. Use the pinned Node version and Poppler:

```sh
pnpm --filter @clockwork/documents exec vitest run --config vitest.integration.config.ts src/mnda/render.integration.test.ts
pnpm --filter @clockwork/documents typecheck
```

Only add SignWell test-mode extraction/placement checks when field tags, field
dimensions, placement, requiredness or provider payloads change. Cover the
affected partner-detail modes; delete disposable test drafts afterward. Repeat
the complete two-signer flow when signing order, recipient routing, send/retry,
callbacks or completed-document retrieval changes, or when a concrete provider
failure remains unresolved. Use the corresponding workflow, adapter, access or
database tests for those changes. Do not send live agreements as a test of a
cosmetic tweak.

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
restores that default. Preview the agreement before sending, and review the
partner's completed information before countersigning.

Choose **Partner completes details when signing** to send with an internal
partner reference and recipient name/email. Commerce still sets the effective
date and Fil One countersigner. SignWell requires every legal-name,
entity-description, notice-address/email/contact, and signatory-name/title field
before the partner can finish. Repeated fields offer the value already entered.
Fil One reviews the completed partner details before countersigning. The
internal reference is not substituted for the partner's legal name in this mode;
the executed PDF is the authoritative record of partner-entered details. **Our
team enters the details** retains the fully prepared document workflow.

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
