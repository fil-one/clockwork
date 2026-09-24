import { expect, type Locator } from "@playwright/test";

/**
 * Target sizes, as `docs/design/fil-one-experience-system.md` states them.
 *
 * With a mouse the console keeps its density: controls are 32 to 36 CSS px,
 * and the floor is WCAG 2.2 AA 2.5.8, 24 by 24 CSS px. Under
 * `@media (pointer: coarse)` every control, navigation row, and command result
 * returns to 44 CSS px, which is what `packages/ui/src/styles.css` sets for
 * touch.
 */
export const targetMinimum = { fine: 24, coarse: 44 } as const;

export type PointerKind = keyof typeof targetMinimum;

/**
 * The caller names the pointer it expects, and the page has to agree. A touch
 * check that ran in a mouse context would measure the dense layout against the
 * touch floor and fail for the wrong reason; worse, a mouse check in a touch
 * context would hold touch to 24 px when the product promises 44.
 */
export async function expectTargetSize(
  locator: Locator,
  pointer: PointerKind = "fine",
) {
  const coarse = await locator
    .page()
    .evaluate(() => window.matchMedia("(pointer: coarse)").matches);
  expect(
    coarse ? "coarse" : "fine",
    "the browser context must emulate the pointer the check is for",
  ).toBe(pointer);
  const minimum = targetMinimum[pointer];
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, "the target should have a rendered hit area").not.toBeNull();
  expect(
    box?.width,
    `target width (${pointer} pointer)`,
  ).toBeGreaterThanOrEqual(minimum);
  expect(
    box?.height,
    `target height (${pointer} pointer)`,
  ).toBeGreaterThanOrEqual(minimum);
}
