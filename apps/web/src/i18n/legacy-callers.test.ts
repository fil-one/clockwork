import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { legacyCallers } from "./legacy-callers/index.mjs";
import { laneOf } from "./ownership";

const root = join(process.cwd(), "../..");
const literalLocale =
  /new Intl\.\w+\(\s*["'`]|\.toLocale(?:String|DateString|TimeString)\(\s*(?:["'`]|\))/u;

/**
 * The legacy exemptions only shrink. A line whose file no longer needs the
 * exemption fails here, so a lane that migrates a file also deletes its line,
 * and nobody can hide a new caller behind an old entry.
 */
describe("legacy i18n exemptions", () => {
  for (const [lane, lists] of Object.entries(legacyCallers)) {
    it(`${lane} lists only live callers it owns`, () => {
      for (const kind of ["localizeCopy", "literalLocales"] as const) {
        for (const file of lists[kind]) {
          expect(existsSync(join(root, file)), `${file} is gone`).toBe(true);
          expect(laneOf(file), `${file} is not a ${lane} file`).toBe(lane);
          const source = readFileSync(join(root, file), "utf8");
          if (kind === "localizeCopy")
            expect(source, `${file} no longer needs ${kind}`).toContain(
              "@/src/i18n/copy",
            );
          else
            expect(source, `${file} no longer needs ${kind}`).toMatch(
              literalLocale,
            );
        }
      }
    });
  }
});
