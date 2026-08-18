# Customer and partner UX handoff

Current disposition: historical provenance. The UX implementation and its
authoritative data/action joins were considered repository-qualified when this
handoff was written; the current backlog controls present status.

## Scope

This lane replaces the customer and partner routes' generic surface renderers
with feature-owned experiences under
`apps/web/src/features/customer-partner/**`. It deliberately does not depend on
the unmerged design-shell lane and does not change shared UI primitives, global
CSS, API clients, contracts, demo-data modules, or i18n.

## Workflows

- Customer dashboard: action-first invoice, renewal, expiring-quote, and
  provisioning queue; one prominent account term; expandable service rollup;
  decision-value metrics; contextualized/freshness-labelled chart; secondary
  activity.
- Customer collections: task-specific agreements, quotes, orders/services, POCs,
  billing, amendments, marketplace, support, users, and procurement surfaces
  with responsive comparison views and persisted query state.
- Customer details: type-specific quote, order, and service records with
  breadcrumb, status, next action, commercial summary, term state, artifact
  chain, documents, audit evidence, and disclosed technical identifiers.
- Quote creation: Offer and region; Capacity, term, route, end client or
  partner, and expiry; Review and issue. Human-readable selectors keep canonical
  IDs in the submitted payload, and server responses remain the source of truth.
- Legal, order, billing, and offboarding: review/confirmation boundaries precede
  consequential mutations. Payment truth remains webhook-derived and external
  provider navigation retains URL allow-listing.
- Partner desk and collections: agreement clock and urgent work precede
  analytics, including at mobile widths. Portfolio, registration, resale quote,
  billing, commission, and renewal views put names and commercial meaning before
  technical IDs and keep transfer-price, resale-price, and merchant-of-record
  boundaries explicit.

## URL-state contract

Collection controls use these standard parameters:

| Parameter  | Meaning                                  |
| ---------- | ---------------------------------------- |
| `q`        | Free-text record search                  |
| `status`   | Workflow-specific status                 |
| `risk`     | Risk/attention filter                    |
| `owner`    | Record owner filter                      |
| `sort`     | Stable collection sort key and direction |
| `view`     | Supported table/card density selection   |
| `page`     | One-based result page                    |
| `pageSize` | Result count per page                    |

Controls replace only the parameters they own, preserve other valid collection
state, and return to page 1 when a filter or sort changes. Defaults may be
omitted from a canonical URL. Back/forward navigation rehydrates the visible
controls and result set.

## Permissions

- `owner`: customer read and mutation journeys, including legal and order
  confirmations.
- `member`: customer service visibility without owner-only commercial actions.
- `billing`: invoice and provider handoff visibility without quote mutation.
- `partner_admin`: partner portfolio, commercial, billing, commission, and
  renewal administration.
- `partner_seller`: partner portfolio and selling workflows; administrative or
  sensitive finance actions are hidden or replaced with contextual guidance.

## External truth and safety boundaries

- Quote, agreement, order, and offboarding mutations retain the existing API
  command shapes, CSRF behavior, and idempotency keys.
- Human-readable account, offer, and price-book selectors submit existing IDs;
  customer-facing forms do not require unexplained UUID entry.
- Agreement acceptance foregrounds the approved title/version and authority
  attestation. Template IDs and hashes remain available under technical details.
- Order acceptance reviews the accepted quote, governing agreement, PO, service
  start, and resulting commitment before submission.
- Spend projections are labelled estimates. Invoice amount and payment status
  are distinct, and payment status changes only after provider webhook truth.
- Provider destinations remain validated by the existing navigation safety
  helper; the application does not infer success from a redirect.

## Responsive and accessibility contract

- Desktop comparison views use semantic tables. Compact cards are exposed for
  narrow screens without horizontal scrolling.
- Record titles and row/card surfaces are usable navigation targets; access does
  not depend on a small arrow control.
- Stage changes, validation errors, disclosures, filters, pagination, and
  confirmation controls are keyboard operable. Invalid quote submission focuses
  the first invalid field.
- The integration review covers 1440 px, 768 px, 390 px, and 320 px widths.

## Validation

The lane adds unit coverage for query parsing/serialization, filtering and
sorting, selector-to-ID mapping, quote stages and validation focus, status-valid
actions, permission summaries, and legal/order/renewal review summaries. All 35
feature tests pass. TypeScript and owned-file ESLint checks pass.

The new Playwright lane covers dashboard, quote creation, agreement acceptance,
order acceptance, payment handoff, partner portfolio, resale quote, and renewal
journeys across the five requested personas. All 13 tests pass, including
no-overflow assertions at 1440 px, 768 px, 390 px, and 320 px. The existing nine
persona/axe journeys also pass. The webpack production build compiles all 55
application routes successfully.

The complete pre-existing-plus-new Chromium run reports 28 passing and five
expected baseline failures. Two old workflow tests still drive the superseded
single-screen agreement/order and list-level payment actions; the new tests
exercise the required staged/reviewed replacements. Three old visual snapshots
capture the pre-redesign customer and partner pages. Those tests and snapshots
are outside this lane's exclusive files and should be updated by the merge
instance after it reconciles the shared shell.

## Merge notes

- Merge can later reconcile feature-local CSS and controls with shared
  design-shell primitives. Route entry points already target feature-owned
  components, so no changes to `surface-catalog.ts`, `experience-page.tsx`,
  `workflow-panel.tsx`, or `record-detail.tsx` are required.
- Keep `apps/web/src/features/customer-partner/copy.ts` feature-local until the
  shared i18n lane is ready to absorb the keys.
- Shared API clients, contracts, and demo data are intentionally unchanged.
- No dependency or lockfile changes are part of this lane.
- Full-page Playwright screenshots were inspected at 1440 px, 768 px, 390 px,
  and 320 px because the in-app browser control surface was unavailable in this
  runtime. Feature content has no horizontal overflow. At 390 px and 320 px, the
  shared shell's horizontal navigation and floating development widget can clip
  or overlap content; both live outside this lane and should be reconciled with
  the design-shell merge.
