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

| Baseline                                                                                                   | SHA-256                                                            | Inspection and intentional change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Customer desktop](../../apps/web/e2e/visual.spec.ts-snapshots/customer-dashboard-chromium-darwin.png)     | `e1aea43ce455a87294960fbf1c2e79ed984fd43faef073df96d37d099b7fa8d6` | Kept one compact task heading; replaced the equal metric/card/chart rail with a numbered obligation list, documentary term, and closed secondary disclosure. Recaptured on the Fil One palette: blue fills carry action, the darker blue carries link text. Recaptured on the shared type scale: nothing sets a size below 12 px, and the rail now groups eleven destinations under Pricing, Legal record, Service, and Organization. Capacity facts state the absence once as an empty panel instead of printing "Not yet available" three times.                                                     |
| [Customer 320](../../apps/web/e2e/visual.spec.ts-snapshots/customer-dashboard-320-chromium-darwin.png)     | `0c82d7588b8c6a031830bd3905dad21ebc00352175c146c8cc4ef14409f7139c` | Confirmed single-column reading order, full labels/actions, no clipped agreement facts, and disclosure after the primary obligations. The supplied wordmark now scales into the compact brand slot instead of clipping. Reconfirmed the single-column order after the type raise. The obligation list, term panel, and closed disclosure keep their sequence and nothing clips.                                                                                                                                                                                                                        |
| [Partner desktop](../../apps/web/e2e/visual.spec.ts-snapshots/partner-agreement-clock-chromium-darwin.png) | `02b66d0889abbb87d0e0e8707c0ccd569eeea6cbe4b39ee53e80de38ab674dae` | Kept agreement authority as the first decision, replaced urgent cards with a named-account ledger, and grouped confidentiality boundaries without a chart rail. Darkened boundary labels after Axe measured 4.09:1. Recaptured with grouped partner wayfinding (Deal flow, Revenue, Channel) and tabular figures on the named-account ledger. Row hover now transitions on colour alone.                                                                                                                                                                                                               |
| [Operator desktop](../../apps/web/e2e/visual.spec.ts-snapshots/operator-priority-work-chromium-darwin.png) | `0bcaf1ee9ef1758410734386da321a933f4311145ce2bda020230b11a865fe73` | Queue workspace over the session-scoped projection: saved views, filters, and a three-record table which omits a fact row it has no value for rather than printing a placeholder. The detail panel names permitted actions and states what review does and does not change. Rail labels return to the sans family: monospace stays on the timestamps, where digits align, and leaves the wayfinding it made harder to scan. Fifteen destinations group under Exception queues, Provider recovery, and Administration, each with a distinct icon, and webhook replay is reachable rather than URL-only. |
| [Quote desktop](../../apps/web/e2e/visual.spec.ts-snapshots/customer-quote-workspace-chromium-darwin.png)  | `81683fc1e868746c92da46e573288734d77affa4662844aff037027386d94a89` | Three-stage quote builder with the promise chain above it. The session account is fixed, the draft-facts rail states what is not yet set, and the notice keeps pricing and availability with the server. Recaptured on the type scale and the tightened container radius. The three-stage builder, promise chain, and draft-facts rail are unchanged in structure.                                                                                                                                                                                                                                     |
| [Quote 320](../../apps/web/e2e/visual.spec.ts-snapshots/customer-quote-workspace-320-chromium-darwin.png)  | `3a938c0d8d8a726ca43aa2f64a5eb551af5b68509dc9ff7ca292ad112ab0b4b2` | Confirmed the stage list, fields, and draft-facts rail reflow into one reading sequence with 44 px native actions and no page-level horizontal overflow. Reconfirmed the reflow after the type raise, with 44 px actions retained and no page-level horizontal overflow.                                                                                                                                                                                                                                                                                                                               |
| [Order desktop](../../apps/web/e2e/visual.spec.ts-snapshots/customer-order-acceptance-chromium-darwin.png) | `e9ea8b92ff0fa01360b9b15011bb44301096121af58d7bbd1d8e6c0ebcb5a2b1` | Accepted quote, current order decision, and resulting commitment stay contiguous, each carrying its source reference and version. Estimated spend is labeled a quote calculation, and the attestation gates the binding action. Recaptured on the type scale. Amounts carry tabular figures so the estimated spend and commitment columns align digit for digit.                                                                                                                                                                                                                                       |
| [Order 320](../../apps/web/e2e/visual.spec.ts-snapshots/customer-order-acceptance-320-chromium-darwin.png) | `d6bb3b1e69e3b3e734dbe424b98f965f4516821ce3c8462935893abc348c6bf1` | Confirmed the acceptance inputs and commitment review reflow as one reading sequence without clipped terms, detached status, or horizontal page overflow. Reconfirmed the acceptance inputs and commitment review as one reading sequence at the raised sizes.                                                                                                                                                                                                                                                                                                                                         |
| [States desktop](../../apps/web/e2e/visual.spec.ts-snapshots/customer-state-gallery-chromium-darwin.png)   | `f95d86d541af6ce0ab5e3ef51c849e0c44105db4ca37637e7fc06bbee8ad8c87` | Eleven reachable states in a two-column grid. Each names its condition and its safe next step; tone dots carry state, and only the empty state takes a filled action. Recaptured on the type scale. Eleven states keep their condition, next step, and tone treatment.                                                                                                                                                                                                                                                                                                                                 |
| [States 320](../../apps/web/e2e/visual.spec.ts-snapshots/customer-state-gallery-320-chromium-darwin.png)   | `e762df2a5d0b16bc493226c44420bb04c49b9f3213291181d4b144c16c5c4121` | Confirmed all eleven states reflow to one column with their actions intact and no horizontal page overflow. Reconfirmed all eleven states reflow to one column with actions intact.                                                                                                                                                                                                                                                                                                                                                                                                                    |

