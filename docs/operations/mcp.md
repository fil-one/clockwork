# Using Fil One Commerce from Claude (MCP)

Fil One Commerce has an MCP endpoint at `https://commerce.fil.one/api/mcp`.
Claude Code and other MCP clients use it to read the registers and prepare sales
work: draft MNDAs, record contracts and prepare them for signature, keep partner
records, price scenarios and raise handoffs.

**Nothing reaches a partner or any other external party from MCP.** No tool
sends, reminds, re-sends, voids or redirects a signing request, or emails or
messages anyone outside Fil One. Tools draft and prepare, then return a **Review
and send in Commerce** link; a person sends from the app.
`mcp-owner-rule.integration.test.ts` runs every write tool against a real
database with SignWell switched on but its clients replaced by spies that allow
only reads, the staff email and Slack senders replaced by spies, and every
network request off the machine refused; it fails if any tool tries to send, and
if a write tool is added without a case. `mcp.test.ts` also refuses tool code
that names a sending action.

Every call acts as you, with the permissions your roles give you today, and
every call is recorded in the audit trail with the token that made it.

## Create a token

1. Open **Settings** (your name in the top right, then **Settings**).
2. Under **Access tokens**, choose **Verify with your authenticator** if the
   page asks, enter a code, then come back to Settings. Creating a token needs a
   code entered in this session in the last 30 minutes; a recent sign-in alone
   is not enough, because the token remembers which authenticator approved it.
3. Name the token for where you will use it, choose **Read only** or **Read and
   write**, and choose when it expires (90 days unless you pick otherwise; at
   most a year).
4. Copy the token when it appears. It is shown once. Commerce keeps only a
   SHA-256 fingerprint of it, so a lost token cannot be recovered: revoke it and
   create another.

Tokens start with `fo_pat_`. Treat one like a password: keep it out of chat,
email, tickets and repositories. Revoke a token on the same page as soon as you
stop using it. A person can hold 20 live tokens.

## Connect Claude Code

```sh
claude mcp add --transport http fil-one-commerce https://commerce.fil.one/api/mcp \
  --header "Authorization: Bearer <token>"
```

The Settings page shows this command with your token filled in. Add
`--scope user` to make it available in every project. Check it with
`claude mcp list`, then ask Claude to run `whoami`.

## Connect Claude desktop and claude.ai

Custom connectors in claude.ai and Claude desktop sign in to a remote MCP server
with OAuth and cannot send a fixed `Authorization` header. Commerce does not
offer OAuth sign-in for MCP yet, so a custom connector cannot connect to it
today.

Claude desktop can still use the endpoint through a local bridge that adds the
header, such as the open-source `mcp-remote` package. In
`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "fil-one-commerce": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://commerce.fil.one/api/mcp",
        "--header",
        "Authorization:${COMMERCE_AUTH}"
      ],
      "env": { "COMMERCE_AUTH": "Bearer <token>" }
    }
  }
}
```

The bridge is third-party code that runs on your machine with your token.
Restart Claude desktop after editing the file.

## What the tools do

Write tools appear only for a **Read and write** token. A read-only token does
not list them, and refuses them if called (the refusal is audited).

Tools that create a record (`create_mnda_draft`, `create_partner`,
`register_partner_deal`, `record_contract`, `prepare_from_template`,
`create_handoff_request`, `save_pricing_scenario`) accept an `id` you choose, so
a retried call returns the record it made instead of making a second one. A
request carries one JSON-RPC message; batches are refused.

Reuse the same `id` and explicit input values when retrying a creation. For
`record_contract`, an identical PDF attachment (same filename, kind, bytes and
uploader) is reused, including concurrent retries. Invalid PDFs are refused
before contract metadata is saved. Updates still require the current version;
read the record again after a version conflict.

When an MNDA or contract preparation names a `countersignerId`, that signer must
be available. An unavailable ID is refused rather than replaced with a default.
`list_notifications` returns `nextCursor`; pass it as `before` to continue, even
if `unreadOnly` leaves the current page empty. A null cursor means the end.

