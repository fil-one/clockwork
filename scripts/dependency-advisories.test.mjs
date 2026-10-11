import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";

const execFileAsync = promisify(execFile);
const workspaceRoot = fileURLToPath(new URL("../", import.meta.url));

// Advisories we have looked at and cannot close from this repository. Every
// entry needs a reason. These same identifiers are listed in `pnpm.auditConfig.
// ignoreGhsas`; a test below holds the two lists together, so silencing an
// advisory in the manifest without recording why fails the suite.
const acceptedAdvisories = new Map([
  [
    "GHSA-6qxp-vccf-f47h",
    "@modelcontextprotocol/sdk OAuth client could send stored credentials to an authorization server the MCP server names; fixed in 1.31.0, which is not yet two weeks old (released 2026-09-28). The advisory states MCP servers built with the SDK are not affected. Commerce uses only the SDK's server and web-standard transport for /api/mcp and never imports its client or OAuth code; a check below fails if any source file does. Upgrade to 1.31.0 or later and drop this entry once it is two weeks old.",
  ],
  [
    "GHSA-vfj7-8cjw-p6xm",
    "braces deeply nested glob stack exhaustion: no published fix through 3.0.3. Reached only through root development dependencies (Netlify CLI and Secretlint via micromatch/fast-glob). Commerce accepts no untrusted glob patterns through those tools, and the package is absent from the production dependency graph. A regression check below fails if it becomes a production dependency.",
  ],
  [
    "GHSA-86w9-cpqp-85rv",
    "node-forge RSA verification: no published fix through 1.4.0. Reached only through netlify-cli > @netlify/dev > @netlify/images > ipx > listhen for local development certificates; it is not Commerce authentication, PDF signing, or the production runtime. No untrusted signatures are verified through that development certificate generator.",
  ],
  [
    "GHSA-7pqw-9j4j-h8q3",
    "extract-zip arbitrary writes via symlink entries: no fixed published release (<=2.0.1). Same build-only Netlify emulator dependency as GHSA-jmr9-qjv8-65gv; the deployment builds trusted repository sources and never extracts untrusted function archives.",
  ],
  [
    "GHSA-jmr9-qjv8-65gv",
    "extract-zip symlink traversal: every published version (<=2.0.1) is vulnerable and npm reports the patched range as `<0.0.0`, so no upgrade exists. Reached through the pinned netlify-cli > @netlify/dev > @netlify/functions-dev local zipped-function emulator; Clockwork's deploy workflow builds and publishes the repository and does not extract untrusted function archives.",
  ],
]);

// Transitives we do not control directly, held at a fixed version by the
// `pnpm.overrides` block. If an override is dropped the resolved version slides
// back under the advisory's vulnerable range and this catches it.
const pinnedTransitives = [
  {
    name: "@fastify/busboy",
    minimum: "3.2.2",
    override: "@fastify/busboy@<3.2.2",
  },
  { name: "fastify", minimum: "5.12.5", override: "fastify@<5.12.5" },
  { name: "js-yaml", minimum: "4.3.2", override: "js-yaml@<4.3.2" },
  { name: "nanoid", minimum: "3.3.18", override: "nanoid@<3.3.18" },
  // image-size fixed its ICNS and JXL/HEIF infinite loops in 2.0.3 (Codeberg,
  // where the project moved); GitHub's advisory data still reports no patched
  // range, so pnpm audit needs the override to see the fix.
  { name: "image-size", minimum: "2.0.4", override: "image-size@<2.0.4" },
  { name: "sharp", minimum: "0.35.5", override: "sharp@<0.35.5" },
  { name: "proxy-addr", minimum: "2.0.8", override: "proxy-addr@<2.0.8" },
  {
    name: "source-map-js",
    minimum: "1.2.2",
    override: "source-map-js@<1.2.2",
  },
  { name: "smol-toml", minimum: "1.9.0", override: "smol-toml@<1.9.0" },
];

// Direct catalog dependency, upgraded rather than overridden.
const catalogFloors = [{ name: "hono", minimum: "4.13.7" }];

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
  const pattern = new RegExp(
    `^ {2}['"]?${name}@(\\d+\\.\\d+\\.\\d+)['"]?[:(]`,
    "gm",
  );
  return [...lockfile.matchAll(pattern)].map((match) => match[1]);
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

test("every silenced advisory carries a recorded reason", async () => {
  const manifest = JSON.parse(
    await readFile(`${workspaceRoot}package.json`, "utf8"),
  );
  assert.deepEqual(
    [...(manifest.pnpm.auditConfig?.ignoreGhsas ?? [])].sort(),
    [...acceptedAdvisories.keys()].sort(),
    "pnpm.auditConfig.ignoreGhsas and acceptedAdvisories must name the same advisories",
  );
  for (const [id, reason] of acceptedAdvisories) {
    assert.ok(
      reason.trim().length > 0,
      `${id} is silenced with no recorded reason`,
    );
  }
});

test("the unpatched braces package stays outside production dependencies", async () => {
  const { stdout } = await execFileAsync(
    "pnpm",
    ["why", "-r", "--prod", "braces", "--json"],
    { cwd: workspaceRoot, maxBuffer: 8 * 1024 * 1024 },
  );
  assert.deepEqual(
    JSON.parse(stdout),
    [],
    "Re-review GHSA-vfj7-8cjw-p6xm: braces must not enter the production dependency graph",
  );
});

test("the MCP SDK's client and OAuth code stay unused while its advisory is accepted", async () => {
  const { stdout } = await execFileAsync(
    "git",
    [
      "grep",
      "-l",
      "-E",
      "@modelcontextprotocol/sdk/(client|server/auth|shared/auth)",
      "--",
      "apps",
      "packages",
    ],
    { cwd: workspaceRoot },
  ).catch((error) => {
    // git grep exits 1 when nothing matches.
    if (error.code === 1) return { stdout: "" };
    throw error;
  });
  assert.equal(
    stdout.trim(),
    "",
    "Re-review GHSA-6qxp-vccf-f47h: Commerce must not use the MCP SDK client or OAuth code",
  );
});

test("the MCP SDK advisory acceptance expires on 2026-10-26", async () => {
  const versions = await resolvedVersions("@modelcontextprotocol/sdk");
  assert.ok(versions.length > 0, "@modelcontextprotocol/sdk is missing");
  const unpatched = versions.filter(
    (version) => compareSemver(version, "1.31.0") < 0,
  );
  if (unpatched.length === 0) return;
  assert.ok(
    Date.now() < Date.parse("2026-10-27T00:00:00Z"),
    `@modelcontextprotocol/sdk@${unpatched.join(", ")} is still below 1.31.0: upgrade it (1.31.0 is two weeks old from 2026-10-12) and drop GHSA-6qxp-vccf-f47h`,
  );
});
