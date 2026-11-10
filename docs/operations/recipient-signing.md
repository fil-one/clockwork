# Fil One recipient signing

The optional Fil One experience covers staff MNDAs, template contracts, and
uploaded PDFs. SignWell still captures the signatures and supplies the executed
PDF with audit page. Commerce owns recipient emails, private links, the signing
page and final-copy download. Existing hosted SignWell requests keep working.

## Configure before enabling

- Apply migration `001485_signing_journey.sql` and deploy the app and workers.
- Create/configure the SignWell API application with Fil One branding. Confirm
  embedded signing and custom branding are available on the account. Set
  `SIGNWELL_API_APPLICATION_ID`; retain the existing API key and verified
  webhook subscription (`SIGNWELL_WEBHOOK_ID`).
- Set `COMMERCE_SIGNING_ORIGIN` to the canonical Commerce HTTPS origin, without
  a path (the final address after any hostname redirect), and
  `COMMERCE_SIGNING_LINK_SECRET` to a cryptographically random secret of at
  least 32 characters. Treat rotation as revocation of every outstanding
  link/session.
- Configure SES using `COMMERCE_SIGNING_EMAIL_PROVIDER=ses`,
  `COMMERCE_SIGNING_EMAIL_FROM` and `COMMERCE_SIGNING_SES_REGION` (or
  `AWS_REGION`). Verify the sending identity, DKIM, sandbox/production status
  and task-role permission. Staff notification preferences do not control
  agreement mail.
- In the Terraform deployment, enable `COMMERCE_SIGNING_MAIL_ENABLED`. This
  provisions the SES identity, DKIM and sender permission independently of staff
  notifications; `COMMERCE_NOTIFICATIONS_EMAIL_ENABLED` may remain off. Both
  channels share the same authorized address, with **Fil One Agreements** as the
  agreement-mail display name. The API application ID, creation flag and test
  allowlist are GitHub environment variables; the link secret is an environment
  secret.
- List explicitly approved test recipients in `COMMERCE_SIGNING_TEST_RECIPIENTS`
  (comma-separated, including countersigners and copy recipients). Test-mode
  mail to any other address fails closed.
- In staging, set `COMMERCE_SIGNING_EXPERIENCE=fil_one` for the test-mode pilot
  below. In production, leave it as `signwell` until qualification is complete.
  Incomplete configuration blocks new sends.

## Pilot before activation

Use approved test addresses only. No account purchase, live agreement, or
external recipient is implied by development of this feature.

1. Send a test MNDA through the normal approval/send flow. Confirm there is one
   Fil One invitation, no provider invitation, and no unexpected provider mail.
2. Check the actual SignWell iframe on desktop and a narrow mobile screen:
   header hidden, correct logo and colors, complete legal disclosure, readable
   document, editable counterparty details and signatures/date in the right
   positions. The local `/sign/preview` is an illustrative screen, not provider
   qualification. API application settings may still expose provider
   attribution; verify the real account before promising complete white
   labeling.
3. Complete the first signature. Verify “your signature is complete,” a Fil One
   countersigner invitation, and no final-copy download until both parties have
   signed and Commerce has archived the executed PDF. Complete the second signer
   and verify the audit page, final emails and archived download for
   signers/copies.
4. Repeat the relevant steps for a template contract, an uploaded PDF and a Fil
   One-only signing request. Exercise reminder, declined/voided document,
   address correction, dropped/refused correction and replacement request.
5. Verify stale links and sessions cannot launch the corrected/replacement
   recipient's document, and unapproved test recipients receive nothing.
   Exercise a temporary mail failure and worker restart; the durable queue must
   recover.

## Recipient access and state

Links last seven days and authorize one recipient. The secret is in the URL
fragment; the browser removes it before loading the provider SDK and exchanges
it by same-origin POST for an eight-hour, HttpOnly, path-scoped session. Pages
and responses are private/no-store/no-referrer/noindex. Every read verifies the
current source document and recipient address. Correction rotates the recipient
nonce; pending correction suspends access. A forwarded link authorizes its
bearer, as with an emailed signing link: the embedded API does not add email
authentication.

An SDK completion event requests a server refresh; it cannot complete an
agreement. The existing signing engine verifies provider identity, source hash,
mode and signers and archives the PDF before recording completion. The portal
serves only that archive. It never replaces the engine's approval or signing
rules.

The provider SDK requires an unnonced inline style element. Only `/sign/<id>`
gets that style exception and the exact SignWell frame/script origins; the
production script nonce policy and staff-route policy remain enforced.

## Delivery and recovery

Commercial events and email jobs are durable. Current source versions fence
stale provider reads. Invitation/completion dedupe keys bind to the recipient's
current nonce; manual reminders bind to their source event. Leases exclude
concurrent workers and stale lease holders cannot acknowledge new work. The
`system.signing-mail.retry.v1` schedule runs every five minutes. Temporary
corrections/attention defer without consuming the six transport attempts. An
ambiguous SES timeout can cause a duplicate email; exactly-once external email
delivery cannot be guaranteed.

Inspect `commerce_signing_mail` for `failed` jobs and `provider_code`, and the
`signing.mail_*` audit events. No raw links or provider URLs are stored in
either queue or audit. `TEST_RECIPIENT_NOT_ALLOWED` requires verifying the
approved address/allowlist first; `LEASE_EXHAUSTED` or a transport failure
requires fixing the worker/channel. An authorized operator can then reset only
the affected job:

```sql
update commerce_signing_mail
set state = 'pending', attempts = 0, available_at = now(),
    lease_token = null, lease_until = null, provider_code = null
where id = '<reviewed-delivery-uuid>' and state = 'failed';
```

The worker rechecks recipient nonce, current source/address and applicability
before sending. A stale job is skipped. A manual Remind sends a fresh seven-day
link to the current unsigned signer. To replace an expired completed-copy link,
review the recipient binding and requeue its completed job (same reset fields,
restricted to that job's `state = 'sent'` and `purpose = 'completed'`).

Rollback switches **new creation** back to `signwell`. Keep the recipient route,
worker, mail settings, API application and link secret available until existing
Fil One requests and final-copy links are no longer needed. Do not remove the
migration or silently convert in-flight requests to another provider experience.
