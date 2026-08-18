# Internal operations UX handoff

Current disposition: historical provenance. Internal operations UI, persisted
gates/rosters, and record-bound actions were considered repository-qualified
when this handoff was written; the current backlog controls present status.

## Scope

The internal-operations lane now uses feature-local views under
`apps/web/src/features/internal-ops/`. It does not depend on the design-shell
branch and does not change commerce domain rules, API contracts, shared demo
data, or shared UI primitives.

The lane covers operational health, global search, queue triage, renewal and
collections exposure, provisioning recovery, migration matching, reports,
agreement and price-book administration, external gates, safe approvals, and
assisted account actions.

## Workflows

- Operations home separates recommended action from monitoring. Health cards
  show breach or blocker state, owner, freshness, and the recommended route.
- Queues support saved views, URL-persisted filters, SLA/risk/age ordering,
  counts, active-filter labels, desktop split detail, and mobile full-page
  detail. Evidence, policy reason, related records, timestamps, owner/backup,
  and permitted actions remain together.
- Global search persists `q`, groups available results by type, keeps the human
  title as the primary link, and supports arrow-key focus plus Enter.
- Renewals group 30-day, 60–90-day, and 180-day exposure. Exposure estimates
  remain explicitly separate from invoice and collection truth.
- Collections prioritize overdue value, age, dispute state, and owner.
- Provisioning recovery shows attempt count, transient/permanent class,
  idempotency evidence, retry safety, and escalation.
- Migration matching uses human-readable candidate selectors and blocks new
  account creation while candidate matches are ambiguous.
- Reports show supported filters, provenance, freshness, variance state,
  estimate/pending/final labels, supported export actions, and semantic table
  alternatives for charts.
- Agreement templates and price books provide dense version scanning by
  meaningful labels and state. Activation reviews explain affected entity,
  impact, evidence, policy basis, downstream effects, and the required reason.
- External gates are grouped into provider, legal, brand, and operations. Each
  gate shows owner, affected capability, activation test, severity, state,
  reason, and freshness. The presentation remains fail-closed.
- Assisted mode keeps the effective account, immutable staff actor, reason, and
  exit action visible. Commercial actions require a review summary before
  submission is enabled.

## Authority and safety

| Role                          | Primary authority in this lane                                              | Explicit boundaries                                                                                                         |
| ----------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `internal_operator`           | Queue operations, external-gate operations, assisted mode, recovery staging | Cannot grant finance, legal, or destructive approval                                                                        |
| `finance_approver`            | Pricing, credit, collections, report, and price-book approval               | Cannot publish legal templates or grant destructive approval                                                                |
| `legal_approver`              | Agreement and customer-paper decisions                                      | Cannot grant finance or destructive approval                                                                                |
| `destructive_action_approver` | One segregated teardown/offboarding approval                                | Cannot self-approve; a second distinct approval, recent authentication, retention check, and provider authority still apply |

The UI does not accept an editable actor. Server session authority remains the
source of actor identity and permissions. Approval, rejection, offboarding,
assisted, and destructive flows require a decision reason and a review stage.
The review stage states the entity, impact, evidence, policy basis, and
downstream effect. Credit, screening, provider, retention, actor-attribution,
and dual-control gates remain visible and are described as server-revalidated.

Human-readable searchable selectors submit IDs through hidden fields. Technical
IDs and evidence hashes are placed in expandable evidence disclosures unless a
short operational reference is needed for day-to-day triage.

## Operational states

- `Fresh`: the labeled source and update time are suitable for operational use.
- `Stale`: users are warned to verify source truth before deciding.
- `Estimated`: planning or exposure value; never invoice or collection truth.
- `Pending reconciliation`: data exists but is not final.
- `Final`: reconciled source-of-truth value.
- `Review`: evidence or authority is pending.
- `Blocked`: a policy, provider, permission, or ambiguity gate prevents action.
- `Read only`: the record is visible but the current role cannot decide it.
- `Ready for secure submission`: the client review is complete; server-side
  authority and policy checks are still required.

Queue views additionally provide loading, empty, no-match, permission,
stale-data, and fetch-error presentations while preserving the current URL
filter state.

## Accessibility and responsive behavior

- Page and section headings provide a stable outline; tables use captions,
  column headers, and semantic cells.
- Search, filters, saved views, disclosures, selectors, and review controls have
  visible or programmatic names and keyboard focus states.
- Chart information is duplicated in a semantic data table.
- Dense administrative tables scroll within their own bounded region rather than
  widening the document.
- Queue detail is a split panel on desktop and a dedicated route on mobile.
- Feature-local breakpoints cover 1440, 1024, 768, 390, and 320 pixel layouts;
  summary grids collapse to one column on narrow screens.
- Motion is not required to understand state, and reduced-motion preferences are
  respected.

## Validation coverage

Unit coverage includes saved views, URL state, SLA/risk sorting, queue
selection, permission boundaries, required review summaries, technical-ID
disclosures, assisted review gating, lifecycle grouping, and safe-action
reviews.

`apps/web/e2e/ux-internal-ops.spec.ts` covers four explicit personas:

- `internal_operator`: queue filtering and split selection, global search,
  grouped gates, assisted review, and mobile full-page queue detail.
- `finance_approver`: safe approval review, renewal exposure, and reports.
- `legal_approver`: agreement-version scanning and publication review, plus the
  price-book role restriction.
- `destructive_action_approver`: retention-aware offboarding review and dual
  control.

The journeys also assert keyboard focus, accessible names, Axe results on key
administrative pages, and document-level horizontal-overflow checks.

## Merge notes

- Internal route pages point directly to components under
  `apps/web/src/features/internal-ops/`.
- Visible copy is feature-owned (`copy.ts` or a feature data/copy module) and
  can later be aggregated without changing the views.
- No new dependencies, lockfile changes, backend changes, schema changes, or
  shared UI changes are required.
- The external-gate page reads the existing generated contract when configured
  and uses a fail-closed operational fallback when the registry cannot be
  loaded.
