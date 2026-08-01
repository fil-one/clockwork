# Operator experience brief

Status: repository-qualified implementation; any human design approval is a
future launch-only decision and is not claimed here

## Decision frame

- **User:** an internal operations, finance, legal, or reliability specialist
  with a scoped role and a queue of consequential work.
- **Moment:** the operator is triaging an exception, recovery, external gate, or
  aged workflow under time and audit pressure.
- **Decision:** which case is at risk now, what evidence supports a decision,
  and which action is permitted for my role and authentication age?
- **Primary task:** choose the highest-consequence queue item, inspect its
  evidence/version/audit chain, and perform or route exactly one recoverable
  action.
- **Density:** high but disciplined. A semantic queue table is primary, summary
  counts are inline filters, and evidence opens progressively beside or below
  the selected row.
- **Voice:** terse, operational, and audit-ready. It uses identifiers, owners,
  timestamps, version numbers, block reasons, and explicit downstream effects.

## Composition

The operator home is a triage board rather than a presentation dashboard. The
queue is the dominant structure. Severity, age, owner, and next safe action
share a row so comparison does not require scanning a card grid. Counts behave
as filters, not decoration. Charts appear only where a time series changes an
operational decision and always have a table/list equivalent.

At 320 CSS px the table uses a named, keyboard-focusable two-dimensional region
because comparison is essential; the page outside that region never scrolls
horizontally. A selected case exposes evidence in document order. Destructive or
privileged actions show authority, consequence, and recovery/confirmation before
invocation.

## Reject list

- No oversized hero, welcome message, or decorative eyebrow.
- No four-metric strip detached from queue filters.
- No rounded card grid for queue records.
- No chart/activity rail as default composition.
- No “green means good” or unlabeled severity.
- No hard-coded operator identity, actor, or inactive assisted-session banner.
- No configured external gate represented as active without current passing
  evidence.
- No action without immutable actor, target, version, reason, and
  audit/readback.

## Acceptance questions

1. Can an operator find the oldest launch blocker using headings and table
   semantics alone?
2. Are blocked, pending, configured, tested, and effective gate states textually
   distinct?
3. Does each permitted action identify the target/version and each denied action
   explain the missing authority?
4. At 400% reflow, is horizontal scrolling limited to genuinely two-dimensional
   comparison regions?
5. With reduced motion, do progress and optimistic states remain understandable
   without animation?

## Research rationale

The brief rejects category-level dashboards using
[V-1’s substitution test](https://v-1.design/blog/why-ai-built-apps-look-the-same),
follows
[Carbon’s hierarchy, metric-limiting, and exploration guidance](https://carbondesignsystem.com/data-visualization/dashboards/),
applies
[Apple’s purpose, responsibility, simplicity, and craft principles](https://developer.apple.com/design/human-interface-guidelines/design-principles),
and treats [WCAG 2.2](https://www.w3.org/TR/WCAG22/) AA criteria as testable
release requirements.
