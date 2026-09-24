import type { Locale, Translator } from "@/src/i18n";

import {
  partnerSurfaces,
  type PartnerSurfaceConfig,
  type PartnerSurfaceKey,
} from "./partner-data";
import { presentPartnerFixture } from "./partner-presentation";

/**
 * A surface's chrome with its fixtures presented the way the demo read path
 * presents them, for component tests that render `PartnerCollection` without a
 * projection source. Kept out of `partner-presentation.ts` so the client bundle
 * does not carry every fixture.
 */
export function presentedPartnerSurface(
  surface: PartnerSurfaceKey,
  t: Translator,
  locale: Locale,
): PartnerSurfaceConfig {
  const config = partnerSurfaces[surface];
  return {
    ...config,
    records: config.records.map((fixture) =>
      presentPartnerFixture(fixture, t, locale),
    ),
  };
}