| Tool                             | Access | What it does                                                                                                 |
| -------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------ |
| `whoami`                         | read   | You, your roles and permissions, whether you are MFA-enrolled, and the token's scope and expiry              |
| `home_summary`                   | read   | What Home shows you: MNDA, contract and partner counts, renewal notices, your open handoffs                  |
| `list_mndas`                     | read   | Search the MNDA register by text, status group, state or "prepared by me"                                    |
| `get_mnda`                       | read   | One MNDA with its signer, state, dates and links                                                             |
| `create_mnda_draft`              | write  | Prepare a draft from the approved template and render its preview; flags MNDAs and contracts already on file |
| `prepare_mnda_preview`           | write  | A draft's preview link, or a revised draft that replaces it                                                  |
| `check_mnda_status`              | write  | Refresh an MNDA's status from SignWell, as the Refresh button does                                           |
| `download_signed_mnda`           | read   | Link to the signed PDF; the PDF inline on request when it is at most 4 MB                                    |
| `list_contracts`                 | read   | Search the contract register                                                                                 |
| `get_contract`                   | read   | One contract with its files, signing request and earlier requests                                            |
| `record_contract`                | write  | Record or edit a contract (optimistic version) and attach one PDF as base64, at most 10 MB                   |
| `prepare_contract_for_signature` | write  | Prepare an uploaded PDF for signature; another person approves it and a person sends it in the app           |
| `renewal_notices`                | read   | Notice deadlines in the next 30, 60 or 90 days, and deadlines passed                                         |
| `list_contract_templates`        | read   | Available templates and, for one, its fields and countersigners                                              |
| `prepare_from_template`          | write  | Prepare a contract from an available template                                                                |
| `list_partners`                  | read   | Partners with status, owner, next step and headline terms                                                    |
| `get_partner`                    | read   | One partner with terms, deals, overlaps, linked MNDAs and contracts, and history                             |
| `create_partner`                 | write  | Record a partner                                                                                             |
| `update_partner`                 | write  | Edit a partner against the version you read                                                                  |
| `list_partner_deals`             | read   | A partner's registered deals and overlapping registrations                                                   |
| `register_partner_deal`          | write  | Register a deal; overlaps come back as a warning                                                             |
| `update_partner_deal`            | write  | Edit a deal, such as marking it won or lost                                                                  |
| `partner_next_steps_due`         | read   | Partner next steps overdue or due soon                                                                       |
| `list_price_books`               | read   | Price books in force and their list-price rates                                                              |
| `indicative_price`               | read   | Price lines in TB, PB, TiB or PiB with discount and term, and partner economics, without saving              |
| `list_pricing_scenarios`         | read   | Your saved scenarios, or one with its figures                                                                |
| `save_pricing_scenario`          | write  | Save or overwrite a scenario                                                                                 |
| `pricing_summary_pdf_link`       | read   | The customer or partner summary PDF link                                                                     |
| `create_handoff_request`         | write  | Hand signed contracts to operations                                                                          |
| `list_handoffs`                  | read   | Your handoff requests, or the operations queue if you may read it                                            |
| `list_notifications`             | read   | Your staff notifications, newest first, with links                                                           |
| `mark_notifications_read`        | write  | Mark notifications read, some or all                                                                         |
| `list_sales_library`             | read   | Sales collateral with download links                                                                         |

Links in results open in the app and need you to be signed in there. PDF
downloads through those links are audited as they are in the app.

Tools call the same server code as the pages, so the same rules apply: a seller
sees and changes what a seller can in the app, an uploaded PDF still needs
another person's approval before it is sent, and pricing shows list prices and
the figures the Pricing page shows, never floors or transfer prices.

## What stays in the app

These have no tool, on purpose:

- Sending anything to a counterparty: sending, reminding, sending again, voiding
  and correcting a signer's email, for MNDAs and contracts alike. SignWell
  emails the signer for each of these.
- Approvals of every kind: contract approvals, capability switches, price books,
  and approving your own request.
- Team, role and permission changes, MNDA settings and countersigners,
  notification settings, the owner console and assisted sessions.
- Anything that needs an MFA check in the last 30 minutes. A token never counts
  as a recent sign-in, so such an action is refused with a pointer to the app.

These are the messages, decisions and controls where a person should be looking
at the screen, and many of them need the fresh MFA check a token cannot give.

The guided demo has no MCP endpoint, so nothing can be sent from it.

## How a token is protected

- Only the token's SHA-256 hash and a display prefix (`fo_pat_` and four
  characters) are stored, in `commerce_access_tokens` (migration 001480). The
  table is service-role only with forced row security, and the service role can
  change only a token's use, rate window, revocation and version.
