import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every route that builds a `ProjectionFreshness` object must wire the
 * loader's `truncated` flag into `partial`.
 *
 * This defect arrived nine-at-once: `loadPortalRecords` returned `truncated`,
 * the partner route disclosed it, and every customer collection route built
 * `freshness={{ generatedAt, stale }}` and threw the flag away -- so a reader
 * whose ledger was cut off at the page ceiling got the generic "may be out of
 * date" banner instead of "rows are missing". Making `partial` required on
 * `ProjectionFreshness` stops a route from omitting the field, but it cannot
 * stop a route from writing `partial: false` above a loader that can
 * truncate. This test closes that gap at the source level: any non-test
 * surface file that constructs a `freshness={{...}}` prop must bind `partial`
 * to a `.truncated` value, and the scan must keep finding the routes it was
 * written against, so a moved directory cannot quietly turn it into a scan of
 * nothing.
 *
 * If a future surface genuinely reads from a source that cannot truncate,
 * pass that source's own equivalent of `truncated` -- and if none exists,
 * this test is the place to record the exemption deliberately rather than
 * hardcoding `false` silently.
 */

// Vitest runs with the package as its working directory; under jsdom,
// `import.meta.url` is not a file: URL, so the filesystem root comes from the
// process instead. The "still sees the routes" assertion below is what catches
// this path going wrong.
const webRoot = process.cwd();

function tsxFilesUnder(root: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      found.push(...tsxFilesUnder(path));
    } else if (entry.name.endsWith(".tsx") && !entry.name.includes(".test.")) {
      found.push(path);
    }
  }
  return found;
}

/** Every `freshness={{...}}` block in one file's source. */
function freshnessConstructions(source: string): string[] {
  return [...source.matchAll(/freshness=\{\{[^}]*\}\}/gs)].map(
    (match) => match[0],
  );
}

const scannedRoots = [
  join(webRoot, "app", "(experience)"),
  join(webRoot, "src", "features"),
];

describe("projection freshness wiring across every surface", () => {
  const sites = scannedRoots.flatMap(tsxFilesUnder).flatMap((file) =>
    freshnessConstructions(readFileSync(file, "utf8")).map((block) => ({
      file,
      block,
    })),
  );

  it("still sees the routes it was written against", () => {
    // Eleven customer collection pages plus the shared partner route. A count
    // below this means the scan lost its subject (renamed directory, moved
    // routes), not that the defect is gone -- fix the scan, not the number.
    expect(sites.length).toBeGreaterThanOrEqual(12);
  });

  it("binds partial to the loader's truncated flag at every construction", () => {
    const unwired = sites.filter(
      ({ block }) => !/partial:\s*[\w$]+(\?)?\.truncated\b/.test(block),
    );
    expect(unwired.map(({ file, block }) => `${file}\n${block}`)).toStrictEqual(
      [],
    );
  });
});
