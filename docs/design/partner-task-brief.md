# Partner experience brief

Status: repository-qualified implementation; any human design approval is a
future launch-only decision and is not claimed here

## Decision frame

- **User:** a partner seller or partner administrator managing named end-client
  opportunities under a channel agreement.
- **Moment:** the partner needs to protect an opportunity, prepare a resale
  quote, or act before channel authority changes.
- **Decision:** am I authorized to transact, which named account needs action,
  and what evidence is required next?
- **Primary task:** resolve the agreement-clock constraint, then advance one
  record-bound resale action with explicit merchant and attribution boundaries.
- **Density:** relationship-dense. A persistent agreement clock leads; a
  compact, sortable work ledger follows; commercial rollups are subordinate.
- **Voice:** precise, channel-aware, and boundary-conscious. It names the end
  client, partner role, merchant of record, protection window, evidence, and due
  date.

## Composition

The partner home is an agreement clock plus a work ledger. Authority and notice
dates are one semantic sequence rather than independent status cards. Named
accounts appear in a list/table because sellers compare owner, stage,
protection, evidence, and next action. Admin-only economics are disclosed only
to authorized roles.

On mobile each ledger row preserves the end-client name, protection state, due
date, and record action before optional economics. The clock becomes a vertical
milestone list rather than a scaled-down chart.

## Reject list

- No customer dashboard with partner nouns substituted.
- No equal-weight KPI quartet or generic “growth” chart.
- No unaffiliated account totals without named-record drill-through.
- No mixed referral, resale, distributor, or merchant boundaries.
- No action for an unselected or unauthorized organization.
- No tooltip-only deadlines or icon-only record actions.
- No fabricated production partner, profile, or notification data.
- No decorative badge when plain text communicates the state better.

## Acceptance questions

1. Can a seller state whether they have authority before starting a quote?
2. Can an administrator compare work without opening every record?
3. Are admin-only economics absent — not merely visually hidden — for seller
   roles?
4. Do keyboard focus, 320 px reflow, 200% zoom, and reduced motion preserve the
   ledger’s action order?
5. Does the page remain specifically about channel authority if all product
   nouns are removed?

## Research rationale

The brief applies
[V-1’s substitution test](https://v-1.design/blog/why-ai-built-apps-look-the-same),
[Carbon’s exploration-dashboard guidance](https://carbondesignsystem.com/data-visualization/dashboards/)
for search/sort/drill-down relationships,
[Apple’s agency and responsibility principles](https://developer.apple.com/design/human-interface-guidelines/design-principles)
for authority and safe recovery, and [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
for adaptable structure, focus, targets, contrast, and reflow.
