# Fil One experience system

Status: the Fil One wordmark files, the brand palette, and the product typeface
are integrated. The remaining `EXT-BRAND-01` inputs are claims-approved copy,
legal entity and footer content, and vector versions of the marks. Human design
approval is a future launch-only input and is not claimed here.

## Product idea

Fil One commerce is a chain of promises: agreement, quote, order, service,
evidence, invoice, and retention outcome. The visual system makes that chain
legible, and it does so in the visual language of the Fil One console
(app.fil.one), so that commerce reads as part of the same product family as
storage. That means a near-white canvas, white cards with hairline borders,
plain semibold titles, small uppercase section labels, compact lists and tables,
and one blue for action. The supplied Fil One marks live in
`apps/web/public/brand/`, are addressed through `brandAsset()`, and render
through `BrandLogo`, which falls back to a text wordmark set in Inter when a
surface passes no asset path. The application shell and the signing surface use
the wordmark; the icon variants are available to surfaces that need a square
mark.

## Typography

One family, Inter, as in the console. The variable `wght` files for the Latin
and extended-Latin subsets (SIL OFL 1.1, from `@fontsource-variable/inter`) are
served from `apps/web/app/fonts/` and declared once in `apps/web/app/fonts.ts`;
the extended subset downloads only when a page contains a character that needs
it. `packages/ui` ships no font bytes. The retired marketing faces (Aspekta,
Funnel Sans, Funnel Display) are no longer in the product.

- **Sans (`--cw-font-sans`):** Inter, followed by the platform stack.
  `--cw-font-display` and `--cw-font-accent` survive as names and resolve to the
  same stack, so size and weight carry hierarchy rather than a second face.
- **Technical (`--cw-font-mono`):** `ui-monospace`, SF Mono, Menlo, Consolas.
  Code, endpoints, keys, hashes, and opaque technical identifiers only. Dates,
  amounts, counts, statuses, and record titles are set in Inter with tabular
  figures. Menlo is on every Mac, so the stack never falls through to the
  generic `monospace`, which Chrome and Safari draw as Courier on macOS.
- **Per-language stacks:** Latin runs stay in Inter in every language; the
  script's own face follows it. Japanese uses Hiragino Sans, Noto Sans JP, or Yu
  Gothic UI; Simplified Chinese uses PingFang SC, Microsoft YaHei, or Noto Sans
  SC. Arabic leads with a `local()` alias over Geeza Pro, Segoe UI, or Noto Sans
  Arabic that is limited to the Arabic blocks and scaled 110%, because the
  metric-matched Inter fallback is a local Arial, which has Arabic glyphs and
  would otherwise draw them.
- **Case and tracking:** section labels are uppercase and tracked 0.05em through
  `--cw-label-transform` and `--cw-label-tracking`. For Japanese, Chinese, and
  Arabic both switch off, and letter-spacing and text-transform are disabled for
  every element, because uppercase has no meaning in those scripts and tracking
  breaks Arabic joining.
- **Line breaking:** Japanese breaks at phrase boundaries
  (`word-break: auto-phrase` where supported) with strict kinsoku; Chinese uses
  strict kinsoku; Japanese, Chinese, and Arabic body text take 1.7 leading.
  German, French, Portuguese, and Spanish running text and table cells
  hyphenate; buttons, badges, headings, and figures do not.

The scale is the console's: 12, 13, 14, 16, 18, and 20 px, with page titles at
24 px semibold and normal tracking and a one-line 14 px muted description. Body
copy is 14 px. Weights are 400 for body, 500 for labels, links, buttons, and
navigation, and 600 for headings and key figures. 12 px is the floor.

## Grid and spacing

The base spacing unit is 4 CSS px. Controls are 36 CSS px high with a mouse, as
in the console; under `@media (pointer: coarse)` every control, navigation row,
command result, and combobox option returns to at least 44 CSS px, so touch
targets meet the 44 px target this document has always promised. Compact
dense-table actions retain a 24-by-24 CSS px target with the WCAG 2.5.8 spacing
exception satisfied. Page padding is 16 px at 320, 24 px at 768, and 40 px
at 1440. Content follows a 12-column grid on wide screens, 8 columns at 768, and
one reading column at 320. Cards group content; lines inside a card divide it;
cards do not nest.

