# HubSpot handoff and pipeline

Sellers bring a HubSpot company or deal into Commerce as a partner record,
keeping its context and source, and see HubSpot's pipeline beside their Commerce
work. HubSpot stays authoritative for CRM activity and pipeline; Commerce owns
partners, agreements, terms and registrations. Commerce only reads HubSpot: it
never changes a stage, sends email, invites anyone or writes any CRM record.

The common path is **choose a source → review the handoff → continue the
commercial work**:

1. **Partners → From HubSpot** (or **Bring into Commerce** on a pipeline deal)
   opens a search-first picker at `/internal/hubspot`. It accepts a company or
   deal name, or a pasted HubSpot record link. A link to another portal is
   explained, never followed. Nothing loads until someone searches.
2. A deal asks which of its companies becomes the partner, with every option
   unselected; HubSpot labels such as Primary are context, not a choice.
3. The review at `/internal/hubspot/review` shows the HubSpot company beside the
   Commerce partner it becomes. Nothing optional starts selected except the
   originating deal as context. The footer states the plan's result ("Create
   Northstar Systems as a partner with 2 contacts, 1 deal reference, and 1
   document") from the same plan the server commits, and one button commits it.
   **More control** keeps approved properties for reference and offers **Clear
   value**; opening or closing it keeps every choice.
4. The partner page opens with a receipt: what was copied, what was kept for
   reference, what was left out, and each document's result. **Continue in
   Commerce** opens the partner form, a deal registration with the chosen end
   customer and source link as suggestions, or an MNDA with the company and
   chosen contact as suggestions. Nothing is submitted for the seller.

## Rules the implementation enforces

- **Linking, viewing and importing are separate.** A link (one HubSpot company
  to at most one partner, and one partner to at most one company per portal)
  copies nothing. Live HubSpot data is read through the approved scope and never
  written into Commerce fields. An import copies only what the person selected
  in a reviewed plan.
- **Commerce values survive.** An update keeps every Commerce value unless the
  person chooses **Use HubSpot** or **Clear value**; a HubSpot blank never
  clears anything. Each field is classified against the last import: changed
  only in HubSpot (proposed), only in Commerce (kept), or on both sides (no
  default; the commit is blocked until someone chooses). Owner, status, models
  and terms never change in an update import.
- **New partners** start as **Prospect**, editable, beside the deal's sales
  stage; Commerce never infers Signed or Active. The owner is the staff member
  an administrator mapped the HubSpot owner to, otherwise the reviewer if they
  hold the sales workspace, otherwise Unassigned, with the reason shown.
- **Similar partners** (same normalized name or website host) must each be
  inspected: used instead, or set aside with a short reason recorded with the
  import. Nothing merges automatically.
- **People** keep their HubSpot contact ID, portal and association labels on the
  partner's contact, with a stable Commerce contact ID. A repeat import matches
  by that identity, never by name; a same-email contact is linked only when the
  person confirms it is the same person. Primary is never inferred.
- **The deal is a reference**, not a registration: its pipeline and stage
  labels, amount and currency (or **Not set**), close date, owner and every
  associated company with its labels are kept as they were. A Closed Won deal or
  a PDF called signed approves nothing, executes nothing and creates no
  protection. An amount never fills a storage size.
- **Never silently dropped.** A selected person, note, file or property that is
  no longer available stops the commit with a reason; unsupported, too large or
  unreadable files are listed as such. Commission, margin, exclusivity, contract
  and approval state are never imported.
- **Changed since review.** The commit reads HubSpot again and compares digests
  of the company, the deal and every selected item. A difference sends the
  person back to the refreshed review with their choices intact. The partner
  version and connection version are checked inside the transaction.

## Storage (migration 001483)

| Table                           | Holds                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `commerce_hubspot_connections`  | The approved portal, audience, scope, default pipeline and owner mappings. One active row; disconnecting keeps it. |
| `commerce_external_links`       | Typed company → partner (or account) links. Append-only, unique per source and destination type.                   |
| `commerce_hubspot_imports`      | Each import: the reviewed plan and the immutable selected-source snapshot, keyed by the operation ID.              |
| `commerce_hubspot_import_items` | One row per selected document with its own status; attached, reused and excluded are final.                        |

The partner, its link, its contacts, the import, its items and the audit events
commit in one transaction. The unique link index means two people bringing in
the same company at once create one partner; the other review resolves to it.
Sending the same operation again returns the first result; a different request
under the same ID is refused.

Live CRM data is not stored. Pages read HubSpot each time through a short
in-process cache (five minutes, keyed by the connection ID and version); during
a brief HubSpot outage the last answer is shown marked **Stale** with its age,
and imports wait. The connection is checked in the database before any cached
value is served, so a disconnect hides live data at once.

Audit: `hubspot.connection_activated`, `hubspot.connection_updated`,
`hubspot.connection_disconnected`, `hubspot.imported`,
`hubspot.document_attached`, `hubspot.document_failed`,
`hubspot.document_duplicate`, `hubspot.document_reused` and
`hubspot.document_excluded`, plus `partner.created` and `partner.updated`
carrying the HubSpot source. `hubspot.*` events carry IDs, counts and reasons,
not contact details; `partner.*` events record changed fields, contacts
included, exactly as any partner edit does.

## Documents

Selected PDFs come across one at a time after the commit, each with its own
result, as private partner attachments (`account.document_attached` with HubSpot
provenance: portal, file, note and import). Before each attempt the file is
re-read: a file changed since the review fails as changed and needs a fresh
review. Bytes are fetched through a five-minute signed URL that is never stored.
An identical PDF already on the partner stops at **Already attached** until
someone chooses **Use existing attachment** or excludes it.

