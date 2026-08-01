# Fil One experience system

Status: implemented candidate, pending human design approval and `EXT-BRAND-01`
licensed assets

## Product idea

Fil One commerce is a chain of promises: agreement, quote, order, service,
evidence, invoice, and retention outcome. The visual system makes that chain
legible. It uses lines, aligned facts, document-like typography, and restrained
color instead of a floating tile aesthetic. Licensed marks are not assumed; the
text wordmark remains neutral until `EXT-BRAND-01` is genuinely active.

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

- Evergreen (`#245a40`) marks available primary action and confirmed success.
- Ink (`#172019`) carries primary content; slate (`#5b675f`) carries supporting
  content.
- Paper (`#fffefa`) and canvas (`#f5f3ed`) provide document-like layers.
- Blue (`#075fc5`) is reserved for focus and links; it is never repurposed as a
  status.
- Amber and red always appear with a textual state/icon and never as the only
  signal.
- Customer, partner, and operator accents differ through composition first, then
  restrained tokens: customer evergreen/document; partner ochre/ledger; operator
  graphite/terminal-blue.

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
