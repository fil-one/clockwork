# Experience design accessibility evidence

Evidence date: 2026-08-15 UTC

This report has two parts. The scanner run, which is what the earlier version of
this file contained, and a keyboard and assistive-technology run, which is new
and which found five failures that the scanner had passed for months. The
scanner section is kept because it is still worth having; it is placed second
because on its own it was misleading.

## What a keyboard run covers that the scanner does not

Every finding below passed axe at every release viewport. The run is against a
production build because that is the artifact that ships, and because the
identity guard that returns 503 without provider credentials is production-only,
so a development run does not exercise the same request path. Measured rather
than assumed: all six regression tests were also run against `next dev` and
behave identically there, so none of these five failures was hidden by
development alone -- they were hidden by being invisible to a scanner.

- **The skip link moved the viewport but not focus.** Forty-four routes render
  their own `<main id="main-content">`, and a fragment link focuses its target
  only if the target can hold focus. A landmark cannot, so the caret and the
  screen reader cursor stayed in the header and the next Tab went to the second
  header control. `SkipLink` now applies `tabindex="-1"` to the target on
  activation, focuses it, and removes the attribute again on blur. The attribute
  is transient on purpose: a permanently focusable landmark is picked up by the
  App Router's own post-navigation `focus()` call, which would pull focus into
  the content on every client transition and take it away from the navigation
  drawer trigger that restores it deliberately.
- **A client transition announced nothing.** The route changed, the content
  changed, and no live region said so. The shell already owned one polite region
  for connection and organization messages, so the destination goes through that
  region rather than a second one competing with it. Focus is deliberately not
  moved on navigation; see the gaps below.
- **The operator queue table stopped being a table below 48rem.** The responsive
  rules set `display: grid` on the table, the row group, the rows and the cells,
  and `display: none` on the head. Browsers derive the `table`, `row`,
  `columnheader` and `cell` roles from the computed display value, so at 320px
  the accessibility tree held **zero column headers** and no table -- the
  semantics the operator brief claims. Measured on a production build before and
  after:

  | 320px, `/internal/queues`  | Before  | After                |
  | -------------------------- | ------- | -------------------- |
  | `getComputedStyle(table)`  | `grid`  | `table`              |
  | `getComputedStyle(thead)`  | `none`  | `table-header-group` |
  | Column headers in the tree | 0       | 6                    |
  | Scroll container overflows | `false` | `true`               |
  | Page horizontal overflow   | 0px     | 0px                  |

  The card layout is gone. The table keeps its semantics at every width and the
  columns that do not fit are reached by scrolling the container.

- **That scroll container could not be scrolled from the keyboard.** It held no
  focusable element and had no tab stop, role or name of its own, so its
  contents were reachable by pointer only. It is now a named region with
  `tabindex="0"`, and arrow keys scroll it.
- **Global search ran two mutually exclusive keyboard patterns at once.** The
  input carried `aria-activedescendant` while the arrow keys also moved real DOM
  focus, so assistive technology was told the cursor was in two places. The
  results are links inside a grouped list, each with a status and an expandable
  reference that the `option` role forbids, so they are not combobox options and
  `aria-activedescendant` is the wrong half. It is removed; real focus is what
  remains, and Escape now returns focus to the field. Removing it exposed a
  second defect and that is fixed too: the effect that reset the active result
  discarded the whole ref array after React had just attached it, so on a
  freshly loaded result page the first arrow press moved no focus at all.
- **The queue filter dropped typed characters.** Every keystroke pushed a URL
  through a transition and an effect reset the field from whichever URL arrived,
  so a value committed three characters ago overwrote what had been typed since.
  Reproduced deterministically under a 100ms router lag: typing `collections`
  left `cot` in the field and made eleven navigations. The field is now the
  authority while an edit is outstanding, the URL is the authority the rest of
  the time, and the commit is debounced: one navigation, and the field holds
  `collections`. A filter changed mid-edit carries the outstanding keystrokes
  into the same URL rather than discarding them, and Clear all still clears.

### Keyboard and semantics run

```sh
# Production build. None of the above reproduces against `next dev`, and the
# 503 identity guard is production-only, hence the demo deploy opt-in.
CLOCKWORK_NEXT_DIST_DIR=.next-a11y \
CLOCKWORK_EXPERIENCE_ADAPTER=demo \
CLOCKWORK_EVIDENCE_ADAPTER=demo \
NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV=test \
pnpm --filter @clockwork/web exec next build

CLOCKWORK_NEXT_DIST_DIR=.next-a11y \
CLOCKWORK_EXPERIENCE_ADAPTER=demo \
CLOCKWORK_EVIDENCE_ADAPTER=demo \
NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV=test \
CLOCKWORK_DEMO_DEPLOY=1 \
pnpm --filter @clockwork/web exec next start --hostname 127.0.0.1 --port 33431

CLOCKWORK_TEST_PORT=33431 \
CLOCKWORK_EXPERIENCE_ADAPTER=demo \
CLOCKWORK_EVIDENCE_ADAPTER=demo \
NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV=test \
pnpm --filter @clockwork/web exec playwright test \
  e2e/a11y-keyboard.spec.ts --project=functional-chromium
```

Result: 6 of 6 passed against the built application, and 6 of 6 against
`next dev`, which is what the ordinary end-to-end suite runs.

Regression cover:

