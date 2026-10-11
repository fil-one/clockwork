# Outbound messages

Nobody outside Fil One (a partner, customer, prospect or any other counterparty)
receives an email or message from Commerce unless a person at Fil One chose to
send that specific message. Nothing goes out on a schedule, in reply to a
provider callback, or as a side effect of another change.

## What a person sends

| Click                                           | What the counterparty receives                                                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Send** on an MNDA, or on an approved contract | SignWell's signing request. When everyone has signed, SignWell emails the signed PDF to the signers and to the preparer, once. |
| **Remind**                                      | One SignWell reminder to whoever signs next. SignWell sends no automatic reminders.                                            |
| **Fix email**                                   | SignWell sends the same request to the corrected address.                                                                      |
| **Void** on a sent MNDA or contract             | SignWell deletes the document, which stops signing. SignWell may tell the signers that the request was canceled.               |
| **Send again** on an ended contract             | A new signing request, after approval where the first one needed it.                                                           |
| **Create invitation** on an organization        | Nothing from Commerce: it shows an invitation link the person shares themselves. Commerce never emails an invitation.          |

## What runs on its own, and what it sends

| Path                                                                  | Sends                                                                                                        |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| SignWell callbacks, **Check status** and the scheduled SignWell check | Nothing: they read SignWell and update the record.                                                           |
| SignWell expiry (30 days)                                             | Whether SignWell emails signers when a request expires is not yet confirmed; check it in SignWell test mode. |
| Collections reminders (`core.schedule.dunning.v1`)                    | An email to the Fil One collections owner only. The customer's billing contacts are not emailed.             |
| Renewal, notice-window, POC-milestone and quote-expiry alerts         | Nothing: no alert is planned to a customer's or partner's contacts.                                          |
| Staff notifications (in-app, email, Slack)                            | Fil One staff only. Recipients must be internal staff; the Slack channel must have no external guests.       |

## Not yet on, and must not be turned on as they are

These send automatically once their capability and provider are switched on.
Each needs a step where a person sends each message before it is switched on:

- Stripe issues and emails an invoice to the customer after provisioning, and
  may email credit notes or refund receipts, depending on the Stripe account's
  settings (billing capability).
- The lifecycle agreement workflow sends a signature envelope to the customer's
  signer (legal capability, with a signature provider).

Before adding anything that sends to someone outside Fil One, give it a click
that sends that one message, and add it to the first table.
