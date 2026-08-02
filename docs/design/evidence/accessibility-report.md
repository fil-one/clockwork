# Experience design accessibility evidence

Evidence date: 2026-08-02 UTC

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
CLOCKWORK_EVIDENCE_ADAPTER=demo \
NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV=test \
CLOCKWORK_TEST_PORT=33320 \
CLOCKWORK_ARTIFACT_DIR=.artifacts/design-approval-final \
pnpm --filter @clockwork/web exec playwright test e2e/visual.spec.ts \
  --project=chromium --workers=1
```

Required runtime: Node 24.18.1 and pnpm 10.34.5.

## Result

- 19 tests passed in 31.4 seconds.
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

The full suite, `--project=functional-chromium --project=chromium`, passes 82 of
82 on the same runtime.

## Contrast pairs corrected in this evidence run

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
