# Task review and reject-list audit

Status: repository-qualified automated and visual evidence; any explicit human
design decision is future launch-only, nonblocking for consolidation, and not
claimed here

## Representative task review

| Audience | Representative task                                                       | Expected read order                                                    | Prototype result                                                                                               | Critical/high findings                            |
| -------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Customer | Review agreement, open expiring quote, continue to order/artifact/payment | obligation → consequence/date → record action → term/document evidence | Ranked obligation list plus quote/order promise chains and version-bound commercial decision ledgers           | None in representative baseline                   |
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
- Quote/order follow-up: the authoritative `/quotes/new` and `/orders/accept`
  routes were added to the baseline at 1440 and 320 CSS pixels and to the Axe
  plus reflow matrix at 320, 768, and 1440 CSS pixels.
- Result: 17/17 Playwright visual, Axe, reflow, zoom-equivalence, text-spacing,
  reduced-motion, and keyboard assertions passed in 11.1 seconds, zero retries.
- Focused semantics: 9/9 component tests passed. They assert actionable-quote
  ordering, decision-only commercial facts, complete generic-projection
  preservation, quote/order promise-chain order, semantic field grouping,
  first-invalid-field focus, and announced confirmation errors.
- Customer/partner regression: 16/16 journeys passed in 23.7 seconds, including
  the quote optimistic-version action, persisted order review, generic
  projection routes, and overflow checks from 320 through 1440 CSS pixels.

The original three-surface command detail is checked in at
[evidence/accessibility-report.md](evidence/accessibility-report.md); the
quote/order follow-up commands, counts, timings, and hashes are recorded here.

## Inspected visual baselines

| Baseline                                                                                                   | SHA-256                                                            | Inspection and intentional change                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Customer desktop](../../apps/web/e2e/visual.spec.ts-snapshots/customer-dashboard-chromium-darwin.png)     | `c72779667fefd4eb58549c5d0d5fd286b531245d5cd942f6253ce9ead86ea324` | Kept one compact task heading; replaced the equal metric/card/chart rail with a numbered obligation list, documentary term, and closed secondary disclosure.                                                                                                    |
| [Customer 320](../../apps/web/e2e/visual.spec.ts-snapshots/customer-dashboard-320-chromium-darwin.png)     | `7758a9e23ff5c898ca28c25974170c6ca726a49e1c8e5f9049f1b3401b88537d` | Confirmed single-column reading order, full labels/actions, no clipped agreement facts, and disclosure after the primary obligations.                                                                                                                           |
| [Partner desktop](../../apps/web/e2e/visual.spec.ts-snapshots/partner-agreement-clock-chromium-darwin.png) | `6fc954460d4a5cdf63018532d4351c2a41c5029572dda37fe4f9d238b2797e6a` | Kept agreement authority as the first decision, replaced urgent cards with a named-account ledger, and grouped confidentiality boundaries without a chart rail. Darkened boundary labels after Axe measured 4.09:1.                                             |
| [Operator desktop](../../apps/web/e2e/visual.spec.ts-snapshots/operator-priority-work-chromium-darwin.png) | `daf91dc7083c15a25b29796004cf7c9ee745dd292d51a3685ee73bcc922dcb75` | Rejected the empty raw projection baseline; retained the semantic three-record queue and accepted the 22 px page-height increase caused by 42 px minimum action targets. Inspection confirmed unchanged hierarchy, density, evidence controls, and no overflow. |
| [Quote desktop](../../apps/web/e2e/visual.spec.ts-snapshots/customer-quote-workspace-chromium-darwin.png)  | `e66f511ebab666d591854b7042f1c0d9ba0be38e2d0fbbfa144a7d94c9d2aa65` | Rejected the raw scalar stream. The accepted baseline orders actionable quotes first, keeps reference/version attached, limits the primary ledger to decision-changing facts, and progressively discloses immutable projection evidence.                        |
| [Quote 320](../../apps/web/e2e/visual.spec.ts-snapshots/customer-quote-workspace-320-chromium-darwin.png)  | `4abf673a2231635bd0b243ae85943618eb09d835c9985348a114953e73f7c6eb` | Confirmed agreement → quote → order order, full reference/version/action context, 44 px native actions, single-column fact reflow, and no page-level horizontal overflow.                                                                                       |
| [Order desktop](../../apps/web/e2e/visual.spec.ts-snapshots/customer-order-acceptance-chromium-darwin.png) | `f84702d7ed9369b0b8eeb35023d48afdb5611253ec746b4d94b73706209eef2a` | Kept accepted quote, current order decision, and resulting provisioning truth contiguous; both persisted commitments retain source version, term, timing, ownership, next step, and evidence disclosure.                                                        |
| [Order 320](../../apps/web/e2e/visual.spec.ts-snapshots/customer-order-acceptance-320-chromium-darwin.png) | `e5db44b72ec0ec5436710a4efcd4bea4bda1e1dc0b08a03ab2039ff581888e6b` | Confirmed the two-record ledger reflows as one reading sequence without clipped terms, detached status, hidden read-only state, or horizontal page overflow.                                                                                                    |

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
- The authoritative quote/order routes render the shared projection detail
  surface. Its commercial variant now suppresses duplicated raw scalars from the
  primary hierarchy, preserves every generic scalar on non-commercial routes,
  sorts actionable quotes first, and binds visible actions to the displayed
  record and optimistic version.
- The retained quote/order form components no longer use a repeated uppercase
  page eyebrow or rounded-card composition. They expose a product-specific
  agreement → quote → order promise chain, semantic field groups, documentary
  ledger edges, and announced validation/focus behavior.
- P0-34 has no remaining repository-controlled design follow-up. Explicit human
  approval and licensed brand assets remain separate external decisions and are
  not claimed by this audit.

No approval is recorded here. The separate approval record must be created only
after an approver explicitly approves the supplied evidence.
