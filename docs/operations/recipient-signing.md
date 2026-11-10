# Fil One recipient signing

The optional Fil One experience covers staff MNDAs, template contracts, and
uploaded PDFs. SignWell still captures the signatures and supplies the executed
PDF with audit page. Commerce owns recipient emails, private links, the signing
page and final-copy download. Existing hosted SignWell requests keep working.

## Why this uses AWS

The product goal is a consistent Fil One experience from the first email through
the completed agreement. Keeping SignWell behind the signing page improves the
ceremony, but provider-branded invitations and completion emails would still
send recipients back into the SignWell experience. Commerce therefore composes
those transactional emails and links them to its own recipient page.

SignWell continues to capture signatures and provide the executed document.
Amazon SES delivers Commerce's invitations, requested reminders and final-copy
links. SES was chosen because Clockwork already runs on AWS: the existing task
role, Terraform deployment and email adapter can provide delivery without
introducing another service account or a long-lived email API key. Another mail
provider could serve this role, but is not configured for this rollout.

SES sender verification and permission to email customers are separate. Domain
verification and DKIM establish the sending identity. An account in the SES
sandbox can still send only to verified recipients; production access removes
that recipient restriction in the approved AWS Region. Verifying the two pilot
addresses enables staging tests, not customer delivery. See
[AWS's production-access documentation](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html).

## Engineering handoff: production email approval

**Observed 2026-11-10 at 19:28 UTC:** the sender identity and DKIM are verified,
but AWS denied the production-access request. The API exposes the review status
and case ID, not the reason. Engineering must read the case correspondence; do
not infer why AWS declined it.

| Item                        | Production value                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| AWS account                 | `811430801166`                                                                                                      |
| SES Region                  | `us-east-2` (Ohio)                                                                                                  |
| Support case                | [179433700900557](https://support.console.aws.amazon.com/support/home#/case/?displayId=179433700900557&language=en) |
| Website and recipient links | `https://commerce.fil.one`                                                                                          |
| SES sending identity        | `clockwork.fil.one`                                                                                                 |
| From address                | `Fil One Agreements <notifications@clockwork.fil.one>`                                                              |
| Identity / DKIM status      | `SUCCESS` / `SUCCESS`                                                                                               |
| Production access / review  | `false` / `DENIED`                                                                                                  |
| Evidence                    | [Signing email readiness run 42885499851](https://github.com/fil-one/clockwork/actions/runs/42885499851)            |
| New-creation flag           | `COMMERCE_SIGNING_EXPERIENCE=signwell` (Fil One journey not activated)                                              |

The sending domain and the website hostname intentionally differ. The sender is
the existing production deployment domain; recipient links use the canonical
Commerce hostname. The identity, DNS records and sending permission are already
provisioned. No new AWS account, credential sharing or SignWell purchase is
needed for the AWS approval step.

### 1. Engineering resolves the AWS case

Use your existing engineering AWS access to account `811430801166`, open the
linked support case, and read the denial and any requested information. Reply in
that case to request reconsideration for SES in **us-east-2**. Answer AWS's
specific questions and supply the actual expected volume and operational
processes if requested; do not invent forecasts or claim controls that are not
in place. AWS may require the case to be reopened.

The following implementation facts can support that reply:

> Fil One Commerce sends transactional business-agreement emails from
> https://commerce.fil.one. Authenticated staff select the recipients of each
> agreement. Email consists of signing invitations, staff-requested reminders,
> and completed-document links for signers and designated copy recipients. This
> channel sends no marketing campaigns or purchased-list mail. SignWell handles
> the signature ceremony; Commerce owns the branded recipient journey. The SES
> identity clockwork.fil.one and its DKIM are now verified in us-east-2. The
> account has BOUNCE and COMPLAINT suppression enabled. The new production
> signing journey remains disabled while approval and staging qualification are
> outstanding. Please review production access for this transactional use case.

Account suppression is not evidence of a complete bounce/complaint monitoring
process. Engineering should describe its actual handling to AWS and resolve any
additional requirement in the case. Repeatedly running
`request-production-access` is not a substitute for responding to the denial.

### 2. Verify approval through the existing workflow

Open
[Actions → Signing email readiness](https://github.com/fil-one/clockwork/actions/workflows/signing-email.yml),
choose **Run workflow**, branch **main**, environment **production**, action
**inspect**. This is read-only and uses the existing deployment role; nobody
needs to paste AWS credentials into chat or create a new access key. The CLI
equivalent is:

```sh
gh workflow run signing-email.yml --repo fil-one/clockwork --ref main \
  -f environment=production -f action=inspect
```

Require all of these in the resulting run: `ProductionAccessEnabled: true`,
`SendingEnabled: true`, sender `Verified: true`, `Verification: SUCCESS` and
`DkimStatus: SUCCESS`. A green workflow, submitted request or verified domain
alone is insufficient. If approval is still denied or pending, leave the
creation flag at `signwell`; enabling it would create journeys whose recipients
cannot receive their invitation.

### 3. Finish the staging pilot, then activate

Staging is [clockwork-staging.fil.one](https://clockwork-staging.fil.one/), AWS
account `654654381893`, also in `us-east-2`. It uses non-binding SignWell test
mode. The approved pilot recipients are `james.kurz@gmail.com` and
`james@fil.org`; both SES identities are verified. Keep its recipient allowlist
restricted to these addresses. James has staging commerce-administrator access
and must use his own MFA.

Complete and record the [pilot below](#pilot-before-activation), including
actual email delivery/suppression, the embedded mobile view, countersigning,
archived PDF and final-copy delivery. Automated tests and direct provider tests
do not establish that the deployed Commerce journey works. The provider test
PDFs observed on 2026-11-10 omitted the audit page despite requesting it; the
same export adapter did retrieve an audit page from an existing completed live
agreement. Record that distinction rather than claiming test-mode audit proof.

After **both** AWS readiness and staging qualification pass, set the production
GitHub environment variable and deploy the current green `main`:

```sh
gh variable set COMMERCE_SIGNING_EXPERIENCE --repo fil-one/clockwork \
  --env production --body fil_one
gh workflow run deploy.yml --repo fil-one/clockwork --ref main
```

Wait for staging and production deployment/smoke checks to succeed. A GitHub
variable change does not alter a running task until deployment. For the first
intended, authorized production agreement, confirm the Fil One invitation,
recipient page, archived executed PDF with audit page, and final-copy delivery.
Do not create or sign a live legal agreement just to test deployment.

`COMMERCE_SIGNING_MAIL_ENABLED=true` provisions the mail channel; it does not
activate the new journey. Keep that setting, the API application and the link
secret available for in-flight requests. To stop **new** Fil One requests, set
`COMMERCE_SIGNING_EXPERIENCE` back to `signwell` and deploy; see
[rollback and recovery](#delivery-and-recovery). Rotating the link secret would
revoke outstanding recipient links and sessions, so it is not a rollout step.

## Configure before enabling

- Apply migration `001485_signing_journey.sql` and deploy the app and workers.
- Create/configure the SignWell API application with Fil One branding. Confirm
  embedded signing and custom branding are available on the account. Set
  `SIGNWELL_API_APPLICATION_ID`; retain the existing API key and verified
  webhook subscription (`SIGNWELL_WEBHOOK_ID`).
- In the sending account's SignWell **Profile**, set **When Ordered Signing Has
  Started** to **No**. Real-provider testing found this waiting email is sent
  even with embedded signing enabled, embedded notifications disabled, and every
  recipient's `send_email` set to `false`. SignWell requires Light or Business
  to change notification preferences; Light is sufficient for this setting. Keep
  **On Embedded Documents When Completed** at **No**. These are account
  preferences: changing the ordered-signing notice also affects hosted requests
  from that account. Regular signing invitations and completion mail for
  existing hosted requests remain enabled. See
  [SignWell's email-notification documentation](https://help.signwell.com/article/123-email-notifications).
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

The **Signing email readiness** workflow runs from `main` through the existing
GitHub environment deployment role. Its default `inspect` action reports the SES
account, sender verification and DKIM state without changing them. If SES is in
the sandbox, `verify-test-recipients` sends verification messages only to the
addresses already approved in `COMMERCE_SIGNING_TEST_RECIPIENTS`; recipients
must follow those verification links. `request-production-access` submits the
transactional-mail request to AWS. A submitted request is not approval: inspect
again and require `ProductionAccessEnabled: true` before enabling production
agreement mail. If the domain identity does not yet exist, inspection reports
that it must be deployed; a successful workflow run alone is not readiness. The
script verifies the AWS account before every action. These actions neither send
agreements nor change staff access.

## Pilot before activation

Use approved test addresses only. No account purchase, live agreement, or
external recipient is implied by development of this feature.

1. Send a test MNDA through the normal approval/send flow. Confirm there is one
   Fil One invitation, no provider invitation, and no unexpected provider mail.
2. Check the actual SignWell iframe on desktop and a narrow mobile screen: Fil
   One logo and colors, visible signing controls, complete legal disclosure,
   readable document, editable counterparty details and signatures/date in the
   right positions. The local `/sign/preview` is an illustrative screen, not
   provider qualification. API application settings may still expose provider
   attribution; verify the real account before promising complete white
   labeling. Keep `showHeader: true`: the live recipient view puts **Agree &
   Finish** in that header, so hiding it prevents signing. Document-level
   branding replaces its logo. Loading readiness accepts `iframeLoaded` as well
   as `documentLoaded`; neither event grants access or confirms a signature. The
   2026-11-10 real-provider check found the final disclosure instruction clipped
   inside SignWell's iframe at a 390px viewport, though its disclosure modal and
   finish control remain available. Commerce also provides a wrapping disclosure
   link immediately above the iframe; it opens the full provider disclosure in a
   separate tab without discarding the signature in progress. Verify both paths
   on mobile; the illustrative preview and stubbed browser tests cannot
   establish provider mobile readiness.
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