The operator screenshot uses fixtures available only through the explicit
non-production demo adapter. The adapter continues to fail closed in production.

## Demo landing baselines

These regenerate only through `--project=demo-chromium`, which is not in the CI
matrix, so they are recaptured deliberately rather than on a failing build.

| Baseline                                                                                                | SHA-256                                                            | Inspection and intentional change                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Demo landing desktop](../../apps/web/e2e/demo.spec.ts-snapshots/demo-landing-demo-chromium-darwin.png) | `bd308bb5320db1234a7ca1dd155cbd581dd2557af9e91eb5177b79da74242106` | The persona picker was a rounded card grid, which this document's own rubric rejects, on the surface a prospect sees first. It is now a rule-separated roster: one row per persona carrying the mark, name, role, account, first move, and start action. All nine personas and their actions sit above the fold at 1440. |
| [Demo landing 320](../../apps/web/e2e/demo.spec.ts-snapshots/demo-landing-320-demo-chromium-darwin.png) | `a3c3fb7975736975e5bd14f7e35184dd0be76213fd0ba7fdcfa2d10ac8eba5fa` | Confirmed each roster row reflows into one reading sequence with its start action intact and no page-level horizontal overflow.                                                                                                                                                                                          |

The two demo access-gate baselines are unchanged by this pass.

## System conformance

The rubric above says what a surface may contain. These entries record where the
product now enforces it in one place rather than per screen.

- **One type scale.** `--cw-text-xs` through `--cw-text-hero` and four leading
  steps are declared once in `packages/ui/src/styles.css`. Every stylesheet in
  the product resolves through them, and 0.75rem is a floor: the 114
  declarations that sat below it were raised, and crowding was answered with
  letter-spacing, weight, and padding rather than by shrinking back.
- **Two container radii.** `--cw-radius-md`, `lg`, and `xl` are now aliases of
  `--cw-radius-sm`, so 0.375rem is the ceiling. Pills and circles are shape
  marks and keep their own geometry.
- **One table.** The design-system `Table` gained a hidden-caption option and a
  keyboard-reachable scroll region, and fourteen hand-rolled tables now use it.
  The queue workspace and the partner ledger keep bespoke markup, because
  selection styling and a deliberate collapse are behaviours the shared
  component does not carry.
- **A narrow table is wide, not tall.** Below 48rem every cell takes a 9rem
  floor, so a dense operator table scrolls inside its own region rather than
  compressing to roughly 108px a column and wrapping each cell into a tower.
  Without the floor a single gates row reached 798px, which put one record on
  the whole screen; rows now sit near 120px and the page still never overflows
  horizontally.
- **One button class.** `buttonClassName` is exported from a module with no
  client directive, so the anchors, summaries, and form controls that cannot be
  a `<button>` compose the same string the component does.
- **Motion.** Hover and focus transitions run on background, border, and text
  colour at `--cw-motion-fast`, never on transform or shadow, and the
  reduced-motion block neutralises all of it.
- **Rail sections are not headings.** Group labels name a set of links, so they
  carry the section's accessible name instead of entering the document outline
  between the page's own headings.

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
