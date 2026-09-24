import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/*
 * The contrast budget, measured rather than typed. This reads the token block
 * in styles.css, resolves every var() chain to a color, composites any alpha
 * over the surface it lands on, and computes the WCAG 2.2 contrast ratio for
 * each pairing the product relies on. Change a token and the ratios here
 * change with it; drop a pair below its minimum and the unit suite fails.
 *
 * Minimums: 4.5:1 for text (SC 1.4.3), 3:1 for the parts of a control or a
 * graphic someone needs in order to see it at all (SC 1.4.11). Hairline
 * borders that only group content are decorative and are not listed.
 */

const stylesheet = readFileSync(new URL("./styles.css", import.meta.url), {
  encoding: "utf8",
});

/** The declarations of the first top-level `:root` block, comments removed. */
function rootTokens(css: string): Map<string, string> {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const start = withoutComments.indexOf(":root {");
  if (start === -1) throw new Error("styles.css has no :root block");
  const end = withoutComments.indexOf("}", start);
  const body = withoutComments.slice(start + ":root {".length, end);
  const tokens = new Map<string, string>();
  for (const declaration of body.split(";")) {
    const match = /^\s*(--[\w-]+)\s*:\s*([\s\S]+?)\s*$/.exec(declaration);
    if (match?.[1] && match[2]) {
      tokens.set(match[1], match[2].replace(/\s+/g, " "));
    }
  }
  return tokens;
}

const tokens = rootTokens(stylesheet);

function resolve(value: string, depth = 0): string {
  if (depth > 20) throw new Error(`var() cycle while resolving ${value}`);
  return value.replace(
    /var\((--[\w-]+)(?:\s*,\s*([^)]+))?\)/g,
    (_, name: string, fallback?: string) => {
      const next = tokens.get(name) ?? fallback;
      if (next === undefined) throw new Error(`${name} is not defined`);
      return resolve(next, depth + 1);
    },
  );
}

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseColor(input: string): Rgba {
  const value = input.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(value)?.[1];
  if (hex) {
    const full =
      hex.length === 3
        ? hex
            .split("")
            .map((digit) => digit + digit)
            .join("")
        : hex;
    const channel = (index: number) =>
      Number.parseInt(full.slice(index, index + 2), 16);
    return {
      r: channel(0),
      g: channel(2),
      b: channel(4),
      a: full.length === 8 ? channel(6) / 255 : 1,
    };
  }
  const rgb =
    /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[/,]\s*([\d.]+%?))?\s*\)$/.exec(
      value,
    );
  if (rgb) {
    const alpha = rgb[4];
    return {
      r: Number(rgb[1]),
      g: Number(rgb[2]),
      b: Number(rgb[3]),
      a:
        alpha === undefined
          ? 1
          : alpha.endsWith("%")
            ? Number.parseFloat(alpha) / 100
            : Number(alpha),
    };
  }
  throw new Error(`Unsupported color: ${input}`);
}

/** A literal color or a token name, resolved to an opaque color over `under`. */
function color(reference: string, under?: Rgba): Rgba {
  const raw = reference.startsWith("--")
    ? resolve(`var(${reference})`)
    : reference;
  const parsed = parseColor(raw);
  if (parsed.a >= 1) return parsed;
  if (!under)
    throw new Error(`${reference} is translucent and has no backdrop`);
  const mix = (top: number, bottom: number) =>
    top * parsed.a + bottom * (1 - parsed.a);
  return {
    r: mix(parsed.r, under.r),
    g: mix(parsed.g, under.g),
    b: mix(parsed.b, under.b),
    a: 1,
  };
}

function luminance({ r, g, b }: Rgba): number {
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrast(foreground: string, background: string): number {
  const back = color(background);
  const front = color(foreground, back);
  const [light, dark] = [luminance(front), luminance(back)].sort(
    (left, right) => right - left,
  ) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

const surfaces = ["--cw-surface", "--cw-canvas", "--cw-canvas-deep"] as const;

type Pair = readonly [foreground: string, background: string, use: string];

/* Text: 4.5:1. */
const textPairs: readonly Pair[] = [
  ...surfaces.flatMap((surface): Pair[] => [
    ["--cw-ink", surface, "primary text"],
    ["--cw-ink-soft", surface, "secondary text and table cells"],
    ["--cw-muted", surface, "descriptions, labels, table headers"],
    ["--cw-faint", surface, "annotation and navigation group labels"],
    ["--cw-action", surface, "links"],
    ["--cw-warning", surface, "amber state text"],
    ["--cw-danger", surface, "error text"],
    ["--cw-success", surface, "confirmed state text"],
  ]),
  ["--cw-action", "--cw-action-soft", "a link inside a selected row"],
  ["--cw-action-strong", "--cw-action-soft", "active navigation item"],
  ["--cw-muted", "--cw-action-soft", "supporting text in a selected row"],
  ["--cw-info", "--cw-info-soft", "information badge and banner"],
  ["--cw-success", "--cw-success-soft", "success badge and banner"],
  ["--cw-warning-ink", "--cw-warning-soft", "warning badge and banner"],
  ["--cw-danger-strong", "--cw-danger-soft", "danger badge and banner"],
  ["--cw-offline", "--cw-offline-soft", "offline notice"],
  ["--cw-ink-soft", "--cw-canvas-deep", "neutral badge"],
  ["#ffffff", "--cw-action", "primary button label"],
  ["#ffffff", "--cw-action-strong", "primary button label on hover"],
  ["#ffffff", "--cw-danger", "danger button label"],
  ["#ffffff", "--cw-danger-strong", "danger button label on hover"],
  ["#ffffff", "--cw-ink", "tooltip and skip link"],
];

/* Control boundaries, focus indicators, and meaningful marks: 3:1. */
const graphicPairs: readonly Pair[] = [
  ...surfaces.flatMap((surface): Pair[] => [
    ["--cw-border-strong", surface, "text field, select, checkbox boundary"],
    ["--cw-focus", surface, "focus ring"],
    ["--cw-action", surface, "meter fill and selected marker"],
    ["--cw-warning-mark", surface, "amber dot and notice stripe"],
    ["--cw-success", surface, "success dot"],
    ["--cw-danger", surface, "danger dot and threshold"],
  ]),
  ["--cw-focus", "--cw-action-soft", "focus ring on a selected row"],
  ["--cw-warning-mark", "--cw-warning-soft", "amber stripe on its own wash"],
];

describe("design token contrast", () => {
  it("resolves every token the pairs use", () => {
    for (const [foreground, background] of [...textPairs, ...graphicPairs]) {
      expect(() => contrast(foreground, background)).not.toThrow();
    }
  });

  it.each(textPairs)(
    "%s on %s reaches 4.5:1 (%s)",
    (foreground, background) => {
      expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(graphicPairs)(
    "%s against %s reaches 3:1 (%s)",
    (foreground, background) => {
      expect(contrast(foreground, background)).toBeGreaterThanOrEqual(3);
    },
  );

  it("measures the reference values the way WCAG defines them", () => {
    // Black on white is the defined maximum, and a color on itself the minimum.
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#777777")).toBeCloseTo(1, 5);
    // A translucent foreground is composited over its backdrop first.
    expect(contrast("rgb(0 0 0 / 0.5)", "#ffffff")).toBeCloseTo(
      contrast("#808080", "#ffffff"),
      1,
    );
  });
});
