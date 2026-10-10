# ADR 0011: Staff can send a pre-sales MNDA before an account exists

Accepted 2026-10-02. Product name: Fil One Commerce. Repository and existing
deployment hostname remain `clockwork`. The MNDA signing workflow now runs on
the shared engine in [ADR 0012](0012-one-signing-engine.md).

The existing agreement flow binds a purchaser, commerce account and signing
session. A sales prospect may have none of these. `/internal/mndas` therefore
uses a standalone staff-only register and SignWell's two-recipient API.
`COMMERCE_MNDA_ENABLED` gates this bounded pre-sales feature independently of
new-business, billing, provisioning and legal capabilities. It does not activate
those capabilities or make an MNDA a purchase agreement.

The supplied DOCX is versioned in `docs/legal`; its SHA-256 identifies the legal
template. Rendering substitutes only its placeholders. Drafts preserve the
input, countersigner identity/title, effective date and original PDF. Subsequent
countersigner configuration changes affect new drafts only. The counterparty
signs first, then the selected Fil One countersigner.

SignWell drafts are created without sending. Commerce commits the provider ID
before requesting delivery. Retry reads that same document before deciding to
send, and a database lease serializes commands and callbacks. A lost
draft-create response can leave an unsent provider draft, never an automatically
sent duplicate. Sending waits briefly for asynchronous field extraction and
requires both signatures and both signing dates before delivery.

SignWell callback HMACs cover event type and timestamp, not the supplied
document payload. Callbacks are authenticated wakeups only. Commerce looks up a
bound document, re-fetches its authoritative provider state, verifies
recipients, template metadata and test/live mode, and only then applies a
transition. Completion requires the signed PDF including SignWell audit pages to
be archived in the same transaction as the completed state, audit event and
outbox entry.

Original and executed PDFs are append-only to the application service role,
hash-checked and stored in the existing backed-up PostgreSQL database, capped at
12 MB each. This is not an S3 Object Lock or certified regulatory archive claim.
Changing storage to object storage is a separate retention decision.

All actions re-check a real internal operator, finance or legal staff session,
MFA, and absence of impersonation/assisted/demo context. Customer identities
have no database grants on the register. Existing finance/legal approvals keep
their own permissions. SignWell API keys and callback verification IDs remain
server secrets. External cancellation is managed in SignWell: its API deletes
documents, so Commerce only cancels drafts with no provider binding to avoid
racing a final signature and deleting evidence.

## Amendment, 2026-10-04

Sending, tracking and after-send actions require the `mnda:send` permission;
countersigners and the Fil One notice email require `signatory:manage`, held
only by commerce administrators. The notice email is a database setting,
snapshotted on each draft like the countersigner.

Staff may now void a provider-bound MNDA in Commerce until the partner signs.
Only the preparer or a commerce administrator may void. The workflow takes the
request lease, re-reads the authoritative SignWell state, refuses once the
partner has signed, keeps a request that completed in the meantime (with its
executed PDF), and only then deletes the SignWell document. An unanswered delete
is resolved by a re-read. The original PDF, the record and the reason remain in
Commerce. A bound document SignWell no longer has moves to attention for a
person to void; nothing is closed automatically. A bounced or wrong partner
email may be replaced through SignWell's recipient update while the partner has
not started signing. The new address is held as pending until SignWell confirms
it or a refresh settles it, so an ambiguous provider answer never breaks the
recipient binding.
