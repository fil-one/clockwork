# Design shell handoff

Current disposition: historical provenance. The shell is integrated and
repository-qualified on `main`; this is not an active lane or RC/launch record.

## Outcome

`@clockwork/ui` is the structural source of truth for the Fil One application
shell. The web adapter supplies Next.js routing, active-route matching,
audience-scoped commands and records, session/connectivity state, organization
switching, and demo controls. The result keeps the Filecoin Blue ramp on a cool
neutral family, editorial display type, dense record presentation, and term-bar
identity while making hierarchy and navigation adaptive.

## Adaptive shell contract

| Range           | Navigation                                                            | Header behavior                                                                    |
| --------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 64rem and wider | Persistent full rail                                                  | Full wordmark, organization control, and utilities                                 |
| 48rem–63.999rem | Persistent compact icon rail with accessible names and title tooltips | Centered compact wordmark; dense organization and utility controls                 |
| Below 48rem     | Modal navigation drawer                                               | Two-row header with organization control; redundant demo badge moves to the footer |
| 320px           | Same modal drawer; all destinations remain in the drawer              | Icon-first utilities, no horizontal page overflow                                  |

The mobile drawer is implemented with Radix Dialog. It traps focus, blocks
background interaction, closes on Escape and route selection, restores focus to
the trigger, and retains `aria-current="page"` in its navigation. The web
adapter routes ordinary clicks through `onNavigate` while preserving native
modified-click behavior; `renderNavigationItem` remains available when another
framework link component is required.

## Public APIs

All components and their prop types are exported from `@clockwork/ui`.

| API                          | Purpose and important props                                                                                                                                                                                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AppShell`                   | Shared header/rail/drawer/main/footer structure. Slots: `brand`, `organization`, `utilities`, `banner`, and `footer`. Routing hooks: `renderNavigationItem` and `onNavigate`. Existing page landmarks can use `contentElement="div"` with `contentOwnsTarget={false}`. |
| `Navigation`                 | Grouped destinations with icons, badges, disabled/current states, comfortable or compact density, and product-owned link rendering.                                                                                                                                    |
| `ResponsiveNavigationDrawer` | Standalone controlled/uncontrolled modal navigation with configurable trigger/title/description/close labels.                                                                                                                                                          |
| `CommandPalette`             | Controlled/uncontrolled, audience-filtered Navigation/Actions/Records search. Supports Cmd/Ctrl+K, typing, Arrow Up/Down, Enter, Escape, no-match content, and product-owned `onSelect` routing.                                                                       |
| `CollectionToolbar`          | Controlled/uncontrolled collection search plus filter, sort, view, selection/status, and action slots.                                                                                                                                                                 |
| `EntityCombobox`             | Controlled/uncontrolled searchable entity selection with listbox keyboard behavior and loading/error/empty copy.                                                                                                                                                       |
| `WorkflowStepper`            | Responsive horizontal/vertical workflow progress with complete/current/upcoming/error states.                                                                                                                                                                          |
| `ReviewSummary`              | Pre-submit review surface with complete/partial/warning/error item treatment and action slots.                                                                                                                                                                         |
| `InlineNotice`               | Info/success/warning/danger/offline contextual notice with action and dismiss slots.                                                                                                                                                                                   |
| `ResponsiveRecord`           | Dense desktop row that becomes a labeled card; `numeric` fields use tabular numerals.                                                                                                                                                                                  |

Curated Lucide shell icons are re-exported from `@clockwork/ui`; applications
should not depend on the icon package transitively.

## Command data ownership

The web adapter builds command items for the active audience only:

- Customer: customer navigation, quote/account actions, and representative
  quote/order/invoice records.
- Partner: partner navigation, registration/quote actions, and end-client
  records.
- Internal: internal navigation, global-search/review actions, and queue
  records.

Selection uses the Next router. Modified clicks in structural navigation remain
native link behavior. Organization selection announces the change and routes to
the corresponding customer, partner, or internal portal.

## Tokens, states, and motion

Brand, semantic color, typography, spacing, radius, shadow, control size, rail
width, and motion are expressed as swappable `--cw-*` properties in
`@clockwork/ui/styles.css`. Primary navigation and utility targets have a
2.75rem (44px) minimum. Monetary and capacity fields opt into tabular numerals.

Native `disabled`, `aria-disabled`, `aria-busy`, `aria-current`, and
`aria-selected` semantics drive disabled, loading, current, and selected
treatment. Shared success, warning, danger, and offline colors and `data-state`
hooks cover application feedback. Interaction transitions are 140–180ms;
`prefers-reduced-motion` reduces animation and transition duration to
effectively zero.

## Storybook coverage

`Design shell/Responsive system` includes desktop, mobile, open drawer, loading,
empty, no-match, partial, error, and keyboard-focus stories. The Storybook
accessibility test renders the shared shell and state primitives with axe in
addition to the production shell Playwright audit.

## Integration notes

- Keep route groups focused on experience content; do not reproduce the rail,
  drawer, command dialog, or shell breakpoints there.
- Add destinations and audience commands through the web shell data maps, with
  labels in `apps/web/src/i18n/en.ts`.
- Preserve all link props supplied by `renderNavigationItem`, especially
  current/disabled state, click handling, accessible names, and compact-rail
  titles.
- Override tokens at an application/brand boundary for final brand assets
  instead of editing component selectors.
- The shell wraps route-owned `<main id="main-content">` without creating a
  second main landmark.
