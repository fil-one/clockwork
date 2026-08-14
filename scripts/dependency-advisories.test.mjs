import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";

const execFileAsync = promisify(execFile);
const workspaceRoot = fileURLToPath(new URL("../", import.meta.url));

// Advisories we have looked at and cannot close from this repository. Every
// entry needs a reason, because the backlog claim is that no advisory is left
// unexplained. These same identifiers are listed in `pnpm.auditConfig.
// ignoreGhsas` so `pnpm audit --audit-level=high` exits zero; the first test
// below holds the two lists together, so silencing an advisory in the manifest
// without recording why fails the suite.
const acceptedHighAdvisories = new Map([
  [
    "GHSA-w3rx-r6r6-pgpr",
    "image-size ICNS infinite loop: every published version (<=2.0.2) is vulnerable and npm reports the patched range as `<0.0.0`, so no upgrade or override exists. Reached only through apps/web > @storybook/nextjs-vite > vite-plugin-storybook-nextjs, which is Storybook build tooling and never parses untrusted images at runtime.",
  ],
  [
    "GHSA-5p2g-fcmc-qvqq",
    "image-size JXL/HEIF infinite loop: same package, same absent patched range, same build-only reach.",
  ],
]);

// Transitives we do not control directly, held at a fixed version by the
// `pnpm.overrides` block. If an override is dropped the resolved version slides
// back under the advisory's vulnerable range and this catches it.
const pinnedTransitives = [
  { name: "js-yaml", minimum: "4.3.1", override: "js-yaml@<4.3.1" },
  { name: "nanoid", minimum: "3.3.18", override: "nanoid@<3.3.18" },
];

// Direct catalog dependency, upgraded rather than overridden.
const catalogFloors = [{ name: "hono", minimum: "4.12.34" }];

// The accepted advisories are accepted only because the package has no fixed
// release at all. That is a fact about the registry, not about this repository,
// so it is checked against the registry rather than asserted once and trusted:
// the day image-size publishes anything above this, the acceptance expires.
const unpatchedPackages = [{ name: "image-size", highestPublished: "2.0.2" }];

function compareSemver(left, right) {
  const parse = (value) => value.split(".").map((part) => Number(part));
  const [leftParts, rightParts] = [parse(left), parse(right)];
  for (let index = 0; index < 3; index += 1) {
    const difference = leftParts[index] - rightParts[index];
    if (difference !== 0) return difference;
  }
  return 0;
}

// Lockfile package keys look like `  nanoid@3.3.18:` at the top of the
// `packages:` section. Prereleases and peer-suffixed keys are not in play for
// the packages checked here.
async function resolvedVersions(name) {
  const lockfile = await readFile(`${workspaceRoot}pnpm-lock.yaml`, "utf8");
  const pattern = new RegExp(`^ {2}${name}@(\\d+\\.\\d+\\.\\d+)[:(]`, "gm");
  return [...lockfile.matchAll(pattern)].map((match) => match[1]);
}

async function auditReport() {
  try {
    // `pnpm audit` exits non-zero whenever it finds anything, so the report
    // arrives on the error object rather than as a resolved value.
    const { stdout } = await execFileAsync("pnpm", ["audit", "--json"], {
      cwd: workspaceRoot,
      maxBuffer: 32 * 1024 * 1024,
    });
    return JSON.parse(stdout);
  } catch (error) {
    if (typeof error?.stdout === "string" && error.stdout.trim().length > 0) {
      try {
        return JSON.parse(error.stdout);
      } catch {
        // Fall through: the registry is unreachable and stdout is not a report.
      }
    }
    return null;
  }
}

test("overridden transitives resolve above their advisory floor", async () => {
  const manifest = JSON.parse(
    await readFile(`${workspaceRoot}package.json`, "utf8"),
  );
  for (const { name, minimum, override } of pinnedTransitives) {
    assert.equal(
      manifest.pnpm.overrides[override],
      minimum,
      `pnpm.overrides must keep "${override}" pinned to ${minimum}`,
    );
    const versions = await resolvedVersions(name);
    assert.ok(versions.length > 0, `${name} is missing from pnpm-lock.yaml`);
    for (const version of versions) {
      assert.ok(
        compareSemver(version, minimum) >= 0,
        `${name}@${version} is below the patched floor ${minimum}`,
      );
    }
  }
});

test("catalog dependencies resolve above their advisory floor", async () => {
  for (const { name, minimum } of catalogFloors) {
    const versions = await resolvedVersions(name);
    assert.ok(versions.length > 0, `${name} is missing from pnpm-lock.yaml`);
    for (const version of versions) {
      assert.ok(
        compareSemver(version, minimum) >= 0,
        `${name}@${version} is below the patched floor ${minimum}`,
      );
    }
  }
});

test("audit reports only accepted high advisories", async (t) => {
  const report = await auditReport();
  if (report === null) {
    // Offline runs cannot reach the advisory database. The two lockfile tests
    // above still hold the line on everything we have already fixed.
    t.skip("pnpm audit could not reach the registry");
    return;
  }

  const reported = new Map();
  for (const advisory of Object.values(report.advisories ?? {})) {
    if (advisory.severity !== "high" && advisory.severity !== "critical")
      continue;
    reported.set(
      advisory.github_advisory_id,
      `${advisory.module_name}: ${advisory.title}`,
    );
  }

  // `pnpm.auditConfig.ignoreGhsas` filters the accepted identifiers out of this
  // report, so whatever remains is by definition unexplained.
  const unexplained = [...reported].map(
    ([id, description]) => `${id} ${description}`,
  );
  assert.deepEqual(
    unexplained,
    [],
    "new high advisory with no recorded decision; fix it or record why it cannot be fixed",
  );
});

test("every silenced advisory carries a recorded reason", async () => {
  const manifest = JSON.parse(
    await readFile(`${workspaceRoot}package.json`, "utf8"),
  );
  assert.deepEqual(
    [...(manifest.pnpm.auditConfig?.ignoreGhsas ?? [])].sort(),
    [...acceptedHighAdvisories.keys()].sort(),
    "pnpm.auditConfig.ignoreGhsas and acceptedHighAdvisories must name the same advisories",
  );
  for (const [id, reason] of acceptedHighAdvisories) {
    assert.ok(
      reason.trim().length > 0,
      `${id} is silenced with no recorded reason`,
    );
  }
});

test("accepted advisories still have no published fix", async (t) => {
  for (const { name, highestPublished } of unpatchedPackages) {
    let published;
    try {
      const { stdout } = await execFileAsync(
        "pnpm",
        ["view", name, "versions", "--json"],
        { cwd: workspaceRoot, maxBuffer: 8 * 1024 * 1024 },
      );
      published = JSON.parse(stdout);
    } catch {
      t.skip(`could not reach the registry for ${name}`);
      return;
    }
    // Prereleases are not a fix we would adopt, so they are not a trigger.
    const releases = published.filter((version) =>
      /^\d+\.\d+\.\d+$/.test(version),
    );
    const newest = releases.reduce((highest, version) =>
      compareSemver(version, highest) > 0 ? version : highest,
    );
    assert.ok(
      compareSemver(newest, highestPublished) <= 0,
      `${name}@${newest} is newer than the ${highestPublished} that justified accepting its advisory; re-review the acceptance and upgrade`,
    );
  }
});
