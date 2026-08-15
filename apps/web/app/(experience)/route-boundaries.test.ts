import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The jsdom environment this project runs unit tests in does not give
 * `import.meta.url` a `file:` scheme, so the tree is located from the working
 * directory instead. Both candidates are checked because the suite is run
 * from the package and, through turbo, from the workspace root. A root that
 * resolved to nothing would make every assertion below vacuously true, so a
 * miss throws rather than yielding an empty list.
 */
function locateExperienceRoot(): string {
  const candidates = [
    path.join(process.cwd(), "app", "(experience)"),
    path.join(process.cwd(), "apps", "web", "app", "(experience)"),
  ];
  for (const candidate of candidates)
    if (existsSync(path.join(candidate, "(customer)"))) return candidate;
  throw new Error(
    `Could not locate app/(experience) from ${process.cwd()}; the boundary audit would pass without reading anything.`,
  );
}

const experienceRoot = locateExperienceRoot();

/**
 * Every directory in the experience tree that owns a `layout.tsx`, deepest
 * first. Next renders a segment's `error.tsx` and `not-found.tsx` *inside*
 * that segment's layout and *outside* the layouts beneath it, so a layout
 * without those two files hands its failures to a boundary that sits above the
 * chrome it renders. For the audience groups that chrome is `AppShell`: the
 * navigation rail, the organization switcher, the command palette and the
 * assisted-session banner.
 */
function layoutSegments(directory: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  const nested = entries
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => layoutSegments(path.join(directory, entry.name)));
  const owned = entries.some(
    (entry) => entry.isFile() && entry.name === "layout.tsx",
  );
  return owned ? [...nested, directory] : nested;
}

function relative(directory: string): string {
  return path.relative(experienceRoot, directory) || "(experience)";
}

function segmentFile(directory: string, name: string): string | undefined {
  try {
    return readFileSync(path.join(directory, name), "utf8");
  } catch {
    return undefined;
  }
}

const segments = layoutSegments(experienceRoot);

describe("experience route boundaries", () => {
  it("gives the experience group a layout of its own", () => {
    // Without this the group's fallbacks are children of the root document,
    // so reaching one replaces the entire application rather than the group.
    expect(segments.map(relative)).toContain("(experience)");
  });

  it("covers every audience group, so no surface is left to the group boundary", () => {
    expect(segments.map(relative).sort()).toEqual([
      "(customer)",
      "(experience)",
      "(internal)",
      "(partner)",
    ]);
  });

  it.each(["error.tsx", "not-found.tsx"])(
    "declares %s beside every layout in the tree",
    (name) => {
      const missing = segments
        .filter((directory) => segmentFile(directory, name) === undefined)
        .map(relative);
      expect(missing).toEqual([]);
    },
  );

  /**
   * `permission-view` is the full-viewport centered layout used by surfaces
   * that render *without* the shell. An audience group's fallbacks render
   * inside `AppShell`, which supplies its own frame and expects its child to
   * own `id="main-content"`; reaching for the shell-less layout there would
   * put a second centered viewport inside the shell's content column and is a
   * reliable sign the file was copied from the group-level boundary.
   */
  it.each(["error.tsx", "not-found.tsx"])(
    "keeps the shell-less layout out of the audience %s files",
    (name) => {
      const audience = segments.filter(
        (directory) => relative(directory) !== "(experience)",
      );
      const offenders = audience
        .filter((directory) =>
          segmentFile(directory, name)?.includes("permission-view"),
        )
        .map(relative);
      expect(offenders).toEqual([]);
      for (const directory of audience)
        expect(segmentFile(directory, name)).toContain('id="main-content"');
    },
  );
});
