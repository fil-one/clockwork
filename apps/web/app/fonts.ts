import localFont from "next/font/local";

/**
 * The three brand families are licensed under the SIL Open Font License 1.1 and
 * each family's license text sits beside its binary in `./fonts`. They are
 * served from this application rather than a font CDN so that the build reaches
 * no network and a page never blocks its first paint on a third-party origin.
 *
 * Every face is variable, so the numeric weights the stylesheets ask for are
 * positions on a live `wght` axis instead of separate files. Aspekta spans 100
 * to 900 and both Funnel families span 300 to 800; a weight outside a family's
 * range clamps to the nearest end rather than failing visibly, which is why the
 * token layer stays inside those bounds.
 *
 * The `fallback` list is what lets Next derive a metric-matched fallback face,
 * so the swap from the fallback to the brand face moves the layout as little as
 * possible. It is repeated in full for each family because the font loader is a
 * compile-time transform and reads only literals, never a shared constant.
 */
const aspekta = localFont({
  src: "./fonts/aspekta-variable.woff2",
  variable: "--cw-font-aspekta",
  weight: "100 900",
  style: "normal",
  display: "swap",
  preload: true,
  fallback: [
    "Avenir Next",
    "Avenir",
    "Inter",
    "ui-sans-serif",
    "system-ui",
    "sans-serif",
  ],
});

const funnelSans = localFont({
  src: "./fonts/funnel-sans-variable.woff2",
  variable: "--cw-font-funnel-sans",
  weight: "300 800",
  style: "normal",
  display: "swap",
  preload: true,
  fallback: [
    "Avenir Next",
    "Avenir",
    "Inter",
    "ui-sans-serif",
    "system-ui",
    "sans-serif",
  ],
});

// Funnel Display carries small-area accents, so it is left out of the preload
// set rather than competing with the two text faces for the first-paint budget.
const funnelDisplay = localFont({
  src: "./fonts/funnel-display-variable.woff2",
  variable: "--cw-font-funnel-display",
  weight: "300 800",
  style: "normal",
  display: "swap",
  preload: false,
  fallback: [
    "Avenir Next",
    "Avenir",
    "Inter",
    "ui-sans-serif",
    "system-ui",
    "sans-serif",
  ],
});

export const brandFontVariables = [
  aspekta.variable,
  funnelSans.variable,
  funnelDisplay.variable,
].join(" ");