A document that fails leaves the partner usable with the receipt saying
**Partner created · 1 document still needs attention**. **Retry document**
retries only that item; a lost answer is recognised by the attachment ID and
never attaches twice. **Exclude this item and finish** needs a reason and
records an audited amendment; the receipt then says **Completed with 1 item
excluded**. An attachment brought in by mistake is removed under **Documents**
(see [partner records](partner-records.md#removing-a-document)); the receipt
then notes the removal.

## Pipeline

`/internal/pipeline` (Sales → Pipeline) shows the administrator's default
pipeline and open deals, filterable by pipeline, open/closed, stage, owner,
close dates, currency, deal or company text and whether all, some or none of a
deal's companies are linked. The stage counts and totals use the same filtered
list as the table and board, count each deal once, group amounts by currency
without a combined total, and count missing amounts instead of treating them as
zero. Commerce reads at most 2,000 deals per pipeline and state; beyond that the
page says the totals are partial. The board is read-only. Selecting a deal opens
a side panel (full width on narrow screens) with its companies, labels, links
and people, **Bring into Commerce** and **Open in HubSpot**. The page address
carries the filters, so **Copy link to this view** shares the view without
widening anyone's access.

## The partner page

The **HubSpot** section shows the linked company, who linked it, **Last
checked** and **Updated in HubSpot**, how many imported values changed in
HubSpot since the last import with **Review updates**, the current approved
details, **HubSpot deals associated with this company** (with the note that
association is not sourcing, ownership or revenue credit), and the import
history. Contacts brought in show **From HubSpot** and their labels.

## Connecting HubSpot

The connection page (**Owner console → Integrations → HubSpot connection**,
`/internal/owner/hubspot`) shows this checklist with where the environment
stands, and administrators see **Set up HubSpot** on Partners until it is done.

1. **Create a read-only service key in HubSpot.** A HubSpot super admin (or a
   user with Developer tools access) opens Development → Keys → Service keys →
   Create service key, names it Fil One Commerce and adds only:
   `crm.objects.companies.read`, `crm.objects.deals.read`,
   `crm.objects.contacts.read`, `crm.objects.owners.read`,
   `crm.schemas.companies.read`, `crm.schemas.deals.read`,
   `crm.schemas.contacts.read`, plus `files` and `files.ui_hidden.read` to bring
   PDFs across from notes (note attachments live in HubSpot's hidden file
   folder). No write scopes. Copy the key. A legacy private-app token with the
   same scopes works identically: both are sent as a bearer token, and Commerce
   identifies the portal from the key itself. Rotate the key in HubSpot about
   every six months, then update the secret and redeploy.
2. **Add the token to the deployment.** In GitHub, fil-one/clockwork → Settings
   → Environments, add the secret `HUBSPOT_ACCESS_TOKEN` to `production` (and
   `staging` to try it there first). Then run **Actions → Deploy → Run
   workflow** on `main`; the deploy passes it to the app as
   `TF_VAR_hubspot_access_token`. It never reaches the database or a browser.
3. **Approve the connection** on the connection page (below).
4. **Use it:** Partners → From HubSpot, Sales → Pipeline, or **Link HubSpot
   record** on a partner.

## Connection and access

- **Token.** Without `HUBSPOT_ACCESS_TOKEN`, HubSpot pages explain that HubSpot
  is not set up and offer manual partner creation.
- **Activation.** **Owner console → Integrations → HubSpot connection**
  (`/internal/owner/hubspot`, `staff:manage`) shows the portal the token reaches
  and runs a read-only check. The administrator chooses the deal pipelines staff
  may see (deals in other pipelines are unreadable in the pipeline view, search
  and handoffs alike), the additional properties staff may read (properties
  HubSpot marks sensitive cannot be chosen; unknown or new properties stay
  unreadable), whether notes and files are readable, the default pipeline and
  owner mappings, and must accept the audience: **staff with Sales access**,
  which can differ from each person's HubSpot visibility. Acceptance is required
  each time the scope is saved and is recorded with the administrator's name.
- **Permissions.** Viewing HubSpot data needs `sales:read`; importing needs
  `contract:write`, the existing partner write permission; the connection needs
  `staff:manage`. Every check also requires a real staff session with MFA,
  outside impersonation and assisted sessions. The guided demo reads a fictional
  portal and cannot import.
- **Disconnect** stops live reads and invalidates pending reviews at once.
  Imported partners, contacts, documents, source identifiers and history stay. A
  different portal needs a new activation; links are keyed by portal, so IDs
  from two portals never collide.

## Not built yet

These parts of the product specification are deliberately deferred; the storage
and plan model leave room for them.

- **Accounts as a destination.** The link table accepts accounts, but the
  handoff creates and updates staff partner records only.
- **Saved import presets**, **bulk review of up to 100 companies**, and **Review
  reversal**.
- **Saved and team pipeline views** (the URL is the shareable view today) and
  filters on custom properties.
- **Identical PDFs in the review itself.** An identical attachment is found when
  the document is brought across; the receipt then stops for **Use existing
  attachment** or exclusion, so nothing is attached twice.
- **Company-level scope.** Every company in the portal is readable by the
  approved audience; scope is set by pipeline and property.
- **A HubSpot-side record card.** Pasting a HubSpot record link into the picker
  gives the same workflow without the UI extension.

## Configuration to verify before activation

Confirm the portal; the audience and the data it may read; the actual
company/deal association labels; the default pipeline; owner mappings; which
custom properties carry commercial meaning; note and file access; and whether
the HubSpot-side card is wanted. None of these are guessed from data.
