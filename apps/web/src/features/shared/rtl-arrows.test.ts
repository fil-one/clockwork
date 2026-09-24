import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "vitest";

function stylesheets(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return stylesheets(path);
    return entry.name.endsWith(".css") ? [path] : [];
  });
}

/**
 * The trailing arrows are already written for the reading direction: the
 * message `customer.link.arrow` is "←" in Arabic, and the operations home
 * picks "←" for an RTL language. Two stylesheets also mirrored the arrow with
 * `scaleX(-1)` under `dir="rtl"`, which turned it back into "→", pointing away
 * from the reading direction.
 */
it("never mirrors text that is already written for its direction", () => {
  // Vitest runs from apps/web.
  const offenders = ["src", "app"]
    .flatMap((directory) => stylesheets(join(process.cwd(), directory)))
    .filter((path) =>
      /scaleX\(\s*-1\s*\)/u.test(
        readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//gu, ""),
      ),
    );
  expect(offenders).toEqual([]);
});
