# Fil One Commerce for the revenue team

Fil One Commerce at `https://commerce.fil.one` is where the revenue team sends
mutual NDAs (MNDAs), keeps the contract register, finds sales material and
checks indicative pricing. Sellers do not see billing, provisioning or the
operations tools.

Practice in the demo: https://clockwork-commerce-demo.netlify.app. It uses
made-up companies and sends nothing.

## Getting access

1. A commerce administrator adds you on the **Team** page with your work email
   (`fil.one` or `fil.org`). Today the commerce administrators are James Kurz
   and R.W. Holleman. No invitation email is sent, so they tell you when you are
   set up.
2. Open `https://commerce.fil.one` and sign in with that email. You receive a
   one-time code by email; enter it to confirm the address.
3. On your first sign-in you set up an authenticator app (for example 1Password,
   Google Authenticator or Authy). Keep it on a device you carry.
4. You land on **Home**, which shows your own work.

New sellers get the **Revenue** role: Home, MNDAs, Contracts, Sales library and
Pricing. Commerce administrators also see Team, the owner console, MNDA settings
and the operations groups.

Commerce asks for the 6-digit code from your authenticator. A verification lasts
eight hours, and sensitive actions may ask again if your last check is more than
five minutes old. If a page reports a problem after you have been signed in for
a while, choose **Verify sign-in**, enter a fresh code and try again. Lost your
phone or authenticator? Ask a commerce administrator to reset your access.
Nobody else can enroll a factor for you.

## Send an MNDA

1. Open **MNDAs** and choose **New MNDA**.
2. Enter the partner signer's name and email, then the company's legal name.
   Fill in any other details you know and leave the rest blank: the partner
   completes the blanks when signing. Choose **Our team enters the details**
   only when you have every detail.
3. Use Latin-script names and addresses (accents are fine). Write the entity
   type without "a" or "an", for example `Delaware corporation`.
4. If Commerce already has an MNDA with that company, or the contract register
   lists any agreement with it (an NDA on their paper, an MSA), a note under the
   company name shows it with a link. Check it before sending another.
5. Choose **Prepare preview** and open the PDF. To fix something, choose **Edit
   details**; the corrected preview replaces the old draft.
6. Choose **Confirm and send**. The partner receives an email from SignWell, our
   signing service. The partner signs first, then the Fil One countersigner.

If a problem with what you entered stops the preview, the message appears next
to the field.

## Check status

**Home** (My work) counts your MNDAs waiting on the partner, waiting on Fil One,
completed in the last 30 days, and your unsent drafts. Each line opens the
register filtered to those MNDAs; the team total opens everyone's.

Home also counts the contracts you recorded or prepared that are out for
signature or need attention. Approvers see the contracts someone else prepared
that are waiting for their approval.

The MNDA register filters by status (Waiting on partner, Waiting on Fil One,
Needs attention, Signed, Drafts, Closed), **Only mine** and search. Each row
shows when it was sent and how many days it has been open. While the tab is
visible, the page reloads the register from Commerce every 15 seconds.
**Refresh** on a row asks SignWell for the latest status at once; otherwise
Commerce checks SignWell on a schedule.

Commerce does not email you when a status changes. When both sides have signed,
SignWell emails the signed agreement to both signers and to you.

### What a note on a row means

| What the row says                                                            | What to do                                                                                                                           |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| The partner's email bounced.                                                 | **Fix email**. SignWell sends it to the new address.                                                                                 |
| SignWell stopped this request.                                               | **Void** it, then **Send again**.                                                                                                    |
| Deleted in SignWell.                                                         | **Void** it here to close it, then send again if needed.                                                                             |
| The signers in SignWell no longer match this MNDA.                           | If you just fixed the partner's email, choose **Fix email** again with the same address. Otherwise **Void** it, then **Send again**. |
| Someone signed this MNDA in SignWell, but SignWell's copy does not match it. | Ask a commerce administrator to resolve it in SignWell. **Void** and **Fix email** are not offered.                                  |
| SignWell's copy does not belong to this MNDA.                                | **Void** it, then **Send again**.                                                                                                    |
| Sending did not finish.                                                      | **Continue** and send again. The partner never gets two.                                                                             |
| SignWell did not answer the last check.                                      | **Refresh** in a minute.                                                                                                             |

