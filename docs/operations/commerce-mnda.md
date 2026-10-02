# Sending MNDAs in Fil One Commerce

Open `/internal/mndas`, choose **New MNDA**, enter the counterparty and notice
details, and select the Fil One countersigner. Preview and open the PDF, then
confirm **Send for signature**. The counterparty signs first; Fil One
countersigns second. James Kurz (`james@fil.one`, CFO/CSO) is the initial
default. Staff operators, finance and legal approvers can add Marta or another
authorized countersigner, change the default, and deactivate an old signer.
Existing drafts retain their original signer snapshot; create a new draft to
change it.

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
article, e.g. `Delaware corporation`. Legal clauses and the FIL One notice email
`m@fil.org` are preserved. Notice attention uses the configured countersigner.

## Deployment

Each GitHub environment has protected `SIGNWELL_API_KEY` and
`SIGNWELL_WEBHOOK_ID` secrets and variable `COMMERCE_MNDA_ENABLED=true`.
Register separate SignWell callbacks:

- `https://clockwork-staging.fil.one/api/v1/webhooks/signwell`
- `https://clockwork.fil.one/api/v1/webhooks/signwell`

Terraform injects credentials and runs staging in non-binding test mode;
production uses live mode. SignWell API pay-as-you-go billing must be active for
volume above the free allowance. Plan/billing changes remain in SignWell.

An optional protected `CLOCKWORK_STAFF_PROVISIONING` secret contains one
explicit `{email,name,title,role:"internal_operator"}` request. The migration
task checks the bootstrapped environment, database host, organization,
authorizing operator and approved email domain before creating the WorkOS
identity and local role. Existing conflicting identities fail closed. It records
an audit event/outbox entry, preserves the actual WorkOS binding and is safe to
rerun. It does not email invitations, generate passwords, claim email
verification or enroll another person's MFA. Remove the secret after successful
provisioning and deploy again. Staff domain configuration includes
`fil.org,fil.one`. The user must verify their email and enroll their own
authenticator through the organization's required MFA policy on first login. A
verified in-app MFA challenge may also be requested.

## Recovery and verification

- Retry a pending/error request from its original PDF preview. It keeps the same
  provider binding. Never recreate a live request merely because its first send
  response timed out.
- If SignWell completion is visible but Commerce still shows pending, refresh.
  Failed PDF retrieval leaves the request incomplete locally, allowing recovery.
- A callback returning 503 is retryable. Unknown document IDs are acknowledged
  without creating records; callbacks for the other deployment are ignored.
- Run the targeted SignWell, workflow, staff-access, PDF semantic and database
  integration tests. Non-binding live API qualification uses embedded signing
  with notifications off, exercises both signers and retrieves the final PDF.
  Test mode documents are not legally binding and do not count toward API
  billing.
- Disabling the feature prevents provider operations. Originals and completed
  artifacts remain readable to authorized staff. Database backups retain
  evidence.

See [ADR 0011](../adr/0011-standalone-commerce-mnda.md) for boundaries and
storage guarantees. Production acceptance requires a successful deployment plus
the staff user's own first login; an automated role test cannot complete their
MFA.
