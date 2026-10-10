# Staff notifications

Commerce tells staff when a record they work on changes. Every staff member has
an inbox behind the bell at the top of each page (`/internal/notifications`).
Email and a Slack channel are optional extras, off until they are set up here
and switched on in the app.

| Channel | Works without setup | Turned on by                                           |
| ------- | ------------------- | ------------------------------------------------------ |
| In-app  | Yes                 | Always on                                              |
| Email   | No                  | Deployment setup below, then **Notification settings** |
| Slack   | No                  | A webhook secret below, then **Notification settings** |

**Notification settings** (`/internal/notifications/settings`, commerce
administrators) turns each channel on or off, chooses which kinds each carries
and names the Slack channel. Each person chooses on their own inbox page whether
email reaches them, and for which kinds. Secrets never live in the database: the
page only says whether each channel is configured and sends a test. Every
settings change is audited as `staff_notifications.settings_changed`.

## Who is told what

| Event                                                                               | Who                                                                              |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| MNDA signed by the partner, waiting for Fil One                                     | The sender, and the Fil One countersigner if they are staff                      |
| MNDA fully signed, needs attention, declined or expired                             | The sender                                                                       |
| Contract approval requested                                                         | Holders of `contract:approve`, not the preparer unless they hold `approval:self` |
| Contract approved or sent back with a note                                          | The preparer                                                                     |
| Contract signed by the counterparty, executed, needs attention, declined or expired | The preparer                                                                     |
| Handoff requested                                                                   | Holders of `operations:write`                                                    |
| Handoff in progress, done or declined with a note                                   | The requester                                                                    |
| Capability or price-book activation requested                                       | Its eligible approvers, not the requester unless self-approval applies           |
| Capability or price-book activation approved or rejected                            | The requester                                                                    |

Nobody is told about their own action. A person sees a notification only while
they hold the permissions its record needs. Slack carries, by default, MNDA
fully signed, contract executed, contract approval requested and handoff
requested, as one line with the record type, status, counterparty and a link;
notes and amounts never go to Slack.

## How it runs

Each change is an audit event with an outbox message, written with the change.
The outbox dispatcher (every minute, in the web container's task poller) hands
notifying events to the staff notification handler
(`packages/workflows/src/staff-notifications`), which writes one notification
per recipient and then sends email and Slack. A request or a signing transition
never waits on it or fails because of it.

- **Replays are harmless.** A notification is unique per event and recipient.
  Each email and Slack post is recorded before the provider is called, and a
  delivery recorded once is never sent again from the outbox.
- **Retries.** A provider that is down never fails the outbox message. The
  delivery is recorded as failed, and the retry task
  (`system.staff-notifications.retry.v1`, every five minutes) sends it again
  after 5, 10, 15 minutes and so on, up to six attempts within a day. Then it is
  recorded as given up.
- **Refusals.** A provider that refuses a message (an unverified address, a
  revoked webhook, missing permission) is recorded as failed with the provider's
  code and not retried.
- **Old events.** Events more than 72 hours old notify nobody. The migration
  that added notifications consumed, with no effect, the messages already
  waiting for these event types, so only changes after the release notify.

The settings page lists recent deliveries with their result: sent, skipped (and
why: not configured, channel off, kind off, recipient turned it off), failed
(with the provider's code) or not confirmed (the process stopped while the
provider was being called; it is not sent again). A test message is recorded in
the audit trail as `staff_notifications.test_sent`.

The in-app inbox here is separate from the owner console's notices
(`staff_notices`), which tell commerce administrators about staff access changes
and self-approvals.

## Turn on email

Email goes through Amazon SES in each stage's own AWS account, from
`notifications@<hostname>` (`notifications@clockwork-staging.fil.one`,
`notifications@clockwork.fil.one`). The hostname's DNS zone is in that account's
Route53, so OpenTofu verifies the domain itself.

For each GitHub environment, staging first:

1. Set the variable `COMMERCE_NOTIFICATIONS_EMAIL_ENABLED` to `true`.
2. Run the **Deploy** workflow from `main` (or merge anything to `main`). The
   apply creates the SES identity, its three DKIM records in Route53 and the
   task role's permission to send, and sets the sender in the container.
3. Check the domain is verified, usually within minutes of the deploy:

   ```sh
   aws sesv2 get-email-identity --email-identity clockwork-staging.fil.one \
     --query '[VerifiedForSendingStatus, DkimAttributes.Status]'
   ```

4. Check whether the account is still in the SES sandbox:

   ```sh
   aws sesv2 get-account --query ProductionAccessEnabled
   ```

   `false` means SES sends only to verified addresses. Request production access
   in the SES console (**Account dashboard**, **Request production access**;
   transactional mail, website `https://commerce.fil.one`, staff notifications
   only). AWS usually answers within a day. Until then, verify each staff
   address that should receive mail with
   `aws sesv2 create-email-identity --email-identity person@fil.one` and have
   them click the link SES sends.

5. In Commerce, open **Notification settings**, turn on **Send notifications by
   email**, save, and choose **Send a test**. The test goes to your own address.

To send from another domain, such as `fil.one`, also set the variable
`COMMERCE_NOTIFICATIONS_EMAIL_DOMAIN`. OpenTofu then creates the identity but
not the DNS records, because that zone is in Cloudflare: add the three CNAMEs
from `tofu output notifications_email_dkim_records` in fil-one/infrastructure.
If an SES identity for the domain already exists in the account, import it
before enabling
(`tofu import 'aws_sesv2_email_identity.notifications[0]' <domain>`), or the
apply refuses to create a second one.

## Turn on Slack

1. In Slack, create an incoming webhook for the channel (a Slack app with
   **Incoming Webhooks**, added to that channel). Copy the
   `https://hooks.slack.com/services/...` URL.
2. Add it to the GitHub environment as the secret
   `COMMERCE_NOTIFICATIONS_SLACK_WEBHOOK_URL`, then run the **Deploy** workflow
   from `main`. OpenTofu stores it in Secrets Manager and the task reads it at
   start.
3. In **Notification settings**, turn on **Post to Slack**, enter the channel's
   name (for example `#revenue`), choose the kinds, save, and choose **Send a
   test**.

## Turn a channel off

Switch it off in **Notification settings**; it takes effect on the next event.
To remove a channel entirely, delete its GitHub variable or secret and deploy. A
channel that is on in settings but missing its configuration sends nothing; the
settings page says so and each delivery is recorded as skipped.

## Local development and the demo

Without configuration nothing is sent. To try email or Slack locally, set
`COMMERCE_NOTIFICATIONS_EMAIL_PROVIDER=ses`, `COMMERCE_NOTIFICATIONS_EMAIL_FROM`
(and AWS credentials), or `COMMERCE_NOTIFICATIONS_SLACK_WEBHOOK_URL`, in
`.env.local`. The guided demo shows fictional notifications to its staff
personas, keeps read state in the browser and never sends.

## Add a notification

1. Add the kind to `staffNotificationKinds` in
   `packages/contracts/src/staff-notifications.ts`, with the permissions a
   reader needs.
2. Map the event type that causes it in
   `packages/workflows/src/staff-notifications/sources.ts`, with its recipients.
3. Word it in `apps/web/src/i18n/messages/operations-notifications.ts`, in
   `apps/web/src/features/internal-ops/notifications/model.ts`, and for email
   and Slack in `packages/workflows/src/staff-notifications/messages.ts`.

The event must be written with `appendAuditAndOutbox`, as every change already
is.
