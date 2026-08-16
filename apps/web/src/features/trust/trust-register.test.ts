import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  attestationVocabularyHits,
  corroboratesClaim,
  gateCorroborationPaths,
  quantitativeClaims,
  tokenDistinctivenessCeiling,
  trustControls,
  trustGaps,
  trustIntegrations,
  trustSections,
  trustUnselectedIntegrations,
} from "./trust-register";

/**
 * This suite is the control. `trust-register.ts` is only data; what stops it
 * becoming marketing copy is that every row is read back off the working tree
 * here.
 *
 * HOW EACH ASSERTION WAS CONFIRMED TO FAIL AGAINST A FABRICATION. Each block
 * below was run with a deliberately invented row appended to the register --
 * a control citing `packages/api/src/auth/nonexistent.ts`, a control citing a
 * real file for a token it does not contain, an integration named
 * "Acme Trust Cloud" citing `package.json`, and a control whose statement said
 * "SOC 2 Type II certified". Each produced exactly one failure naming the
 * invented row, and the rows were then removed. The paths and tokens that
 * remain are the ones that pass.
 *
 * THAT WAS NOT ENOUGH, AND HERE IS THE PROOF IT WAS NOT. Every injection above
 * is an injection that gets the CITATION wrong. A fabrication that gets the
 * citation right sailed through: two invented controls --
 *
 *   "AES-256 with customer-managed keys in a FIPS 140-2 Level 3 HSM, automatic
 *    90-day rotation, per-tenant key isolation, backups under dual control"
 *   "three availability zones, 99.99 per cent uptime commitment, 5-minute RPO"
 *
 * -- were appended citing `package.json` for the token "name". Both exist, both
 * are live, and the suite passed 73/73 untouched. Nothing in this repository is
 * encrypted with a customer-managed key and there is no uptime commitment.
 *
 * The two blocks at the bottom of this file are the response, and they are the
 * blocks to run an injection against: a claim's token must be distinctive
 * enough to name one implementation, and every quantity a claim asserts must
 * appear in a file that claim cites. Re-running the same two fabrications
 * against them now fails four assertions -- see the recorded output there.
 */

/**
 * Walk up to the workspace root rather than counting `../` segments, so moving
 * this file does not silently start reading a different tree. The marker is the
 * pnpm workspace manifest, which exists only at the root.
 */
function workspaceRoot(): string {
  let directory = resolve(process.cwd());
  for (;;) {
    if (existsSync(join(directory, "pnpm-workspace.yaml"))) return directory;
    const parent = dirname(directory);
    if (parent === directory)
      throw new Error("Workspace root was not found above the test directory");
    directory = parent;
  }
}

const repositoryRoot = workspaceRoot();

function read(path: string): string {
  return readFileSync(join(repositoryRoot, path), "utf8");
}

interface CitedEntry {
  readonly id: string;
  readonly evidencePath: string;
  readonly token: string;
}

const everyCitedEntry: readonly CitedEntry[] = [
  ...trustControls.flatMap((entry) => [
    {
      id: entry.id,
      evidencePath: entry.evidencePath,
      token: entry.token,
    },
    ...(entry.alsoCites ?? []).map((citation) => ({
      id: `${entry.id} (also cites ${JSON.stringify(citation.token)} in ${citation.path})`,
      evidencePath: citation.path,
      token: citation.token,
    })),
  ]),
  ...trustIntegrations.map((entry) => ({
    id: entry.name,
    evidencePath: entry.evidencePath,
    token: entry.token,
  })),
  ...trustUnselectedIntegrations.map((entry) => ({
    id: entry.capability,
    evidencePath: entry.evidencePath,
    token: entry.token,
  })),
  ...trustGaps.map((entry) => ({
    id: entry.id,
    evidencePath: entry.evidencePath,
    token: entry.token,
  })),
];

