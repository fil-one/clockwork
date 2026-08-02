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

| Baseline                                                                                                   | SHA-256                                                            | Inspection and intentional change                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Customer desktop](../../apps/web/e2e/visual.spec.ts-snapshots/customer-dashboard-chromium-darwin.png)     | `ddb7d3f41de1f3c97729ddb5e1904381b14e4f80c7fc08eeca1310db9629424d` | Kept one compact task heading; replaced the equal metric/card/chart rail with a numbered obligation list, documentary term, and closed secondary disclosure. Recaptured on the Fil One palette: blue fills carry action, the darker blue carries link text. |
| [Customer 320](../../apps/web/e2e/visual.spec.ts-snapshots/customer-dashboard-320-chromium-darwin.png)     | `f6a87769ed44e8ad07803d1941fdb1e7eae9cbee4b240286020f330d8868bb2a` | Confirmed single-column reading order, full labels/actions, no clipped agreement facts, and disclosure after the primary obligations. The supplied wordmark now scales into the compact brand slot instead of clipping.                                     |
| [Partner desktop](../../apps/web/e2e/visual.spec.ts-snapshots/partner-agreement-clock-chromium-darwin.png) | `6a919230351fd05e9e009dfe7677ed37c088d9ba258917dafb9cd8bf257c2c39` | Kept agreement authority as the first decision, replaced urgent cards with a named-account ledger, and grouped confidentiality boundaries without a chart rail. Darkened boundary labels after Axe measured 4.09:1.                                         |
| [Operator desktop](../../apps/web/e2e/visual.spec.ts-snapshots/operator-priority-work-chromium-darwin.png) | `ee7981fb1779d22bea208ae86e7c167e75ad156d41f704532072d2deff8c65a9` | Queue workspace over the session-scoped projection: saved views, filters, and a three-record table whose unrecorded risk, age, and backup read "Not supplied". The detail panel names permitted actions and states that review submits no mutation.         |
| [Quote desktop](../../apps/web/e2e/visual.spec.ts-snapshots/customer-quote-workspace-chromium-darwin.png)  | `2d0bec9f97311c5ce5f4b7a68e878b4012ef5358d53427a1a17b3c2e3ee7f614` | Three-stage quote builder with the promise chain above it. The session account is fixed, the draft-facts rail states what is not yet set, and the notice keeps pricing and availability with the server.                                                    |
| [Quote 320](../../apps/web/e2e/visual.spec.ts-snapshots/customer-quote-workspace-320-chromium-darwin.png)  | `7d383dd9c3111b08fd726f999d53ab61ebf505e131e3cb9d657aae9101ae7c72` | Confirmed the stage list, fields, and draft-facts rail reflow into one reading sequence with 44 px native actions and no page-level horizontal overflow.                                                                                                    |
| [Order desktop](../../apps/web/e2e/visual.spec.ts-snapshots/customer-order-acceptance-chromium-darwin.png) | `3b0c1cbfdd2d0bb79dcc84aef7e6641189a5d3833d808e6238f6959746286cfc` | Accepted quote, current order decision, and resulting commitment stay contiguous, each carrying its source reference and version. Estimated spend is labeled a quote calculation, and the attestation gates the binding action.                             |
| [Order 320](../../apps/web/e2e/visual.spec.ts-snapshots/customer-order-acceptance-320-chromium-darwin.png) | `88f2e956d4b8f80013aa9870b1e67715c11d054105befd0dba953cf2721f0a39` | Confirmed the acceptance inputs and commitment review reflow as one reading sequence without clipped terms, detached status, or horizontal page overflow.                                                                                                   |
| [States desktop](../../apps/web/e2e/visual.spec.ts-snapshots/customer-state-gallery-chromium-darwin.png)   | `05b729cbf60db283fb28c3ab37c3f4eda4d15bf3a60e9b8751f76e26a7c461dc` | Eleven reachable states in a two-column grid. Each names its condition and its safe next step; tone dots carry state, and only the empty state takes a filled action.                                                                                       |
| [States 320](../../apps/web/e2e/visual.spec.ts-snapshots/customer-state-gallery-320-chromium-darwin.png)   | `f8bf036872b5c3ea32e3d4d8038885240c2d2572d992825e9f1d72a602ef76b0` | Confirmed all eleven states reflow to one column with their actions intact and no horizontal page overflow.                                                                                                                                                 |

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
