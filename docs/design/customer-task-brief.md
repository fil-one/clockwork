# Customer experience brief

Status: implemented prototype, pending human design approval

## Decision frame

- **User:** an account owner or buyer who is responsible for an active Fil One
  service but does not live in a storage administration console.
- **Moment:** the user has returned because a commercial deadline, payment, or
  service transition needs attention.
- **Decision:** what must I act on now, what will happen if I wait, and which
  source document proves the terms?
- **Primary task:** review the next binding obligation and continue the
  agreement → quote → order → document/payment chain without losing the selected
  account.
- **Density:** calm and selective. One ranked obligation queue, one
  commercial-term strip, and progressive disclosure for supporting service and
  activity facts.
- **Voice:** direct, reassuring, date-specific, and free of internal workflow
  jargon. Action labels use verbs and consequences are explicit.

## Composition

The customer home is a reading-and-decision surface, not a generic analytics
dashboard. The primary axis is time: obligations are ordered by due date and
consequence. Agreement facts remain visually contiguous, because splitting
dates, governing terms, and renewal behavior into unrelated cards obscures their
relationship. Usage is supporting context and never competes with a payment or
expiration decision.

At narrow widths the order remains: page purpose, available primary action,
obligation list, term facts, then secondary disclosure. Tables that need
two-dimensional comparison use a labelled scroll region; ordinary content
reflows without horizontal page scrolling.

## Reject list

- No oversized marketing hero or all-caps workspace eyebrow.
- No row of four equal metrics.
- No decorative chart/activity rail.
- No rounded-card mosaic or cards that could be moved to a CRM unchanged.
- No status conveyed only by color.
- No fictional notifications, profile, or organization options in production.
- No action without a record, version, outcome, and recovery path.
- No explanatory copy that merely restates a heading.

## Acceptance questions

1. Can a keyboard-only user identify and open the most urgent obligation first?
2. At 320 CSS px and 400% reflow, are the obligation, consequence, due date, and
   action preserved without two-dimensional page scrolling?
3. At 200% text zoom and WCAG text-spacing overrides, does every control remain
   operable and every label remain visible?
4. Does a stale or failed action retain the record context and provide a
   retry/readback path?
5. Does the noun-substitution test fail — that is, would replacing “quote” with
   “lead” make the hierarchy nonsensical?

## Research rationale

The brief applies
[V-1’s substitution test](https://v-1.design/blog/why-ai-built-apps-look-the-same)
to force product-specific hierarchy,
[Carbon dashboard guidance](https://carbondesignsystem.com/data-visualization/dashboards/)
to rank information and limit metrics,
[Apple’s purpose, agency, simplicity, and craft principles](https://developer.apple.com/design/human-interface-guidelines/design-principles)
to keep the task and recovery path central, and
[WCAG 2.2](https://www.w3.org/TR/WCAG22/) as the AA interaction and reflow
baseline.
