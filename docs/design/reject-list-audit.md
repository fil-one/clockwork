# Task review and reject-list audit

Status: automated and visual evidence complete; awaiting explicit human design
decision

## Representative task review

| Audience | Representative task                                                       | Expected read order                                                    | Prototype result                                                                                               | Critical/high findings                            |
| -------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Customer | Review agreement, open expiring quote, continue to order/artifact/payment | obligation → consequence/date → record action → term/document evidence | Ranked three-item obligation list, one agreement authority surface, secondary activity disclosed               | None in representative baseline                   |
| Partner  | Confirm agreement authority, select named end client, create resale quote | agreement clock → authority boundary → work ledger → record action     | Agreement clock precedes named-account ledger; pricing and merchant boundaries remain adjacent                 | None after the boundary-label contrast correction |
| Operator | Triage exception/recovery and verify evidence before action               | freshness/risk queue → owner/task → version-bound action → evidence    | Three record semantic work table with stale-state label, immutable record keys, actions, and evidence controls | None in representative baseline                   |

## Element audit rubric

Every changed baseline is reviewed using the following disposition codes.

- **Keep — relationship:** communicates sequence, grouping, comparison, or
  containment that is otherwise difficult to understand.
- **Keep — state:** makes availability, progress, freshness, risk, or outcome
  perceivable in text and visually.
- **Keep — action:** identifies a record-bound action and its consequence.
- **Remove — template:** interchangeable hero, equal KPI row, card grid, generic
  chart rail, or decoration.
- **Remove — repetition:** copy or chrome that restates visible content.

| Element             | Customer                  | Partner                    | Operator                      | Disposition/rationale                                                                                        |
| ------------------- | ------------------------- | -------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Oversized hero      | remove                    | remove                     | remove                        | Remove — template; replace with compact task heading.                                                        |
| All-caps eyebrow    | remove from page headings | remove from page headings  | remove                        | Remove — repetition; retain short semantic labels only where they classify a record.                         |
| Four equal metrics  | remove                    | remove                     | remove                        | Remove — template; promote only decision-changing values or queue filters.                                   |
| Rounded card grid   | remove                    | remove                     | remove                        | Remove — template; use lists, ledgers, tables, and disclosure.                                               |
| Chart/activity rail | remove                    | remove                     | remove by default             | Remove — template; allow a chart only when a trend changes the decision and provide a text/table equivalent. |
| Status badge        | only binding state        | protection/authority state | severity/effective state      | Keep — state only when paired with text and not used decoratively.                                           |
| Radius/shadow       | controls/disclosure only  | controls/disclosure only   | modal only                    | Keep — relationship; no nested floating surfaces.                                                            |
| Explanatory copy    | consequence/help only     | boundary/evidence only     | policy/downstream effect only | Keep — action; otherwise remove repetition.                                                                  |

## Automated evidence completed

- Axe WCAG 2 A/AA, 2.1 A/AA, and 2.2 AA tags: zero violations on all three
  representative surfaces at 320, 768, and 1440 CSS pixels.
- Reflow: zero page-level horizontal overflow at 320 × 800, 768 × 1024, and 1440
  × 1000.
- Zoom equivalence: the 1280-pixel reference viewport was exercised at 640 CSS
  pixels (200%) and 320 CSS pixels (400%) with primary content retained and no
  page-level horizontal overflow.
- WCAG 1.4.12 text spacing: 1.5 line height, 0.12em letter spacing, 0.16em word
  spacing, and two-em paragraph separation at 320 pixels produced no overlap,
  content loss, or page-level overflow.
- Reduced motion: no running repeated/nonessential animation remained under
  `prefers-reduced-motion: reduce`.
- Keyboard: the skip link is in the sequential focus order, receives visible
  three-pixel focus, and all representative task actions remain native controls.
- Result: 10/10 Playwright approval assertions passed in 12.3 seconds, zero
  retries.

Full command and outcome detail is checked in at
[evidence/accessibility-report.md](evidence/accessibility-report.md).

## Inspected visual baselines

| Baseline                                                                                                   | SHA-256                                                            | Inspection and intentional change                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Customer desktop](../../apps/web/e2e/visual.spec.ts-snapshots/customer-dashboard-chromium-darwin.png)     | `c72779667fefd4eb58549c5d0d5fd286b531245d5cd942f6253ce9ead86ea324` | Kept one compact task heading; replaced the equal metric/card/chart rail with a numbered obligation list, documentary term, and closed secondary disclosure.                                                            |
| [Customer 320](../../apps/web/e2e/visual.spec.ts-snapshots/customer-dashboard-320-chromium-darwin.png)     | `7758a9e23ff5c898ca28c25974170c6ca726a49e1c8e5f9049f1b3401b88537d` | Confirmed single-column reading order, full labels/actions, no clipped agreement facts, and disclosure after the primary obligations.                                                                                   |
| [Partner desktop](../../apps/web/e2e/visual.spec.ts-snapshots/partner-agreement-clock-chromium-darwin.png) | `6fc954460d4a5cdf63018532d4351c2a41c5029572dda37fe4f9d238b2797e6a` | Kept agreement authority as the first decision, replaced urgent cards with a named-account ledger, and grouped confidentiality boundaries without a chart rail. Darkened boundary labels after Axe measured 4.09:1.     |
| [Operator desktop](../../apps/web/e2e/visual.spec.ts-snapshots/operator-priority-work-chromium-darwin.png) | `bf7b7037bbaa88cd7fecdef7c1e5aea95b62cb23b34d4c15ba29141655608367` | Rejected the empty raw projection baseline; replaced it with a semantic three-record queue showing freshness, status/risk, immutable record keys, named ownership, next task, version-bound action, and evidence input. |

The operator screenshot uses fixtures available only through the explicit
non-production demo adapter. The adapter continues to fail closed in production.

## Reject-list source audit

- No production JSX renders the legacy `stat-grid` class.
- The only `repeat(4, …)` match in operator queue CSS is one search field plus
  four filter controls, not an equal-metric row.
- Customer usage/activity and generic trend charts are progressively disclosed
  and retain a semantic table equivalent; no representative landing surface
  leads with a chart rail.
- Uppercase treatment is restricted to brand marks, compact record classifiers,
  and status semantics rather than repeated page-heading eyebrows.
- The quote/order commercial forms retain their lane-owned form styling. They
  were not used as approval baselines and are tracked as a cross-lane visual
  follow-up rather than silently claimed as redesigned here.

No approval is recorded here. The separate approval record must be created only
after an approver explicitly approves the supplied evidence.
