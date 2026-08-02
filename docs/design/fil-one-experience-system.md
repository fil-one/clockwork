# Fil One experience system

Status: the Fil One wordmark files and the brand palette are integrated. The
remaining `EXT-BRAND-01` inputs are licensed webfont files and their rights,
claims-approved copy, and legal entity and footer content. Human design approval
is a future launch-only input and is not claimed here.

## Product idea

Fil One commerce is a chain of promises: agreement, quote, order, service,
evidence, invoice, and retention outcome. The visual system makes that chain
legible. It uses lines, aligned facts, document-like typography, and restrained
color instead of a floating tile aesthetic. The supplied Fil One marks live in
`apps/web/public/brand/` and render through `BrandLogo`, which falls back to the
text wordmark when a surface passes no asset path. The application shell and the
signing surface use the wordmark; the icon variants are available to surfaces
that need a square mark.

## Typography

- **Interface:** Avenir Next where installed, followed by Inter and platform
  sans-serif. It is compact enough for operations but remains readable at small
  sizes.
- **Document/display:** Iowan Old Style followed by Palatino for a limited set
  of agreement, term, and amount moments. It signals documentary authority; it
  is not used for generic page drama.
- **Technical:** SFMono/Consolas for immutable IDs, hashes, versions,
  timestamps, and trace references.
- Body text never drops below 14 CSS px for core work. Auxiliary text has a 12
  CSS px floor and 1.45 line height. Large headings use a modest 32 CSS px
  maximum in work surfaces.

## Grid and spacing

The base spacing unit is 4 CSS px. Controls are at least 44 CSS px high; compact
dense-table actions retain a 24-by-24 CSS px target with the WCAG 2.5.8 spacing
exception satisfied. Page padding is 16 px at 320, 24 px at 768, and 32–48 px
at 1440. Content follows a 12-column grid on wide screens, 8 columns at 768, and
one reading column at 320. Lines and whitespace express grouping; nested rounded
containers do not.

## Color

The values below are the live tokens in `packages/ui/src/styles.css`.

- The mark's blue (`--cw-brand`, `#0090ff`) fills shapes and draws the mark. It
  never carries text.
- Available primary action uses `--cw-brand-strong` (`#0067cc`) with white text
  and deepens to `--cw-brand-ink` (`#06305c`) on hover. `--cw-brand-ink` is also
  the text-weight blue for links and emphasis, and `--cw-brand-soft` (`#dff1ff`)
  is the tinted background.
- Ink (`#172019`) carries primary content, `--cw-ink-soft` (`#344039`) carries
  secondary content, muted (`#5b675f`) carries supporting content, and faint
  (`#7c867f`) carries annotation.
- Surface (`#ffffff`) sits on canvas (`#f4f6f8`) and canvas-deep (`#e7ebef`).
  Borders are `#e3e7ec`, strengthening to `#7c8794` where a boundary must carry
  meaning.
- Green (`#2d6a49`) marks confirmed success, blue-grey (`#2e6383`) information,
  amber (`#8a5719`) warning, and red (`#9a3434`) failure. Each appears with a
  textual state or icon and never as the only signal.
- Violet (`#7a3df5`) is reserved for the focus ring; it is never repurposed as a
  status.
- Customer, partner, and operator surfaces share one token set and differ
  through composition and structure rather than through per-audience color.

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
