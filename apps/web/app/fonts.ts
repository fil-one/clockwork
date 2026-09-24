import localFont from "next/font/local";

/**
 * Inter is the one product typeface, as it is in the Fil One console. It is
 * licensed under the SIL Open Font License 1.1, and the license text sits beside
 * the binaries in `./fonts`. The files are the variable `wght` subsets from the
 * `@fontsource-variable/inter` 5.3.0 package, copied in rather than installed,
 * so the build reaches no network and a page never waits on a font CDN. The
 * content security policy keeps `font-src 'self'`.
 *
 * Each subset is its own loader call because a loader call applies one set of
 * descriptors to every file it declares, and the two files need different
 * `unicode-range` values. The ranges are the ones fontsource publishes, so the
 * browser downloads the extended file only when a page contains a character
 * that needs it (a name such as "Łukasz", for example).
 *
 * The stacks in `packages/ui/src/styles.css` list the extended family first.
 * Order matters because each loader call also emits its fallback family into
 * the variable, and the basic call's fallback is a metric-matched local Arial.
 * Arial has the extended Latin glyphs, so if the basic family came first its
 * fallback would draw those characters before the extended family was ever
 * consulted. The extended call therefore sets no fallback of its own, and it
 * skips every basic-Latin character by range, so the basic family and its
 * metric-matched fallback still carry ordinary text through the swap.
 *
 * Both files are variable, so every numeric weight in the stylesheets is a
 * position on a live `wght` axis from 100 to 900.
 */
const interExtended = localFont({
  src: "./fonts/inter-latin-ext-wght-normal.woff2",
  variable: "--cw-font-inter-extended",
  weight: "100 900",
  style: "normal",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF",
    },
  ],
});

const inter = localFont({
  src: "./fonts/inter-latin-wght-normal.woff2",
  variable: "--cw-font-inter",
  weight: "100 900",
  style: "normal",
  display: "swap",
  preload: true,
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
});

export const brandFontVariables = [inter.variable, interExtended.variable].join(
  " ",
);