- A request authenticates with `Authorization: Bearer` and nothing else. Session
  cookies never authenticate the endpoint, so no CSRF check applies. The
  endpoint is outside the page proxy, like the other API namespaces.
- CLI requests may omit `Origin`. A present `Origin` must match the configured
  canonical origin; other origins receive `403`. Invalid canonical-origin
  configuration does not fall back to a request host or metadata default.
- Each request reads your current staff membership and roles. Removing your
  staff access revokes your tokens, and so does an authenticator reset: when you
  next verify MFA with a different authenticator, tokens created under the old
  one are revoked. Someone with two authenticators who verifies with the other
  one loses their tokens the same way. A reset in WorkOS that is never followed
  by a verification leaves the token alive until it expires or someone revokes
  it, so a commerce administrator who resets someone's authenticator also
  revokes their tokens on the Team page.
- Token creation and authenticator changes share a per-user lock. An older
  session cannot create a replacement token after a different authenticator has
  become current; it must verify again. Migration 001481 records the current
  factor and revokes existing tokens that disagree with known receipt history.
- Commerce administrators see and revoke everyone's tokens on the **Team** page.
- Links in results use the configured canonical origin
  (`CLOCKWORK_CANONICAL_ORIGIN`); without it a production deployment answers
  `503` rather than build links from the request's host.
- Each token may make 120 requests a minute. Past that the endpoint answers
  `429` with `Retry-After`.

## Audit

- `access_token.created` and `access_token.revoked` events for each token, with
  the person who did it, or the system for automatic revocations.
- One `mcp.tool_called` event per tool call, recorded against the token, with
  the person as actor and `metadata` holding `channel: "mcp"`, the token id, the
  tool, the outcome (`ok`, `refused` or `failed`), any refusal code and the
  record ids the call named.
- The change itself writes the same audit event it writes from the app, such as
  `partner.created` or `mnda.drafted`, with the person as actor. That event does
  not carry the channel; match it to the `mcp.tool_called` event by the record
  id and time.
- Calls refused before they run are recorded as `refused` too: a write tool on a
  read-only token (`READ_ONLY_TOKEN`), an unknown tool (`UNKNOWN_TOOL`), invalid
  arguments (`INVALID_ARGUMENTS`), or a request the transport refused, such as a
  wrong `Accept` header (`TRANSPORT_REFUSED`, with `httpStatus`). If recording a
  call fails, the server logs it; the call's own audit event still exists.

## When something is refused

| Answer                        | What to do                                                                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `401` with `WWW-Authenticate` | The token is missing, mistyped, expired or revoked, or you no longer have staff access. The answer does not say which. Create a new one. |
| `429`                         | Wait for the seconds in `Retry-After`.                                                                                                   |
| `… disabled`                  | The token is read-only. Create a read-and-write token.                                                                                   |
| `*_FORBIDDEN`                 | Your role does not allow it, as in the app.                                                                                              |
| `RECENT_AUTH_REQUIRED`        | It needs a fresh MFA check. Do it in the app.                                                                                            |
| `*_VERSION_CONFLICT`          | Someone changed the record since you read it. Read it again and retry.                                                                   |
| `*_NOT_CONFIGURED`            | SignWell is not switched on in this environment.                                                                                         |

## QA evidence — October 11, 2026

Three reviewers examined transport interoperability, access-token lifecycle, and
tool workflows, then independently reviewed the resulting fixes. The pass
corrected Origin validation, stale-authenticator token creation, notification
pagination, explicit countersigner selection, upload retry duplication and PDF
validation order, and added caller-provided IDs for MNDA creation.

Validation used an isolated copy of the local database upgraded through
migration 001481. It included 40 MCP unit/SDK transport tests, 16 real-route and
outbound-message guard integration tests, 9 token repository tests, 37 contract
repository tests, and 30 scoped database assertions. The token tests cover both
concurrent creation/factor-change orders. A rollback-only migration probe
checked populated receipt history, stale-token repair, and preservation of
matching tokens and users without receipt history. Web and database type checks,
lint, formatting and dependency boundaries passed.

Every registered write tool completed a successful local path with signing,
email, Slack and off-host network calls trapped. Status refresh used a read-only
provider response; no real provider or counterparty was contacted. SDK client
initialization, listing and calling were exercised with local authentication
fixtures. Hosted token issuance, a live Claude connection and production
deployment were not exercised by this pass.
