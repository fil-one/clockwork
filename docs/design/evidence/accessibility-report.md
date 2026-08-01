# Experience design accessibility evidence

Evidence date: 2026-08-01 UTC

## Surfaces

- Customer: `/dashboard`
- Partner: `/partner`
- Operator: `/internal/queues`

The run selected `CLOCKWORK_EXPERIENCE_ADAPTER=demo` and
`NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV=test`. This adapter is explicit,
deterministic, non-production only, and is rejected when either production
environment flag is set. No request interception was used by `visual.spec.ts`.

## Command

```sh
CLOCKWORK_EXPERIENCE_ADAPTER=demo \
NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV=test \
CLOCKWORK_TEST_PORT=33320 \
CLOCKWORK_ARTIFACT_DIR=.artifacts/design-approval-final \
pnpm --filter @clockwork/web exec playwright test e2e/visual.spec.ts --workers=1
```

Required runtime: Node 24.18.1 and pnpm 10.34.5.

## Result

- 10 tests passed in 12.3 seconds.
- 0 failures and 0 retries.
- Axe: zero WCAG-tagged violations across customer, partner, and operator at
  1440, 768, and 320 CSS pixels.
- Reflow: zero page-level horizontal overflow at every release viewport and at
  200%/400% zoom equivalents.
- Text spacing: no overlap, clipping, or page-level overflow under the WCAG
  1.4.12 override.
- Reduced motion: no running repeated animation.
- Keyboard: the skip link is natively sequentially focusable and shows a
  three-pixel visible focus outline.

The first run found partner commercial-boundary labels at 4.09:1. The labels
were changed to the primary ink token and the complete matrix was rerun
successfully. An obsolete empty operator screenshot was removed; it is not
approval evidence.