describe("trust register citations", () => {
  it("cites at least one control in every published section", () => {
    for (const section of trustSections)
      expect(
        trustControls.filter((control) => control.section === section.id),
        `section ${section.id} publishes a heading with no control under it`,
      ).not.toHaveLength(0);
  });

  it.each(everyCitedEntry.map((entry) => [entry.id, entry] as const))(
    "%s cites a file that exists and still contains what it claims",
    (id, entry) => {
      let contents: string;
      try {
        contents = read(entry.evidencePath);
      } catch {
        throw new Error(
          `${id} cites ${entry.evidencePath}, which does not exist in the working tree`,
        );
      }
      expect(
        contents.includes(entry.token),
        `${id} cites ${entry.evidencePath} for ${JSON.stringify(entry.token)}, which that file does not contain`,
      ).toBe(true);
    },
  );

  it("has no duplicate identifiers", () => {
    const ids = everyCitedEntry.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("trust register refuses to assert an attestation", () => {
  it.each(trustControls.map((control) => [control.id, control] as const))(
    "control %s makes no certification, audit or attestation claim",
    (id, control) => {
      expect(
        attestationVocabularyHits(control.statement),
        `control ${id} uses attestation vocabulary; a control may only state what the repository implements`,
      ).toEqual([]);
    },
  );

  it.each(
    trustIntegrations.map(
      (integration) => [integration.name, integration] as const,
    ),
  )("integration %s makes no attestation claim", (name, integration) => {
    expect(
      attestationVocabularyHits(`${integration.purpose}`),
      `integration ${name} uses attestation vocabulary`,
    ).toEqual([]);
  });

  it("names every unproven statement against a gate the rest of the system knows", () => {
    const corroboration = gateCorroborationPaths.map((path) => ({
      path,
      contents: read(path),
    }));
    const named = [
      ...trustGaps.map((gap) => [gap.id, gap.gate] as const),
      ...trustUnselectedIntegrations.map(
        (entry) => [entry.capability, entry.gate] as const,
      ),
    ];
    for (const [id, gate] of named)
      for (const source of corroboration)
        expect(
          source.contents.includes(gate),
          `${id} names gate ${gate}, which ${source.path} does not know about`,
        ).toBe(true);
  });

  it("states plainly that no certification is held", () => {
    const certifications = trustGaps.find(
      (gap) => gap.id === "no-certifications",
    );
    expect(certifications).toBeDefined();
    // The vocabulary is required here, not merely tolerated: the page has to
    // say the words a reviewer will search for, and say "no" next to them.
    expect(
      attestationVocabularyHits(certifications?.statement ?? ""),
    ).not.toEqual([]);
    expect(certifications?.gate).toBe("EXT-LEGAL-01");
  });

  it("refuses to present the integration list as a subprocessor schedule", () => {
    const disclaimer = trustGaps.find(
      (gap) => gap.id === "not-a-subprocessor-schedule",
    );
    expect(disclaimer?.statement).toContain("not a subprocessor schedule");
    expect(disclaimer?.gate).toBe("EXT-LEGAL-01");
  });
});

/**
 * The whole tracked tree, read once. `git ls-files` rather than a directory
 * walk so that build output, caches and anything else ignored cannot dilute the
 * denominator and make a common word look rare.
 */
const trackedFiles: readonly { path: string; contents: string }[] =
  execFileSync("git", ["ls-files", "-z"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter(Boolean)
    .flatMap((path) => {
      try {
        return [{ path, contents: readFileSync(join(repositoryRoot, path)) }];
      } catch {
        // A submodule or a path removed since the index was written.
        return [];
      }
    })
    .map((file) => ({
      path: file.path,
      contents: file.contents.toString("utf8"),
    }));

describe("a cited token has to name one implementation", () => {
  /**
   * WHY THIS EXISTS. Requiring a token to be present in a cited file stops a
   * dead citation and nothing else. "name" is present in `package.json`, and it
   * is present in 520 of the 1187 tracked files, so citing it says only that
   * the repository has files in it. Both fabricated controls used exactly that.
   *
   * CONFIRMED TO FAIL AGAINST THE FABRICATION. Re-appending both invented
   * controls with `evidencePath: "package.json", token: "name"` fails this
   * block twice, once per control, with:
   *   'encryption-at-rest cites "name", which appears in 523 of 1187 tracked
   *    files (44.1%). A citation has to name one implementation; the ceiling is
   *    5%.'
   * The counts move with the tree -- the same injection reported 521 an hour
   * earlier -- so read them as the order of magnitude they are: "name" is in
   * something like two files in five, and no token this register cites is in
   * more than one in thirty. Every real control, integration, unselected
   * integration and gap passes, so this is not a test that merely dislikes new
   * rows.
   */
  it.each(everyCitedEntry.map((entry) => [entry.id, entry] as const))(
    "%s cites a token distinctive enough to be evidence",
    (id, entry) => {
      const matches = trackedFiles.filter((file) =>
        file.contents.includes(entry.token),
      ).length;
      const share = matches / trackedFiles.length;
      expect(
        share,
        `${id} cites ${JSON.stringify(entry.token)}, which appears in ${matches} of ${trackedFiles.length} tracked files (${(share * 100).toFixed(1)}%). A citation has to name one implementation; the ceiling is ${tokenDistinctivenessCeiling * 100}%.`,
      ).toBeLessThanOrEqual(tokenDistinctivenessCeiling);
    },
  );

  it("would refuse the token the fabricated controls used", () => {
    // The guard above is only as good as the fact that "name" really is that
    // common. Asserting it here means the block cannot quietly stop biting
    // because the tree changed shape.
    const matches = trackedFiles.filter((file) =>
      file.contents.includes("name"),
    ).length;
    expect(matches / trackedFiles.length).toBeGreaterThan(
      tokenDistinctivenessCeiling,
    );
  });
});

describe("a quantity a statement asserts has to appear in what it cites", () => {
  /**
   * The check that kills an invented specification. A fabricated control is
   * almost always fabricated in numbers -- AES-256, FIPS 140-2 Level 3, 90-day
   * rotation, 99.99 per cent, a 5-minute RPO -- and none of those numbers can
   * be anywhere near the file the fabrication points at, because the thing does
   * not exist.
   *
   * CONFIRMED TO FAIL AGAINST THE FABRICATION. With both invented controls
   * appended this block fails twice:
   *   'encryption-at-rest asserts "AES-256", which appears in none of the files
   *    it cites (package.json)'
   *   'high-availability asserts "99.99", which appears in none of the files it
   *    cites (package.json)'
   *
   * WHAT IT DOES NOT CATCH, SAID PLAINLY BECAUSE THE PAGE SAYS IT TOO. A
   * fabrication with no numbers in it, citing a rare token in an unrelated
   * file, passes every check in this file. `trust-page.tsx` states the checks
   * one by one and states that the fit between a sentence and the code it
   * points at is a human judgement. Do not restore a summary sentence here or
   * there that implies otherwise.
   */
  const statementEntries = [
    ...trustControls.map((control) => ({
      id: control.id,
      statement: control.statement,
      paths: [
        control.evidencePath,
        ...(control.alsoCites ?? []).map((citation) => citation.path),
      ],
    })),
    ...trustGaps.map((gap) => ({
      id: gap.id,
      statement: gap.statement,
      paths: [gap.evidencePath],
    })),
  ];

  it.each(statementEntries.map((entry) => [entry.id, entry] as const))(
    "%s asserts no quantity its evidence does not carry",
    (id, entry) => {
      const evidence = entry.paths.map((path) => read(path)).join("\n");
      for (const claim of quantitativeClaims(entry.statement))
        expect(
          corroboratesClaim(evidence, claim),
          `${id} asserts ${JSON.stringify(claim)}, which appears in none of the files it cites (${entry.paths.join(", ")})`,
        ).toBe(true);
    },
  );

  it("reads a fabricated specification as a set of claims to check", () => {
    // Guard the guard: if `quantitativeClaims` ever stopped seeing the numbers
    // in a sentence like this, every assertion above would pass vacuously.
    expect(
      quantitativeClaims(
        "AES-256 with customer-managed keys in a FIPS 140-2 Level 3 HSM, automatic 90-day rotation",
      ),
    ).toEqual(["AES-256", "140-2", "90"]);
    expect(
      quantitativeClaims(
        "three availability zones, 99.99 per cent uptime commitment, 5-minute RPO",
      ),
    ).toEqual(["99.99"]);
    expect(corroboratesClaim("const sha256 = 1;", "SHA-256")).toBe(true);
    // The file the fabrications pointed at, checked against the number they
    // led with.
    expect(corroboratesClaim(read("package.json"), "AES-256")).toBe(false);
  });
});