- `apps/web/e2e/a11y-keyboard.spec.ts` -- real key presses in a real browser:
  Tab to the skip link, Enter, focus lands on the landmark and the next Tab
  continues inside it; a rail navigation announces its destination; the table
  keeps `display: table` and six column headers at 320px with no page-level
  horizontal overflow; the scroll container takes focus and scrolls on
  ArrowRight; typing keeps every character; arrow keys move real focus through
  search results with no `aria-activedescendant`.
- `apps/web/src/features/shell/shell-accessibility.test.tsx` -- skip link focus,
  the transient `tabindex`, the route announcement, and that the shell still has
  exactly one live region.
- `apps/web/src/features/internal-ops/queue-search/queue-accessibility.test.tsx`
  -- the named, focusable scroll region, the column headers, lossless typing
  under a modelled router lag, the filter change that carries outstanding
  keystrokes, and the search keyboard model.

Each of these fails against the code as it was: seven of the eight unit
assertions and both browser table assertions were run against the pre-fix
sources and the pre-fix production build and failed there.

## What is still not covered

Stated plainly, because a claim of coverage is what was wrong with the earlier
version of this file.

- **No screen reader was driven.** Verification was Chromium: computed style,
  the accessibility tree Playwright exposes, and real key events. NVDA, JAWS and
  VoiceOver were not run, so the wording and pacing of what is announced is
  unverified even though the mechanics are.
- **Focus does not move on client navigation, by design.** Controls in the shell
  restore focus on purpose after a transition -- the mobile drawer hands it back
  to its trigger -- and moving focus into the content would take it from them.
  The announcement tells a screen reader user the route changed; the skip link
  is the supported way into the content. A user who wants the content and does
  not use the skip link continues tabbing from wherever they were, which is what
  the framework does natively.
- **A repeated announcement is not re-announced.** Two routes whose destination
  name is identical put identical text in the live region, and a live region
  says nothing when its text does not change.
- **The shell announces its connection state on first mount.** "Connection
  restored" reaches the live region on every page load. It is pre-existing, it
  is not a route announcement, and it was not changed here.
- **Only the operator queue table was audited for scrollable regions.** Other
  surfaces may have scroll containers with no keyboard route in; nothing has
  swept for them.
- **`aria-controls` on the global search input** still names a results section
  that exists only once there are results. Left as it was.
- **The forty-four `<main id="main-content">` elements carry no `tabindex` in
  their markup.** Focus is applied at skip-link activation. Anything else that
  wants to move focus to the landmark has to do the same, and
  `focusFragmentTarget` is exported from `@clockwork/ui` for that.
- **Contrast, reflow, text spacing and reduced motion were not re-measured.**
  The figures below are from the 2026-08-02 run and nothing in this change
  touches a token or an animation.
- Four end-to-end failures reproduce on a clean tree and are unrelated to this
  work: two in `experience.spec.ts` and two in `ux-internal-ops.spec.ts`.

## Scanner run

Surfaces:

- Customer: `/dashboard`
- Partner: `/partner`
- Operator: `/internal/queues`

The run selected `CLOCKWORK_EXPERIENCE_ADAPTER=demo` and
`NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV=test`. This adapter is explicit,
deterministic, non-production only, and is rejected when either production
environment flag is set. No request interception was used by `visual.spec.ts`.

```sh
CLOCKWORK_EXPERIENCE_ADAPTER=demo \
CLOCKWORK_EVIDENCE_ADAPTER=demo \
NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV=test \
CLOCKWORK_TEST_PORT=33320 \
CLOCKWORK_ARTIFACT_DIR=.artifacts/design-approval-final \
pnpm --filter @clockwork/web exec playwright test e2e/visual.spec.ts \
  --project=chromium --workers=1
```

Required runtime: Node 24.18.1 and pnpm 10.34.5.

- 19 tests passed in 31.4 seconds.
- 0 failures and 0 retries.
- Axe: zero WCAG-tagged violations across customer, partner, and operator at
  1440, 768, and 320 CSS pixels. That result is unchanged after this work, and
  it was also true of every failure listed above: the scanner reaches none of
  them.
- Reflow: zero page-level horizontal overflow at every release viewport and at
  200%/400% zoom equivalents. Re-checked at 320px on the rebuilt operator queue.
- Text spacing: no overlap, clipping, or page-level overflow under the WCAG
  1.4.12 override.
- Reduced motion: no running repeated animation.
- Keyboard: the skip link is natively sequentially focusable and shows a
  three-pixel visible focus outline. This line used to be the whole of the
  keyboard evidence, and it was true of the link while saying nothing about
  whether the link worked.

## Contrast pairs corrected in the 2026-08-02 evidence run

Three token pairs measured below their WCAG 2.2 AA target and were carrying live
content. Axe does not reach a `background` on a decorative pseudo-element, so
the two amber marks were measured directly rather than by the scanner.

| Pair                                           | Before             | After              | Target |
| ---------------------------------------------- | ------------------ | ------------------ | ------ |
| `--cw-faint` on surface / canvas / canvas-deep | 3.77 / 3.48 / 3.14 | 5.60 / 5.21 / 4.70 | 4.5    |
| Term-notice stripe on `--cw-warning-soft`      | 2.10               | 3.48               | 3.0    |
| Moderate risk mark on `--cw-canvas-deep`       | 2.02               | 3.40               | 3.0    |

Partner commercial-boundary labels carry the primary ink token and measure above
the ordinary-text target at every release viewport.