An MNDA the partner declined, or did not sign within 30 days, moves to
**Closed**. **Send again** starts a new draft from it.

### Reminders

SignWell reminds the partner automatically. **Remind** sends one now: to the
partner, or to the Fil One countersigner once the partner has signed. Reminders
are at least a minute apart.

## Fix a wrong email

**Fix email** replaces the partner's email while they have not started signing.
SignWell sends the request to the new address; the signer's name stays the same.

If a different person will sign for the partner, choose **Fix email**, then
**Someone else will sign**, and confirm the void. Commerce voids the MNDA and
opens a new draft with the same company details and a blank signer.

You can fix or void the MNDAs you prepared; a commerce administrator can do
either for any MNDA.

Once the partner has started signing, the email cannot change: void the MNDA and
send a new one.

## Void an MNDA

**Void** works on sent, opened or **Needs attention** MNDAs until the partner
signs. Enter a reason. Commerce checks SignWell, stops the request and keeps the
original PDF, the reason and the history. An unsent draft has **Discard draft**
instead.

If the partner has already signed, the MNDA cannot be voided: tell the Fil One
countersigner not to sign it.

## Contracts

- **Record a contract** adds an agreement signed outside Commerce, or one you
  are negotiating on the counterparty's paper, with its PDFs and key dates.
- **New from template** prepares a Fil One agreement for signature. Templates
  show **Template pending from legal** until counsel approves them.
- A prepared contract that needs approval waits for someone with approval rights
  other than you. They approve it or send it back with a note.
- After sending, a contract has **Remind** and **Void**. Until the counterparty
  signs, the person who prepared it, a legal approver or a commerce
  administrator can void it; finance approvers cannot. It has no **Fix email**:
  if a signer's email is wrong, void it and prepare it again, or ask a commerce
  administrator.
- **Renewal notices** lists executed contracts that renew automatically and
  whose notice deadline is coming up.

## Find a signed PDF

- MNDAs: filter the register to **Signed**, then download from the row. The file
  is named `Fil-One-MNDA_<Company>_<date>_signed.pdf` and includes SignWell's
  signing record.
- Contracts: open the contract; its files are under **Documents**. Signed MNDAs
  also appear in the contract register as executed MNDAs.

## Export the register

- MNDAs: **Export CSV** downloads the register as filtered, up to the newest
  10,000 rows.
- Contracts: **Export CSV** on the Contracts page downloads the filtered
  register, including signed MNDAs, up to 5,000 rows.

Every download and export is recorded under your name.

## If your session expires

If an action shows "Your session expired. Reload to continue.", choose
**Reload**. Your session refreshes in place and what you typed stays on the
page, so you can submit again. If the page asks you to sign in, sign in and try
again.

## Where things are

| Page          | What it is for                                                                                              |
| ------------- | ----------------------------------------------------------------------------------------------------------- |
| Home          | Your MNDAs and contracts by what they are waiting on, and the start guide.                                  |
| MNDAs         | Send, remind, fix an email, void, check status, download, export.                                           |
| Contracts     | Every agreement. Record one, prepare from a template, send, remind, void, export.                           |
| Sales library | Current decks, one-pagers, pricing sheets and case studies.                                                 |
| Pricing       | Indicative prices for a conversation, worked out from the current price book. Not a quote and not an offer. |
| Team          | Commerce administrators only: add staff, change roles, remove access.                                       |

Press `⌘K` (or `Ctrl+K`) anywhere to search pages, for example "NDA" or
"pricing".

## Who to ask

- Access, roles and MFA resets: a commerce administrator (James Kurz,
  `james@fil.one`, or R.W. Holleman, Head of Revenue).
- Who can sign for Fil One, and legal wording: James Kurz.
- Something not working: tell a commerce administrator what you were doing, and
  include the request ID if the error shows one.
