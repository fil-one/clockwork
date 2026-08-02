export type BrandMark = "wordmark" | "icon";
export type BrandTone = "colour" | "mono";
export type BrandInk = "dark" | "light";

export interface BrandAssetOptions {
  mark?: BrandMark;
  tone?: BrandTone;
  ink?: BrandInk;
}

// The supplied files in `apps/web/public/brand`. The colour icon ships in a
// single ink, so both inks of the colour icon resolve to the same file.
const assets: Readonly<
  Record<`${BrandMark}-${BrandTone}-${BrandInk}`, string>
> = {
  "wordmark-colour-dark": "/brand/fo-wordmark-dark.png",
  "wordmark-colour-light": "/brand/fo-wordmark-light.png",
  "wordmark-mono-dark": "/brand/fo-wordmark-mono-dark.png",
  "wordmark-mono-light": "/brand/fo-wordmark-mono-light.png",
  "icon-colour-dark": "/brand/fo-icon-color.png",
  "icon-colour-light": "/brand/fo-icon-color.png",
  "icon-mono-dark": "/brand/fo-icon-mono-dark.png",
  "icon-mono-light": "/brand/fo-icon-mono-light.png",
};

/** Resolves a supplied mark to its public path. Selection lives in the app so
 * the `ui` package stays unaware of the public directory layout. */
export function brandAsset({
  mark = "wordmark",
  tone = "colour",
  ink = "dark",
}: BrandAssetOptions = {}): string {
  return assets[`${mark}-${tone}-${ink}`];
}
