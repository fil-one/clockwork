# Clockwork UI

`@clockwork/ui` is the structural and visual source of truth for Fil One
commerce experiences. Import components from `@clockwork/ui` and the tokenized
stylesheet once from `@clockwork/ui/styles.css`. Applications supply routing,
session, organization, audience, and record data; the package supplies
semantics, adaptive layout, states, and interaction behavior.

## Design-shell APIs

- `AppShell`: responsive header/rail/content/footer structure. Desktop keeps the
  full rail, tablet uses an icon rail, and mobile uses
  `ResponsiveNavigationDrawer`. Use `renderNavigationItem` for framework links.
  When a page already renders its own `<main id="main-content">`, pass
  `contentElement="div"` and `contentOwnsTarget={false}`.
- `Navigation`, `ResponsiveNavigationDrawer`: grouped, current-page-aware
  navigation. `onNavigate` receives the item and click event; custom link
  renderers must spread all supplied link props so mobile navigation closes and
  accessibility state is retained.
- `CommandPalette`: audience-filtered Navigation, Actions, and Records search.
  It owns Cmd/Ctrl+K, filtering, Arrow Up/Down, Enter, Escape, focus
  trapping/restoration, and a no-result state. Pass `onSelect` to route with the
  host framework; otherwise `href` uses browser navigation.
- `CollectionToolbar`: controlled or uncontrolled search with result, selection,
  filter, sort, view, and action slots.
- `EntityCombobox`: controlled or uncontrolled searchable entity selection with
  listbox keyboard behavior.
- `WorkflowStepper`: responsive workflow progress/navigation using `complete`,
  `current`, `upcoming`, and `error` states.
- `ReviewSummary`: scan-friendly pre-submit values with complete, partial,
  warning, and error treatment.
- `InlineNotice`: contextual info, success, warning, danger, and offline
  messaging with action/dismiss slots.
- `ResponsiveRecord`: a dense desktop record row that becomes a labeled card on
  narrow screens. Mark monetary or capacity fields with `numeric` for tabular
  numerals.

All public prop types are exported beside their components. Shell-safe Lucide
components used by applications are also exported from `@clockwork/ui`, avoiding
reliance on a transitive icon dependency.

## Tokens and states

Every palette, type, spacing, radius, shadow, motion, rail, and control value
uses a `--cw-*` custom property defined in `src/styles.css`. Override these
variables at an application or brand boundary instead of editing component
selectors. Interactive motion is 140–180ms and the stylesheet globally honors
`prefers-reduced-motion`.

Use native `disabled`/`aria-disabled` and `aria-busy` semantics. Components
expose strong selected/current treatment, and shared
`data-state="success|warning|danger|offline"` hooks are available for button and
record surfaces. Primary navigation and utilities use a 2.75rem (44px) minimum
target.
