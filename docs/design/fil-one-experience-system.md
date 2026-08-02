# Fil One experience system

Status: the Fil One wordmark files, the brand palette, and the three brand
typefaces are integrated. The remaining `EXT-BRAND-01` inputs are
claims-approved copy, legal entity and footer content, and vector versions of
the marks. Human design approval is a future launch-only input and is not
claimed here.

## Product idea

Fil One commerce is a chain of promises: agreement, quote, order, service,
evidence, invoice, and retention outcome. The visual system makes that chain
legible. It uses lines, aligned facts, a restrained type hierarchy, and
restrained color instead of a floating tile aesthetic. The supplied Fil One
marks live in `apps/web/public/brand/`, are addressed through `brandAsset()`,
and render through `BrandLogo`, which falls back to a text wordmark set in
Aspekta when a surface passes no asset path. The application shell and the
signing surface use the wordmark; the icon variants are available to surfaces
that need a square mark.

## Typography

Three brand families, all SIL OFL 1.1 and served from `apps/web/app/fonts/`, are
declared once in `apps/web/app/fonts.ts` and reach the component layer as CSS
variables. `packages/ui` ships no font bytes.

- **Body (`--cw-font-sans`):** Funnel Sans. Reading copy, controls, table cells,
  and descriptions. Compact enough for operations and readable at small sizes.
- **Display (`--cw-font-display`):** Aspekta. Headings, the wordmark, and
  displayed amounts. It carries the whole heading cascade, because size and
  weight already separate the levels and a third family in the same field adds
  no hierarchy.
- **Accent (`--cw-font-accent`):** Funnel Display. Eyebrows, field labels, table
  column headers, and annotations. These labels introduce and caption each
  block, which is the sub-header role in a layout built from lines and ledgers.
- **Technical (`--cw-font-mono`):** SFMono/Consolas for immutable IDs, hashes,
  versions, timestamps, and trace references.

All three brand faces carry a weight axis, so numeric weights are live positions
rather than a request the browser rounds to regular or bold. Weight is expressed
on a five-step scale: 400 for body, 500 for emphasized body, 600 for headings
and stat values, 700 for strong labels and buttons, 800 for the wordmark
emphasis and the strongest label on a surface. 800 is the ceiling; the Funnel
axis ends there.

Body text never drops below 14 CSS px for core work. Auxiliary text targets a 12
CSS px floor and 1.45 line height, which a set of dense operator labels does not
yet meet.

## Grid and spacing

The base spacing unit is 4 CSS px. Controls are at least 44 CSS px high; compact
dense-table actions retain a 24-by-24 CSS px target with the WCAG 2.5.8 spacing
exception satisfied. Page padding is 16 px at 320, 24 px at 768, and 32–48 px
at 1440. Content follows a 12-column grid on wide screens, 8 columns at 768, and
one reading column at 320. Lines and whitespace express grouping; nested rounded
containers do not.

## Color

The blue is the Filecoin Blue ramp, published as `--cw-blue-50` through
`--cw-blue-950` in `packages/ui/src/styles.css`. Steps are used, not
interpolated.

Three steps reach 4.5:1 against white: 800 (`#086dc5`) at 5.24, 900 (`#0d5d9b`)
at 6.87, and 950 (`#0e385d`) at 12.05. Those three are the entire budget for
text and for a white label on a fill. That is why the rule below is arithmetic
rather than preference.

- The mark's blue (`--cw-brand`, ramp 700, `#0090ff`) fills shapes and draws the
  mark. It never carries text. It measures 3.26:1 on surface and 2.74:1 on
  canvas-deep, so it cannot fill a meter on the deeper canvas either.
- Available primary action uses `--cw-brand-strong` (ramp 900) with white text
  at 6.87:1 and deepens to `--cw-brand-ink` (ramp 950) on hover.
  `--cw-brand-strong` is also the text-weight blue for links, emphasis, and
  meter fills, and `--cw-brand-soft` (ramp 100, `#d6f5ff`) is the one blue wash.
- Ink (`#151f27`) carries primary content, `--cw-ink-soft` (`#2f3f4a`) carries
  secondary content, muted (`#465661`) carries supporting content, and faint
  (`#596a76`) carries annotation. All four clear 4.5:1 on surface, canvas, and
  canvas-deep alike, so annotation stays legible wherever it lands.
- Surface (`#ffffff`) sits on canvas (`#f4f7f9`) and canvas-deep (`#e5ecf1`).
  Borders are `#dde5eb`, strengthening to `#6b7c89` where a boundary must carry
  meaning. The neutrals are cooled to sit with the ramp.
- Green (`#2b6856`) marks confirmed success, amber (`#8a5719`) warning, and red
  (`#9a333e`) failure. Each appears with a textual state or icon and never as
  the only signal. Amber text on the amber wash uses `--cw-warning-ink`, and an
  amber dot or stripe uses `--cw-warning-mark`, because the base amber misses
  the 3:1 boundary minimum against its own wash.
- Green announces a confirmed outcome. Brand blue stays on progress and
  completion: steppers, timelines, term bars, capacity meters, and risk
  indicators report how far along something is rather than that it succeeded.
- Information speaks in the brand's blue: `--cw-info` is ramp 950 on the ramp
  100 wash. A washed panel and a filled control are told apart by form, which is
  the distinction the shape rules already draw, so the hue is free to be the
  brand's.
- Violet (`#7a3df5`) is reserved for the focus ring; it is never repurposed as a
  status. It clears 3:1 on every surface and every wash it can land on.
- Customer, partner, and operator surfaces share one ramp and take different
  steps of it: 900 for customer, 800 for partner, 950 for operator, each with
  its own wash. The step is a quiet marker. Composition and structure remain the
  primary difference between the three.

Contrast evidence is automated with Axe and browser checks. Token pairs target
at least 4.5:1 for ordinary text and 3:1 for large text/non-text boundaries.

## Shape, icon, and motion

Radii are 4 px for controls, 6 px for bounded disclosure, and 0–2 px for
ledger/table structure. Shadows are limited to modal layers that must separate
from obscured content. Lucide icons use a consistent 1.8 stroke, supplement
text, and are `aria-hidden` unless the icon itself is the labelled control.

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