## Color

Every token lives in the `:root` block of `packages/ui/src/styles.css`. The
contrast budget is not typed into comments any more:
`packages/ui/src/contrast.test.ts` reads that block, resolves each token, and
asserts WCAG 2.2 contrast for every text/background pair the product relies on
(4.5:1) and every control boundary, focus ring, and meaningful mark (3:1). A
token change that breaks a pair fails the unit suite.

- **Neutrals** are the console's zinc ramp: ink `#09090b`, ink-soft `#3f3f46`
  for secondary text and table cells, muted `#52525b` for descriptions and
  labels, and faint `#6c6c75` for annotation. Faint is a step darker than
  zinc-500 so it also clears AA on canvas-deep. The canvas is `#fafafa`,
  canvas-deep `#f4f4f5`, and surfaces are white.
- **Hairlines** are zinc-950 at 10%, as in the console. They group and divide;
  they never identify a control alone. A boundary that identifies a text field,
  select, or checkbox uses `--cw-border-strong` (`#8a8a92`), which clears 3:1 on
  every surface.
- **Action blue** (`#2563eb`, strong `#1d4ed8`, soft `#eff6ff`) carries links,
  primary buttons, the focus ring, the active navigation item, selection, and
  meter fills. The historical `--cw-brand-strong`, `--cw-brand-soft`, and
  `--cw-brand-ink` names point at it, so modules follow without edits.
- **Filecoin Blue**, `--cw-blue-50` through `--cw-blue-950`, draws the mark
  (`--cw-brand`, ramp 700) and the charts (ramp 900 lines, ramp 50 areas). Steps
  are used, not interpolated, and the ramp never carries interface text.
- **Status** follows the console: green (`#15803d`) for a confirmed outcome,
  amber for attention (`#92400e` text on `#fffbeb`, `#d06f05` for dots and
  stripes), and red (`#b91c1c`) for failure. Each appears with a textual state
  and never as the only signal. Information uses the action blue's deepest step
  on its wash. Brand blue stays on progress and completion: steppers, timelines,
  term bars, capacity meters, and risk indicators report how far along something
  is rather than that it succeeded.
- **One blue for every audience.** Customer, partner, and operator surfaces use
  the same action blue; composition and density tell them apart.

## Shape, icon, and motion

Radii are the console's three: 0.25rem for small marks such as a kbd or a chip
inside a control, 0.375rem for buttons and fields, and 0.5rem for cards, tables,
dialogs, popovers, and notices. 0.5rem is the ceiling for containers; pills and
avatars are shape marks and are round. Cards take the console's barely-there
shadow (`0 1px 2px` at 3%); popovers and dialogs take a real one. Tinted status
panels use a wash and a matching hairline rather than a heavy colored stripe.
Lucide icons use a consistent 1.8 stroke at 16 px, supplement text, and are
`aria-hidden` unless the icon itself is the labelled control. A directional
arrow in a link mirrors in right-to-left layouts.

Motion communicates origin or completion only. The standard duration is 140–180
ms with a non-bouncy easing curve. `prefers-reduced-motion: reduce` removes
translation, smooth scrolling, and indefinite spinners; busy state remains
visible as text or a static mark.

## Audience compositions

| Audience | Primary structure                        | Secondary structure                    | Visual voice                   |
| -------- | ---------------------------------------- | -------------------------------------- | ------------------------------ |
| Customer | dated obligation list                    | agreement term and document disclosure | calm, documentary              |
| Partner  | authority clock and named-account ledger | role-scoped economics                  | commercial, relationship-dense |
| Operator | severity/age queue table                 | selected evidence and audit chain      | compact, explicit, operational |

## Research baseline

Implementation decisions were checked against
[V-1 generic-interface research](https://v-1.design/blog/why-ai-built-apps-look-the-same),
[IBM Carbon dashboard guidance](https://carbondesignsystem.com/data-visualization/dashboards/),
[Apple design principles](https://developer.apple.com/design/human-interface-guidelines/design-principles),
and [WCAG 2.2](https://www.w3.org/TR/WCAG22/). These sources constrain hierarchy
and acceptance criteria; they are not used as a visual skin.
