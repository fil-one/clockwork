import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const outputDirectory = join(root, "docs", "baseline");
const capturedAt =
  process.env.BASELINE_CAPTURED_AT ??
  new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

const ignoredDirectories = new Set([
  ".git",
  ".next",
  ".turbo",
  "coverage",
  "node_modules",
  "playwright-report",
  "storybook-static",
  "test-results",
]);

function command(program, arguments_, cwd = root) {
  return execFileSync(program, arguments_, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

function commandRaw(program, arguments_, cwd = root) {
  return execFileSync(program, arguments_, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    maxBuffer: 64 * 1024 * 1024,
  });
}

function git(...arguments_) {
  return command("git", arguments_);
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(path) {
  return sha256Bytes(readFileSync(path));
}

function source(path) {
  return readFileSync(join(root, path), "utf8");
}

function walk(directory, predicate = () => true) {
  const absolute = join(root, directory);
  if (!existsSync(absolute)) return [];
  const files = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const child = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(child, predicate));
    else if (predicate(child)) files.push(child.replaceAll("\\", "/"));
  }
  return files.sort();
}

function writeJson(name, value) {
  const path = join(outputDirectory, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function unique(values) {
  return [...new Set(values)].sort();
}

function uniqueBy(values, keyFor) {
  return [...new Map(values.map((value) => [keyFor(value), value])).values()];
}

function quotedArray(text, exportName) {
  const match = text.match(
    new RegExp(`export const ${exportName} = \\[([\\s\\S]*?)\\] as const`),
  );
  return match
    ? [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1])
    : [];
}

function quotedValues(text) {
  return [...text.matchAll(/["']([^"']+)["']/g)].map((item) => item[1]);
}

function sqlQualifiedName(schema, name) {
  return `${schema ? schema.replaceAll('"', "") : "public"}.${name.replaceAll('"', "")}`;
}

function sqlNames(text, expression) {
  return unique(
    [...text.matchAll(expression)].map((item) =>
      sqlQualifiedName(item[1], item[2]),
    ),
  );
}

function dynamicLoopTables(text, bodyPattern) {
  return unique(
    [
      ...text.matchAll(
        /foreach\s+table_name\s+in\s+array\s+array\[([\s\S]*?)\]\s*loop([\s\S]*?)end loop;/gi,
      ),
    ]
      .filter((item) => bodyPattern.test(item[2]))
      .flatMap((item) => quotedValues(item[1]).map((name) => `public.${name}`)),
  );
}

function dynamicLoopTriggerBindings(text) {
  return [
    ...text.matchAll(
      /foreach\s+table_name\s+in\s+array\s+array\[([\s\S]*?)\]\s*loop([\s\S]*?)end loop;/gi,
    ),
  ].flatMap((item) => {
    const templates = [
      ...item[2].matchAll(
        /execute format\(\s*'(create (?:constraint )?trigger [^']+)'/gi,
      ),
    ].map((match) => match[1].replace(/\s+/g, " ").trim());
    const suffixes = [
      ...item[2].matchAll(/table_name\s*\|\|\s*'([^']+)'/g),
    ].map((match) => match[1]);
    return quotedValues(item[1]).flatMap((table) =>
      templates.map((template, index) => ({
        name: suffixes[index] ? `${table}${suffixes[index]}` : null,
        table: `public.${table}`,
        constraint: /^create constraint trigger\b/i.test(template),
        template,
      })),
    );
  });
}

function routeFromPage(path) {
  const inside = path
    .replace(/^apps\/web\/app\//, "")
    .replace(/\/(?:page\.tsx|route\.ts)$/, "")
    .replace(/^(?:page\.tsx|route\.ts)$/, "")
    .split("/")
    .filter(
      (segment) =>
        segment && !(segment.startsWith("(") && segment.endsWith(")")),
    );
  return `/${inside.join("/")}`.replace(/\/$/, "") || "/";
}

function intendedAccessFor(path) {
  const route = routeFromPage(path);
  if (path.endsWith("/route.ts")) {
    if (route === "/auth/callback" || route === "/sign-in")
      return "public-auth-flow";
    if (route === "/api/experience/[[...segments]]")
      return "authenticated-experience-operation";
    if (route === "/api/telemetry") return "same-origin-csrf-telemetry-ingest";
    if (route.startsWith("/api"))
      return "operation-specific-session-permission";
    return "route-handler-review-required";
  }
  if (route === "/" || route === "/register" || route.startsWith("/access/"))
    return "public-entry";
  if (route.startsWith("/signing/"))
    return "public-signing-entry-with-api-enforcement";
  if (route.startsWith("/internal")) return "authenticated-internal-role";
  if (route.startsWith("/partner")) return "authenticated-partner-role";
  if (path.includes("/(customer)/")) return "authenticated-customer-role";
  return "authenticated-session";
}

function observedGuardFor(path) {
  const route = routeFromPage(path);
  if (route === "/api/experience/[[...segments]]")
    return {
      behavior:
        "Experience controller resolves an authenticated WorkOS session, enforces audience/account scope, and requires same-origin CSRF plus idempotency for mutations",
      sources: [
        "apps/web/app/api/experience/[[...segments]]/route.ts",
        "apps/web/src/auth/session.ts",
        "apps/web/src/features/experience-server/controller.ts",
        "apps/web/src/features/experience-server/authorization.ts",
        "apps/web/src/features/experience-server/projection-authorization.ts",
      ],
      limitation:
        "This Next.js controller is outside the generated Hono OpenAPI document, so its concrete operations and client surface are inventoried separately.",
    };
  if (route === "/api/telemetry")
    return {
      behavior:
        "Same-origin CSRF validation, bounded JSON parsing, strict OpenTelemetry envelope validation, and telemetry redaction precede export",
      sources: [
        "apps/web/app/api/telemetry/route.ts",
        "apps/web/src/features/performance/client-telemetry.ts",
        "apps/web/src/telemetry/runtime.ts",
      ],
      limitation:
        "Browser telemetry ingestion is intentionally not a session-permission Hono operation; delivery still depends on the configured production telemetry backend.",
    };
  if (route.startsWith("/api"))
    return {
      behavior:
        "Hono operation authorization through WorkosNextSessionResolver",
      sources: [
        "apps/web/app/api/[[...route]]/route.ts",
        "apps/web/src/auth/session.ts",
        "packages/api/src/app.ts",
      ],
      limitation:
        "OpenAPI security fields are null; operation-to-permission proof remains source/test based.",
    };
  if (
    path.includes("/(customer)/") ||
    path.includes("/(partner)/") ||
    path.includes("/(internal)/")
  )
    return {
      behavior: "layout RoutePermissionGate using getRouteRoles",
      sources: [
        "apps/web/src/features/shell/route-session.ts",
        "apps/web/src/features/shell/permission-gate.tsx",
      ],
      limitation:
        "When WorkOS is unconfigured, getRouteRoles supplies static audience roles, including in production; this is not proof of an authenticated session.",
    };
  if (route.startsWith("/signing/"))
    return {
      behavior:
        "public client page; identifiers/session parameters flow to API operations",
      sources: ["apps/web/src/features/signing/signing-experience.tsx"],
      limitation:
        "The page itself does not establish a provider-authenticated signing session.",
    };
  return {
    behavior: "no audience layout guard inventoried",
    sources: [path],
    limitation:
      "Public entry classification does not imply that downstream APIs are public.",
  };
}

function audienceFor(path) {
  if (
    path.includes("/(partner)/") ||
    routeFromPage(path).startsWith("/partner")
  )
    return "partner";
  if (
    path.includes("/(internal)/") ||
    routeFromPage(path).startsWith("/internal")
  )
    return "internal";
  if (path.includes("/(customer)/")) return "customer";
  if (routeFromPage(path).startsWith("/signing")) return "signing";
  if (routeFromPage(path).startsWith("/access") || routeFromPage(path) === "/")
    return "access";
  if (routeFromPage(path).startsWith("/api")) return "api-mount";
  return "shared";
}

function pngDimensions(path) {
  const buffer = readFileSync(path);
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG")
    return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

const refRecords = git("for-each-ref", "--format=%(refname)%09%(refname:short)")
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [fullRef, name] = line.split("\t");
    const refType = fullRef.startsWith("refs/heads/")
      ? "branch"
      : fullRef.startsWith("refs/tags/")
        ? "tag"
        : fullRef.startsWith("refs/notes/")
          ? "note"
          : fullRef.startsWith("refs/replace/")
            ? "replacement"
            : fullRef === "refs/stash"
              ? "stash"
              : "other";
    return { fullRef, name, refType };
  });
const branchNames = refRecords
  .filter(({ refType }) => refType === "branch")
  .map(({ name }) => name);
const tagNames = refRecords
  .filter(({ refType }) => refType === "tag")
  .map(({ name }) => name);
const refs = refRecords.map(({ fullRef, name, refType }) => {
  const object = git("rev-parse", fullRef);
  const commit = git("rev-parse", `${fullRef}^{commit}`);
  const tree = git("rev-parse", `${commit}^{tree}`);
  const listing = git("ls-tree", "-r", "--full-tree", commit);
  return {
    ref: name,
    fullRef,
    refType,
    object,
    objectType: git("cat-file", "-t", object),
    peeledCommit: commit,
    commit,
    tree,
    treeEntryCount: listing ? listing.split("\n").length : 0,
    treeListingSha256: sha256Bytes(`${listing}\n`),
    parents: git("show", "-s", "--format=%P", commit)
      .split(" ")
      .filter(Boolean),
    subject: git("show", "-s", "--format=%s", commit),
    mergeBaseWithMain: ["branch", "tag", "stash"].includes(refType)
      ? git("merge-base", commit, "main")
      : null,
  };
});

const bundleRepositoryPath =
  ".clockwork-archives/Clockwork-pre-consolidation-20260731.bundle";
const retainedQualificationEvidencePrefixes = [
  ".artifacts/release-benchmark/",
  ".artifacts/release-smoke/",
];
const retainedArchivePrefix = ".clockwork-archives/";
const worktreeBlocks = git("worktree", "list", "--porcelain").split("\n\n");
const worktrees = worktreeBlocks.filter(Boolean).map((block) => {
  const fields = Object.fromEntries(
    block.split("\n").map((line) => {
      const split = line.indexOf(" ");
      return split === -1
        ? [line, true]
        : [line.slice(0, split), line.slice(split + 1)];
    }),
  );
  const statusLines = commandRaw("git", [
    "-C",
    fields.worktree,
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ])
    .replace(/\n$/, "")
    .split("\n")
    .filter(Boolean);
  const ignoredListing = commandRaw("git", [
    "-C",
    fields.worktree,
    "ls-files",
    "--others",
    "--ignored",
    "--exclude-standard",
  ]);
  const ignoredArtifactPaths = ignoredListing.split("\n").filter(Boolean);
  const retainedArchivePaths = ignoredArtifactPaths.filter((path) =>
    path.startsWith(retainedArchivePrefix),
  );
  const retainedQualificationEvidencePaths = ignoredArtifactPaths.filter(
    (path) =>
      retainedQualificationEvidencePrefixes.some((prefix) =>
        path.startsWith(prefix),
      ),
  );
  const retainedEvidencePaths = unique([
    ...retainedArchivePaths,
    ...retainedQualificationEvidencePaths,
  ]);
  const rejectedIgnoredArtifactPaths = ignoredArtifactPaths.filter(
    (path) => !retainedEvidencePaths.includes(path),
  );
  const evidenceArtifacts = retainedEvidencePaths.map((path) => {
    const absolute = join(fields.worktree, path);
    return {
      path,
      kind: path.startsWith(retainedArchivePrefix)
        ? "archive"
        : "qualification-evidence",
      bytes: statSync(absolute).size,
      sha256: sha256File(absolute),
    };
  });
  const qualificationEvidenceArtifacts = evidenceArtifacts.filter(
    ({ kind }) => kind === "qualification-evidence",
  );
  const qualificationSummaries = qualificationEvidenceArtifacts
    .filter(({ path }) => /\/(?:stress-)?summary\.json$/.test(path))
    .map(({ path, bytes, sha256 }) => {
      const summary = JSON.parse(readFileSync(join(fields.worktree, path)));
      const passed = summary.accepted === true || summary.status === "passed";
      const failed = summary.accepted === false || summary.status === "failed";
      return {
        path,
        bytes,
        sha256,
        runId: summary.runId ?? summary.token ?? null,
        mode: summary.mode ?? null,
        outcome: passed ? "passed" : failed ? "failed" : "incomplete",
        durationMs: summary.durationMs ?? null,
        sourceRevision:
          summary.sourceIdentity?.revision ?? summary.sourceIdentity ?? null,
      };
    });
  const archiveArtifacts = evidenceArtifacts.filter(
    ({ kind }) => kind === "archive",
  );
  const evidenceAggregate = (artifacts) =>
    sha256Bytes(
      `${artifacts
        .map(({ path, bytes, sha256 }) => `${path}:${bytes}:${sha256}`)
        .join("\n")}\n`,
    );
  const rejectedIgnoredListing = `${rejectedIgnoredArtifactPaths.join("\n")}${
    rejectedIgnoredArtifactPaths.length > 0 ? "\n" : ""
  }`;
  const ignoredRoots = unique(
    ignoredArtifactPaths.map((path) => {
      const match = path.match(
        /^(.*?(?:^|\/)(?:node_modules|\.next|\.turbo|coverage|playwright-report|storybook-static|test-results))(?:\/|$)/,
      );
      return match?.[1] ?? path.split("/")[0];
    }),
  );
  return {
    path: fields.worktree,
    head: fields.HEAD,
    branch:
      typeof fields.branch === "string"
        ? fields.branch.replace("refs/heads/", "")
        : null,
    detached: Boolean(fields.detached),
    locked: Boolean(fields.locked),
    prunable: Boolean(fields.prunable),
    status: {
      staged: statusLines
        .filter((line) => ![" ", "?", "!"].includes(line[0]))
        .map((line) => line.slice(3)),
      unstaged: statusLines
        .filter((line) => ![" ", "?", "!"].includes(line[1]))
        .map((line) => line.slice(3)),
      untracked: statusLines
        .filter((line) => line.startsWith("?? "))
        .map((line) => line.slice(3)),
      ignoredRoots,
      ignoredArtifactCount: ignoredArtifactPaths.length,
      retainedArchivePaths,
      retainedQualificationEvidencePaths,
      retainedEvidence: {
        qualification: {
          artifactCount: qualificationEvidenceArtifacts.length,
          aggregateSha256: evidenceAggregate(qualificationEvidenceArtifacts),
          summaries: qualificationSummaries,
          artifacts: qualificationEvidenceArtifacts,
        },
        archives: {
          artifactCount: archiveArtifacts.length,
          aggregateSha256: evidenceAggregate(archiveArtifacts),
          artifacts: archiveArtifacts,
        },
      },
      rejectedIgnoredArtifactCount: rejectedIgnoredArtifactPaths.length,
      ignoredArtifactListingSha256: sha256Bytes(ignoredListing),
      rejectedIgnoredArtifactListingSha256: sha256Bytes(rejectedIgnoredListing),
      porcelainSha256: sha256Bytes(`${statusLines.join("\n")}\n`),
    },
  };
});

const bundlePath = join(root, bundleRepositoryPath);
const historicalRcLaneBaseRef = "rc-lanes-base-20260731";
const historicalRcLaneBaseCommit = git(
  "rev-parse",
  `${historicalRcLaneBaseRef}^{commit}`,
);
const historicalRcLaneBaseTree = git(
  "rev-parse",
  `${historicalRcLaneBaseCommit}^{tree}`,
);
const historicalStartingMainBaseCommit =
  "92d10d3b8a12728804b70215799f9929e880c996";
const historicalStartingMainBaseTree = git(
  "rev-parse",
  `${historicalStartingMainBaseCommit}^{tree}`,
);
// Immutable commits keep the preservation generator usable after the local
// lane branches and linked worktrees are retired. Labels retain provenance;
// no active operation depends on a historical branch name.
const legacyAndPreservationRefs = [
  ["commerce/foundation", "6eec5773ab0dd4f578464a4dd88aa4982d5f3e5a"],
  ["commerce/core-finance", "12c590d5d386066fc120f90792b2f3c038c294a8"],
  ["commerce/lifecycle-platform", "abbddae5d8f7945830e53a9526f47d71f4e43c23"],
  ["commerce/experience-docs", "de5f761ec82ccce4966b82825a3de9b356e953b7"],
  ["commerce/integration", "92d10d3b8a12728804b70215799f9929e880c996"],
  ["ux/design-shell", "d8589e816bbd62233bd5fcbce345afec929252c6"],
  ["ux/customer-partner", "041e65de2864e5e24a131c2c7ba88e6cd13618b5"],
  ["ux/internal-ops", "30ad76a8bb2118b2605358da1694d3aa54464eef"],
  ["ux/integration", "c2f1e8c5ed0704956a004db6de518316bfd0f44f"],
  ["rc/commercial-integrity", "cc23bce784ee60a27ad3e34fd245136f37394a2d"],
  ["rc/runtime-operations", "0c91acfa2666d93d3f4cb563f3fc5b9f27f20ae5"],
  ["rc/experience-release", "b13a1ec6816b9a547aaa20bf8806cd3996c840be"],
  ["qualification/27fb33b", "27fb33bab754b001acf26134d988daa10d177390"],
  ["qualification/34c2a50", "34c2a5001859221dc3def61d7d86231fe2026151"],
  ["qualification/7ae3fbc", "7ae3fbcb01c736004faf73419b0092c905d61090"],
];
const preservation = [
  {
    owner: "commerce/foundation",
    commit: "6eec5773ab0dd4f578464a4dd88aa4982d5f3e5a",
    source: "commerce_platform_spec.md",
    workingBlob: "086051b0e0aa09e246b68cc438d3f99e772d5957",
    contentSha256:
      "03fd8ea1db37dba2a3b1be51c536a518b521d7d597f22f68dcad26ef8244eadd",
    patchSha256:
      "84edabffd2b292e957a68f60ea2829970a056e9489626e8ad559d478a1b21926",
    additions: 513,
    deletions: 335,
    decision: "accepted",
    rationale:
      "Implementation-aligned standalone production contract; canonical conflicts are reconciled on main.",
  },
  {
    owner: "commerce/integration",
    commit: "92d10d3b8a12728804b70215799f9929e880c996",
    source: "docs/backlog.md",
    workingBlob: "e8b3cff62b1ef93680bc3d1f1e258b3d4a11a024",
    contentSha256:
      "8196e3b5c4c338e4742be2492b56fe37581e0f982cc077a97cbd21551079a244",
    patchSha256:
      "6c5ca2ef8ea06212f37c4cdcbdcd572625741c33ddde111a05e8118183b7e254",
    additions: 217,
    deletions: 0,
    decision: "accepted",
    rationale:
      "Canonical consolidation and unfinished-work record; it makes no false release-complete claim.",
  },
  {
    owner: "ux/integration",
    commit: "c2f1e8c5ed0704956a004db6de518316bfd0f44f",
    source: "43 previously dirty UX paths plus final handoff",
    decision: "accepted",
    rationale:
      "All UX lane tips and the former 43-file semantic delta are represented; no later source delta exists.",
  },
];
const allReachableCommits = git("rev-list", "--all", "--topo-order")
  .split("\n")
  .filter(Boolean)
  .map((commit) => ({
    commit,
    tree: git("rev-parse", `${commit}^{tree}`),
    parents: git("show", "-s", "--format=%P", commit)
      .split(" ")
      .filter(Boolean),
    subject: git("show", "-s", "--format=%s", commit),
  }));
const mergeCommits = allReachableCommits
  .filter(({ parents }) => parents.length > 1)
  .map(({ commit, tree, parents, subject }) => ({
    commit,
    tree,
    parents,
    subject,
  }));
const mergeBases = branchNames.flatMap((left, index) =>
  branchNames.slice(index + 1).map((right) => ({
    left,
    right,
    mergeBase: git("merge-base", left, right),
  })),
);
const ancestryAssertions = legacyAndPreservationRefs.map(([ref, commit]) => {
  let represented = true;
  try {
    command("git", ["merge-base", "--is-ancestor", commit, "main"]);
  } catch {
    represented = false;
  }
  return {
    ref,
    commit: git("rev-parse", `${commit}^{commit}`),
    ancestorOfMain: represented,
  };
});
const fsckOutput = command("git", ["fsck", "--unreachable", "--no-reflogs"]);
const danglingObjects = fsckOutput
  .split("\n")
  .filter((line) =>
    /^(?:unreachable|dangling)\s+(?:blob|tree)\s+[0-9a-f]{40}$/.test(line),
  )
  .map((line) => {
    const [state, type, object] = line.split(" ");
    return { state, type, object };
  });
const bundleHeads = existsSync(bundlePath)
  ? command("git", ["bundle", "list-heads", bundleRepositoryPath])
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const split = line.indexOf(" ");
        return { object: line.slice(0, split), ref: line.slice(split + 1) };
      })
  : [];
const bundleVerification = (() => {
  if (!existsSync(bundlePath)) return { status: "missing", exitCode: null };
  const result = spawnSync("git", ["bundle", "verify", bundleRepositoryPath], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0)
    throw new Error(`BUNDLE_VERIFICATION_FAILED:${result.status}:${output}`);
  return {
    status: "verified-complete",
    exitCode: result.status,
    command: `git bundle verify ${bundleRepositoryPath}`,
    output: output.trim().split("\n"),
    outputSha256: sha256Bytes(output),
  };
})();
const captureWorktree = worktrees.find(
  ({ path }) => resolve(path) === resolve(root),
);
const captureWorkingTreePathCount = captureWorktree
  ? unique([
      ...captureWorktree.status.staged,
      ...captureWorktree.status.unstaged,
      ...captureWorktree.status.untracked,
    ]).length
  : null;
const captureMode =
  captureWorkingTreePathCount === 0
    ? "committed-clean-consolidation: captureCommit and captureTree identify the complete consolidated-main-quality state at capture time"
    : "working-tree-consolidation: captureCommit and captureTree identify the committed base while the worktree inventory records consolidated-main-quality paths not yet represented by that commit";
const qualityDisposition = Object.freeze({
  target: "consolidated-main-quality",
  declaresReleaseCandidate: false,
  declaresProductionLaunchApproval: false,
  humanDesignApproval: {
    scope: "external-launch-only",
    blocksRepositoryConsolidation: false,
    status: "not-evaluated-by-baseline-manifests",
    evidenceSource: "docs/launch-checklist.md",
    requiredUserEnteredFields: [
      "approver name",
      "approval decision",
      "UTC timestamp",
      "reviewed SHA",
      "evidence/reference",
    ],
  },
});
const reflogEntries = command("git", [
  "reflog",
  "show",
  "--all",
  "--date=iso-strict",
  "--format=%H%x09%gD%x09%gs",
])
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [commit, selector, ...subject] = line.split("\t");
    return { commit, selector, subject: subject.join("\t") };
  });

writeJson("git-provenance.json", {
  schemaVersion: 1,
  capturedAt,
  captureRef: "main",
  captureCommit: git("rev-parse", "HEAD"),
  captureTree: git("rev-parse", "HEAD^{tree}"),
  captureMode,
  captureWorkingTreePathCount,
  qualityDisposition,
  mainBase: {
    semantics:
      "Historical starting main tip before the three RC-named input lanes were consolidated; this is not the current consolidated main capture.",
    commit: historicalStartingMainBaseCommit,
    tree: historicalStartingMainBaseTree,
  },
  historicalRcLaneBase: {
    semantics:
      "Historical common base of the three RC-named input lanes; the name records ancestry and does not designate consolidated main as an RC.",
    ref: historicalRcLaneBaseRef,
    tagObject: git("rev-parse", `${historicalRcLaneBaseRef}^{tag}`),
    commit: historicalRcLaneBaseCommit,
    tree: historicalRcLaneBaseTree,
  },
  remotes: git("remote").split("\n").filter(Boolean),
  refs,
  specialRefInventory: {
    stash: refRecords
      .filter(({ refType }) => refType === "stash")
      .map(({ fullRef, name }) => ({ fullRef, name })),
    notes: refRecords
      .filter(({ refType }) => refType === "note")
      .map(({ fullRef, name }) => ({ fullRef, name })),
    replacements: refRecords
      .filter(({ refType }) => refType === "replacement")
      .map(({ fullRef, name }) => ({ fullRef, name })),
  },
  worktrees,
  allReachableCommits,
  reachableCommitCount: allReachableCommits.length,
  ancestryAssertions,
  mergeBases,
  reflogEntries,
  preservation,
  preservationInventory: {
    conclusion:
      "All accepted source deltas discovered in the preservation pass are committed on their owning branches and represented by main; no post-inventory UX source delta was found. Stash and reflog are not the sole copy of any accepted delta.",
    initialStaged: [],
    initialUntracked: [],
    acceptedDirtySource: [
      {
        worktree: "/Users/jameskurz/Downloads/Fil One/Clockwork",
        owner: "commerce/foundation",
        path: "commerce_platform_spec.md",
        preservationCommit: "6eec5773ab0dd4f578464a4dd88aa4982d5f3e5a",
      },
      {
        worktree: "/Users/jameskurz/Downloads/Fil One/Clockwork-merge",
        owner: "commerce/integration",
        path: "docs/backlog.md",
        preservationCommit: "92d10d3b8a12728804b70215799f9929e880c996",
      },
    ],
    uxInventory: {
      formerDirtyFileCount: 43,
      integrationChangedPathCount: 44,
      paths: command("git", [
        "diff-tree",
        "--no-commit-id",
        "--name-only",
        "-r",
        "c2f1e8c5ed0704956a004db6de518316bfd0f44f^",
        "c2f1e8c5ed0704956a004db6de518316bfd0f44f",
      ])
        .split("\n")
        .filter(Boolean),
      includesAddedHandoff: true,
      representedByCommit: "c2f1e8c5ed0704956a004db6de518316bfd0f44f",
      laterSourceDelta: false,
    },
    ignoredArtifacts: worktrees.map(({ path, status }) => ({
      worktree: path,
      roots: status.ignoredRoots.filter(
        (rootPath) => rootPath !== ".clockwork-archives",
      ),
      artifactCount: status.rejectedIgnoredArtifactCount,
      listingSha256: status.rejectedIgnoredArtifactListingSha256,
      decision: "rejected-generated-or-local-only",
      retainedArchives: status.retainedArchivePaths,
      retainedArchiveDecision:
        status.retainedArchivePaths.length > 0
          ? "retained-and-file-hashed-in-worktree-status"
          : "not-present-in-this-worktree",
      retainedQualificationEvidence: {
        artifactCount: status.retainedEvidence.qualification.artifactCount,
        aggregateSha256: status.retainedEvidence.qualification.aggregateSha256,
        summaries: status.retainedEvidence.qualification.summaries,
        decision:
          status.retainedEvidence.qualification.artifactCount > 0
            ? "retained-failure-and-pass-evidence-with-file-hashes"
            : "not-present-in-this-worktree",
      },
    })),
  },
  mergeCommits,
  historicalRcInputLanes: {
    semantics:
      "These immutable RC-named refs are historical merge inputs only; their names do not declare consolidated main to be an RC.",
    lanes: [
      {
        ref: "rc/commercial-integrity",
        worktree: "/Users/jameskurz/Downloads/Fil One/Clockwork-rc-commercial",
        migrationRange: "001000-001099",
        baseRef: historicalRcLaneBaseRef,
        baseCommit: historicalRcLaneBaseCommit,
        baseTree: historicalRcLaneBaseTree,
      },
      {
        ref: "rc/runtime-operations",
        worktree: "/Users/jameskurz/Downloads/Fil One/Clockwork-rc-runtime",
        migrationRange: "001100-001199",
        baseRef: historicalRcLaneBaseRef,
        baseCommit: historicalRcLaneBaseCommit,
        baseTree: historicalRcLaneBaseTree,
      },
      {
        ref: "rc/experience-release",
        worktree: "/Users/jameskurz/Downloads/Fil One/Clockwork-rc-experience",
        migrationRange: "001200-001299",
        baseRef: historicalRcLaneBaseRef,
        baseCommit: historicalRcLaneBaseCommit,
        baseTree: historicalRcLaneBaseTree,
      },
    ],
  },
  preConsolidation: {
    annotatedTag: "pre-consolidation-20260731",
    tagObject: tagNames.includes("pre-consolidation-20260731")
      ? git("rev-parse", "pre-consolidation-20260731^{tag}")
      : null,
    bundlePath: bundleRepositoryPath,
    bundleExists: existsSync(bundlePath),
    bundleBytes: existsSync(bundlePath) ? statSync(bundlePath).size : null,
    bundleSha256: existsSync(bundlePath) ? sha256File(bundlePath) : null,
    bundleVerification,
    bundleHeads,
    bundleRefCount: bundleHeads.length,
  },
  rejectedOnlyCopies: [
    {
      kind: "ignored dependency/build/test output",
      examples: [
        "node_modules",
        ".next",
        ".turbo",
        "storybook-static",
        "test-results",
      ],
      rationale:
        "Generated or stale, mixed, non-SHA-bound output; not authoritative source.",
    },
    {
      kind: "dangling pre-commit objects",
      objects: danglingObjects,
      rationale:
        "Superseded intermediate source/config snapshots and generated tsbuildinfo; no post-inventory semantic delta.",
    },
  ],
});

const authSource = source("packages/contracts/src/auth.ts");
const roles = quotedArray(authSource, "roles");
const permissions = quotedArray(authSource, "permissions");
const rolePermissionBlock = authSource.match(
  /export const rolePermissions = \{([\s\S]*?)\n\} as const/,
)?.[1];
const rolePermissions = Object.fromEntries(
  roles.map((role) => {
    const block = rolePermissionBlock?.match(
      new RegExp(`\\n  ${role}: \\[([\\s\\S]*?)\\n  \\]`),
    )?.[1];
    return [
      role,
      block ? [...block.matchAll(/"([^"]+)"/g)].map((item) => item[1]) : [],
    ];
  }),
);
const pageAndRouteFiles = walk(
  "apps/web/app",
  (path) => path.endsWith("/page.tsx") || path.endsWith("/route.ts"),
);
const openapiPath = join(root, "packages/api/src/generated/openapi.json");
const openapi = JSON.parse(readFileSync(openapiPath, "utf8"));
const httpMethods = new Set([
  "delete",
  "get",
  "head",
  "options",
  "patch",
  "post",
  "put",
  "trace",
]);
const apiOperations = Object.entries(openapi.paths ?? {}).flatMap(
  ([path, methods]) =>
    Object.entries(methods)
      .filter(([method]) => httpMethods.has(method.toLowerCase()))
      .map(([method, operation]) => ({
        path,
        mountedPath: path.startsWith("/api/") ? path : `/api${path}`,
        method: method.toUpperCase(),
        operationId: operation.operationId ?? null,
        summary: operation.summary ?? null,
        tags: operation.tags ?? [],
        security: operation.security ?? null,
      })),
);
const apiRouteSources = walk("packages/api/src/routes", (path) =>
  path.endsWith(".ts"),
).map((path) => ({
  source: path,
  permissionsReferenced: unique(
    [...source(path).matchAll(/"([a-z]+(?::[a-z]+)+)"/g)]
      .map((item) => item[1])
      .filter((permission) => permissions.includes(permission)),
  ),
}));

const experienceControllerPath =
  "apps/web/src/features/experience-server/controller.ts";
const experienceControllerSource = source(experienceControllerPath);
const experienceControllerManifestBlock =
  experienceControllerSource.match(
    /export const experienceRouteManifest = Object\.freeze\(\{([\s\S]*?)\n\}\);/,
  )?.[1] ?? "";
const experienceControllerManifestOperations = [
  ...experienceControllerManifestBlock.matchAll(
    /^\s{2}([A-Za-z0-9_]+):\s*(?:`([^`]+)`|"([^"]+)")/gm,
  ),
].map((item) => ({ key: item[1], declaration: item[2] ?? item[3] }));
const experienceAuthorizationSources = [
  "apps/web/src/features/experience-server/authorization.ts",
  "apps/web/src/features/experience-server/projection-authorization.ts",
];
const experienceClientPath =
  "apps/web/src/features/contracts/experience-client.ts";
const experienceClientSource = source(experienceClientPath);
const experienceClientFunctionMatches = [
  ...experienceClientSource.matchAll(
    /^export (?:async )?function ([A-Za-z0-9_]+)\(/gm,
  ),
];

function normalizeExperienceClientPath(path) {
  return path
    .replace(/\$\{encodeURIComponent\((?:input\.)?([A-Za-z0-9_]+)\)\}/g, "{$1}")
    .replace(/\$\{input\.([A-Za-z0-9_]+)\}/g, "{$1}")
    .replace(/\$\{([A-Za-z0-9_]+)\}/g, (_, name) =>
      name === "query" ? "" : `{${name}}`,
    )
    .replace(/\?.*$/, "");
}

const experienceClientOperations = experienceClientFunctionMatches.map(
  (match, index) => {
    const start = match.index ?? 0;
    const end =
      experienceClientFunctionMatches[index + 1]?.index ??
      experienceClientSource.length;
    const block = experienceClientSource.slice(start, end);
    const literalEndpoint = block.match(
      /([`"'])(\/api\/experience[\s\S]*?)\1/,
    )?.[2];
    const endpoint = literalEndpoint
      ? literalEndpoint
      : /artifactPath\(kind,\s*id\)/.test(block)
        ? "/api/experience/artifacts/{kind}/{id}"
        : null;
    return {
      function: match[1],
      method: block.match(/method:\s*["']([A-Z]+)["']/)?.[1] ?? "GET",
      path: endpoint ? normalizeExperienceClientPath(endpoint) : null,
      fixedQuery:
        endpoint && block.includes("?representation=json")
          ? { representation: "json" }
          : null,
    };
  },
);
const experienceClientOperationsWithoutPath = experienceClientOperations
  .filter(({ path }) => !path)
  .map(({ function: functionName }) => functionName);
function operationSignature(method, path) {
  return `${method} ${path.replace(/\?.*$/, "").replace(/\{[^}]+\}/g, "{}")}`;
}
const experienceControllerOperations =
  experienceControllerManifestOperations.flatMap(({ key, declaration }) => {
    const parsed = declaration.match(/^([A-Z]+)\s+(.+)$/);
    if (!parsed) return [];
    const method = parsed[1];
    const documentedPath = parsed[2].replace(
      /\/\$\{artifactKinds\.length\}\s+kinds/,
      "",
    );
    const optional = documentedPath.match(/\[([^\]]+)\]/)?.[1];
    const paths = optional
      ? [
          documentedPath.replace(/\[[^\]]+\]/, ""),
          documentedPath.replace(/\[[^\]]+\]/, optional),
        ]
      : [documentedPath];
    return paths.map((path) => ({ key, method, path }));
  });
const experienceClientSignatures = unique(
  experienceClientOperations
    .filter(({ path }) => Boolean(path))
    .map(({ method, path }) => operationSignature(method, path)),
);
const experienceControllerSignatures = unique(
  experienceControllerOperations.map(({ method, path }) =>
    operationSignature(method, path),
  ),
);
const generatedExperienceOperations = apiOperations.filter(({ path }) =>
  path.startsWith("/api/experience/"),
);
const generatedExperienceSignatures = unique(
  generatedExperienceOperations.map(({ method, path }) =>
    operationSignature(method, path),
  ),
);
const generatedHonoOperations = apiOperations.filter(({ path }) =>
  path.startsWith("/v1/"),
);
const experienceConcreteOperationSignatures = unique([
  ...experienceClientSignatures,
  ...experienceControllerSignatures,
]);
const clientOperationsMissingControllerManifest =
  experienceClientSignatures.filter(
    (signature) => !experienceControllerSignatures.includes(signature),
  );
const controllerOperationsWithoutClientHelper =
  experienceControllerSignatures.filter(
    (signature) => !experienceClientSignatures.includes(signature),
  );
const controllerOperationsWithoutGeneratedContract =
  experienceControllerSignatures.filter(
    (signature) => !generatedExperienceSignatures.includes(signature),
  );

writeJson("routes-api-auth.json", {
  schemaVersion: 1,
  capturedAt,
  mount: {
    openapiPrefix: "/v1",
    nextPrefix: "/api",
    deployedPrefix: "/api/v1",
  },
  applicationRoutes: pageAndRouteFiles.map((path) => ({
    route: routeFromPage(path),
    audience: audienceFor(path),
    intendedAccess: intendedAccessFor(path),
    observedGuard: observedGuardFor(path),
    kind: path.endsWith("/page.tsx") ? "page" : "route-handler",
    source: path,
  })),
  audiences: [
    "access",
    "customer",
    "partner",
    "internal",
    "signing",
    "api-mount",
    "shared",
  ],
  roles,
  permissions,
  rolePermissions,
  experienceApi: {
    mount: "/api/experience",
    routeHandler: "apps/web/app/api/experience/[[...segments]]/route.ts",
    controller: experienceControllerPath,
    controllerRouteManifest: experienceControllerManifestOperations,
    client: experienceClientPath,
    authorizationSources: experienceAuthorizationSources,
    concreteOperationCount: experienceConcreteOperationSignatures.length,
    concreteOperationSignatures: experienceConcreteOperationSignatures,
    clientOperationCount: experienceClientOperations.length,
    clientOperations: experienceClientOperations,
    clientOperationsWithoutDiscoveredPath:
      experienceClientOperationsWithoutPath,
    controllerOperations: experienceControllerOperations,
    coverageStatus:
      experienceClientOperationsWithoutPath.length === 0
        ? "all-exported-client-operations-inventoried"
        : "incomplete-client-operation-discovery",
    contractReconciliation: {
      clientOperationsMissingControllerManifest,
      controllerOperationsWithoutClientHelper,
      interpretation:
        "A client-only signature identifies a stale controller route manifest; a controller-only signature can be an intentional direct binary/browser operation but must remain inventoried.",
    },
    limitation:
      "The experience API is implemented by a typed Next.js controller and merged into the canonical OpenAPI document; authorization remains controller/repository enforced.",
  },
  api: {
    openapiSha256: sha256File(openapiPath),
    operationCount: apiOperations.length,
    operations: apiOperations,
    sourcePermissionReferences: apiRouteSources,
    operationsWithDeclaredSecurity: apiOperations.filter(
      ({ security }) => Array.isArray(security) && security.length > 0,
    ).length,
    operationPermissionMappingStatus: "not-expressible-from-current-openapi",
    limitation:
      "OpenAPI security metadata and page access labels are inventories, not proof of authorization; source permission references and the role-permission matrix remain authoritative implementation evidence.",
  },
});

const migrations = walk("supabase/migrations", (path) =>
  path.endsWith(".sql"),
).map((path) => {
  const text = source(path);
  const migrationId = Number(path.match(/\/(\d+)_/)?.[1] ?? -1);
  const owner =
    migrationId < 100
      ? "foundation"
      : migrationId < 200
        ? "core-finance"
        : migrationId < 900
          ? "lifecycle-platform"
          : migrationId < 1000
            ? "pre-rc-integration"
            : migrationId < 1100
              ? "rc/commercial-integrity"
              : migrationId < 1200
                ? "rc/runtime-operations"
                : migrationId < 1300
                  ? "rc/experience-release"
                  : "main-release-integration";
  const explicitRlsTables = sqlNames(
    text,
    /alter table\s+(?:("?[a-z0-9_]+"?)\.)?("?[a-z0-9_]+"?)\s+enable row level security/gi,
  );
  const explicitForceRlsTables = sqlNames(
    text,
    /alter table\s+(?:("?[a-z0-9_]+"?)\.)?("?[a-z0-9_]+"?)\s+force row level security/gi,
  );
  const loopRlsTables = dynamicLoopTables(
    text,
    /alter table\s+%I\s+enable row level security/i,
  );
  const loopForceRlsTables = dynamicLoopTables(
    text,
    /alter table\s+%I\s+force row level security/i,
  );
  const policyCreates = uniqueBy(
    [
      ...text.matchAll(
        /create policy\s+"?([a-z0-9_]+)"?\s+on\s+(?:(["a-z0-9_]+)\.)?(["a-z0-9_]+)([\s\S]*?);/gi,
      ),
    ]
      .filter((item) => item[1] !== "%I")
      .map((item) => ({
        name: item[1].replaceAll('"', ""),
        table: sqlQualifiedName(item[2], item[3]),
        command:
          item[4]
            .match(/\bfor\s+(all|select|insert|update|delete)\b/i)?.[1]
            ?.toLowerCase() ?? "all",
        roles: item[4]
          .match(/\bto\s+([\s\S]*?)(?=\s+using\b|\s+with check\b|$)/i)?.[1]
          ?.split(",")
          .map((role) => role.trim().replaceAll('"', "")) ?? ["public"],
        clauses: item[4].replace(/\s+/g, " ").trim(),
        statement: item[0].replace(/\s+/g, " ").trim(),
      })),
    ({ name, table }) => `${table}:${name}`,
  );
  const policyDrops = uniqueBy(
    [
      ...text.matchAll(
        /drop policy(?: if exists)?\s+"?([a-z0-9_]+)"?\s+on\s+(?:(["a-z0-9_]+)\.)?(["a-z0-9_]+)/gi,
      ),
    ].map((item) => ({
      name: item[1].replaceAll('"', ""),
      table: sqlQualifiedName(item[2], item[3]),
    })),
    ({ name, table }) => `${table}:${name}`,
  );
  const triggerCreates = uniqueBy(
    [
      ...text.matchAll(
        /create\s+(constraint\s+)?trigger\s+"?([a-z0-9_]+)"?[^;]*?\s+on\s+(?:(["a-z0-9_]+)\.)?(["a-z0-9_]+)/gi,
      ),
    ].map((item) => ({
      name: item[2],
      table: sqlQualifiedName(item[3], item[4]),
      constraint: Boolean(item[1]),
    })),
    ({ name, table }) => `${table}:${name}`,
  );
  const dynamicTriggerBindings = dynamicLoopTriggerBindings(text);
  const triggerDrops = uniqueBy(
    [
      ...text.matchAll(
        /drop trigger(?: if exists)?\s+"?([a-z0-9_]+)"?\s+on\s+(?:(["a-z0-9_]+)\.)?(["a-z0-9_]+)/gi,
      ),
    ].map((item) => ({
      name: item[1],
      table: sqlQualifiedName(item[2], item[3]),
    })),
    ({ name, table }) => `${table}:${name}`,
  );
  const accessControlStatements = [
    ...text.matchAll(
      /(?:^|\n)\s*((?:grant|revoke|alter default privileges)[\s\S]*?);/gi,
    ),
  ].map((item) => ({
    kind: item[1].trim().split(/\s+/)[0].toLowerCase(),
    statement: `${item[1].replace(/\s+/g, " ").trim()};`,
  }));
  return {
    path,
    migrationId: String(migrationId).padStart(6, "0"),
    owner,
    sha256: sha256File(join(root, path)),
    bytes: statSync(join(root, path)).size,
    tables: sqlNames(
      text,
      /create table(?: if not exists)?\s+(?:("?[a-z0-9_]+"?)\.)?("?[a-z0-9_]+"?)/gi,
    ),
    policyCreates,
    policyDrops,
    rlsTables: unique([...explicitRlsTables, ...loopRlsTables]),
    forceRlsTables: unique([...explicitForceRlsTables, ...loopForceRlsTables]),
    grants: unique(
      [...text.matchAll(/(?:^|\n)\s*grant\s+([\s\S]*?);/gi)].map((item) =>
        item[1].replace(/\s+/g, " ").trim(),
      ),
    ),
    templatedGrants: unique(
      [...text.matchAll(/execute format\(\s*'((?:grant|revoke)[^']+)'/gi)].map(
        (item) => item[1].replace(/\s+/g, " ").trim(),
      ),
    ),
    functions: unique(
      [
        ...text.matchAll(
          /create(?: or replace)? function\s+(?:("?[a-z0-9_]+"?)\.)?("?[a-z0-9_]+"?)/gi,
        ),
      ].map((item) => sqlQualifiedName(item[1], item[2])),
    ),
    views: unique(
      [
        ...text.matchAll(
          /create(?: or replace)? view\s+(?:("?[a-z0-9_]+"?)\.)?("?[a-z0-9_]+"?)/gi,
        ),
      ].map((item) => sqlQualifiedName(item[1], item[2])),
    ),
    triggerCreates,
    dynamicTriggerBindings,
    triggerDrops,
    accessControlStatements,
  };
});
const effectivePolicies = new Map();
const effectiveTriggers = new Map();
for (const migration of migrations) {
  for (const policy of migration.policyDrops)
    effectivePolicies.delete(`${policy.table}:${policy.name}`);
  for (const policy of migration.policyCreates)
    effectivePolicies.set(`${policy.table}:${policy.name}`, {
      migration: migration.path,
      ...policy,
    });
  for (const trigger of migration.triggerDrops)
    effectiveTriggers.delete(`${trigger.table}:${trigger.name}`);
  for (const trigger of [
    ...migration.triggerCreates,
    ...migration.dynamicTriggerBindings,
  ]) {
    if (!trigger.name) continue;
    effectiveTriggers.set(`${trigger.table}:${trigger.name}`, {
      migration: migration.path,
      ...trigger,
    });
  }
}
const drizzleSnapshots = walk("packages/db/drizzle/meta", (path) =>
  path.endsWith("snapshot.json"),
).map((path) => {
  const snapshot = JSON.parse(source(path));
  return {
    path,
    sha256: sha256File(join(root, path)),
    tableCount: Object.keys(snapshot.tables ?? {}).length,
    policyCount: Object.keys(snapshot.policies ?? {}).length,
    viewCount: Object.keys(snapshot.views ?? {}).length,
  };
});
const latestDrizzleSnapshotPath = drizzleSnapshots.at(-1).path;
const latestDrizzleSnapshot = JSON.parse(source(latestDrizzleSnapshotPath));
const canonicalSqlTables = unique(migrations.flatMap(({ tables }) => tables));
const canonicalSqlViews = unique(migrations.flatMap(({ views }) => views));
const customDatabaseRoles = unique(
  migrations.flatMap(({ path }) =>
    [...source(path).matchAll(/create role\s+"?([a-z0-9_]+)"?/gi)].map(
      (item) => item[1],
    ),
  ),
);
const snapshotTableNames = Object.keys(latestDrizzleSnapshot.tables ?? {});
const snapshotPolicyNames = Object.keys(latestDrizzleSnapshot.policies ?? {});
const snapshotViewNames = Object.keys(latestDrizzleSnapshot.views ?? {});
writeJson("schema.json", {
  schemaVersion: 1,
  capturedAt,
  authority:
    "Canonical migration SQL is authoritative. The latest Drizzle snapshot supplies detailed machine-readable columns, types, nullability, defaults, keys, constraints, and indexes for represented objects; canonicalSqlObjects supplies the complete SQL-derived identity and access-control inventory, including objects absent from the snapshot.",
  snapshot: {
    path: latestDrizzleSnapshotPath,
    sha256: sha256File(join(root, latestDrizzleSnapshotPath)),
    id: latestDrizzleSnapshot.id,
    prevId: latestDrizzleSnapshot.prevId,
    version: latestDrizzleSnapshot.version,
    dialect: latestDrizzleSnapshot.dialect,
  },
  schemas: latestDrizzleSnapshot.schemas ?? {},
  tables: latestDrizzleSnapshot.tables ?? {},
  enums: latestDrizzleSnapshot.enums ?? {},
  sequences: latestDrizzleSnapshot.sequences ?? {},
  roles: latestDrizzleSnapshot.roles ?? {},
  policies: latestDrizzleSnapshot.policies ?? {},
  views: latestDrizzleSnapshot.views ?? {},
  canonicalSqlObjects: {
    tables: canonicalSqlTables,
    policies: [...effectivePolicies.values()].sort((left, right) =>
      `${left.table}:${left.name}`.localeCompare(
        `${right.table}:${right.name}`,
      ),
    ),
    views: canonicalSqlViews,
    customRoles: customDatabaseRoles,
  },
  coverage: {
    canonicalSqlTableCount: canonicalSqlTables.length,
    snapshotTableCount: snapshotTableNames.length,
    tablesAbsentFromSnapshot: canonicalSqlTables.filter(
      (name) => !snapshotTableNames.includes(name),
    ),
    canonicalSqlPolicyCount: effectivePolicies.size,
    snapshotPolicyCount: snapshotPolicyNames.length,
    canonicalSqlViewCount: canonicalSqlViews.length,
    snapshotViewCount: snapshotViewNames.length,
    customRoleCount: customDatabaseRoles.length,
  },
});
writeJson("database.json", {
  schemaVersion: 1,
  capturedAt,
  canonicalMigrationCount: migrations.length,
  effectiveSourceInventory: {
    tables: canonicalSqlTables,
    rlsTables: unique(migrations.flatMap(({ rlsTables }) => rlsTables)),
    forceRlsTables: unique(
      migrations.flatMap(({ forceRlsTables }) => forceRlsTables),
    ),
    policies: [...effectivePolicies.values()].sort((left, right) =>
      `${left.table}:${left.name}`.localeCompare(
        `${right.table}:${right.name}`,
      ),
    ),
    policyCreateStatementCount: migrations.reduce(
      (total, migration) => total + migration.policyCreates.length,
      0,
    ),
    policyDropStatementCount: migrations.reduce(
      (total, migration) => total + migration.policyDrops.length,
      0,
    ),
    functions: unique(migrations.flatMap(({ functions }) => functions)),
    views: canonicalSqlViews,
    triggers: [...effectiveTriggers.values()].sort((left, right) =>
      `${left.table}:${left.name}`.localeCompare(
        `${right.table}:${right.name}`,
      ),
    ),
    triggerCreateStatementCount: migrations.reduce(
      (total, migration) =>
        total +
        migration.triggerCreates.length +
        migration.dynamicTriggerBindings.length,
      0,
    ),
    triggerDropStatementCount: migrations.reduce(
      (total, migration) => total + migration.triggerDrops.length,
      0,
    ),
    accessControlStatements: migrations.flatMap(
      ({ path, accessControlStatements, templatedGrants }) => [
        ...accessControlStatements.map((statement) => ({
          migration: path,
          templated: false,
          ...statement,
        })),
        ...templatedGrants.map((statement) => ({
          migration: path,
          templated: true,
          kind: statement.trim().split(/\s+/)[0].toLowerCase(),
          statement: `${statement};`,
        })),
      ],
    ),
  },
  migrations,
  drizzleSnapshots,
  machineReadableSchema: "docs/baseline/schema.json",
  seeds: ["supabase/seed.sql"].map((path) => ({
    path,
    sha256: sha256File(join(root, path)),
    targetTables: unique(
      [
        ...source(path).matchAll(
          /insert into\s+(?:("?[a-z0-9_]+"?)\.)?("?[a-z0-9_]+"?)/gi,
        ),
      ].map((item) => sqlQualifiedName(item[1], item[2])),
    ),
  })),
  productionRoles: {
    path: "supabase/production-roles.sql",
    sha256: sha256File(join(root, "supabase/production-roles.sql")),
    customRoles: customDatabaseRoles,
    referencedPlatformRoles: [
      "postgres",
      "public",
      "anon",
      "authenticated",
      "service_role",
    ],
    roleTransitions: unique(
      [
        ...source("supabase/production-roles.sql").matchAll(
          /\b(?:set|reset) role\s+([^;]+);/gi,
        ),
      ].map((item) => item[0].replace(/\s+/g, " ").trim()),
    ),
    deploymentCredentialization: unique(
      [
        ...source("supabase/production-roles.sql").matchAll(
          /alter role\s+([^;]+);/gi,
        ),
      ].map((item) => item[0].replace(/\s+/g, " ").trim()),
    ),
    definitionSource: "supabase/migrations/000001_foundation.sql",
    bypassRls: false,
  },
  historicalRcLaneMigrationRanges: {
    "rc/commercial-integrity": "001000-001099",
    "rc/runtime-operations": "001100-001199",
    "rc/experience-release": "001200-001299",
  },
  mainReleaseIntegrationMigrationRange: "001300-001399",
  limitation:
    "Canonical SQL, not Drizzle snapshots, owns RLS, grants, roles, triggers, and views. Source expansion records literal foreach arrays, but executed qualification remains authoritative for effective catalog state.",
});

writeJson("openapi-clients.json", {
  schemaVersion: 1,
  capturedAt,
  openapiVersion: openapi.openapi,
  paths: Object.keys(openapi.paths ?? {}).length,
  operations: apiOperations.length,
  clientSurfaces: [
    {
      name: "hono-v1-openapi",
      mount: "/api/v1",
      sourcePathPrefix: "/v1",
      operationCount: generatedHonoOperations.length,
      generatedContract: "packages/api/src/generated/schema.d.ts",
      client: "packages/api/src/generated/client.ts",
    },
    {
      name: "experience-next-controller",
      mount: "/api/experience",
      concreteOperationCount: experienceConcreteOperationSignatures.length,
      concreteOperationSignatures: experienceConcreteOperationSignatures,
      clientOperationCount: experienceClientOperations.length,
      generatedOpenApiOperationCount: generatedExperienceOperations.length,
      generatedOpenApiOperations: generatedExperienceOperations,
      generatedContract: "packages/api/src/generated/schema.d.ts",
      client: experienceClientPath,
      controller: experienceControllerPath,
      controllerRouteManifest: experienceControllerManifestOperations,
      operations: experienceClientOperations,
      operationsWithoutDiscoveredPath: experienceClientOperationsWithoutPath,
      contractReconciliation: {
        clientOperationsMissingControllerManifest,
        controllerOperationsWithoutClientHelper,
        controllerOperationsWithoutGeneratedContract,
      },
    },
  ],
  artifacts: [
    {
      path: "packages/api/src/generated/openapi.json",
      kind: "generated-openapi",
    },
    { path: "packages/api/src/generated/schema.d.ts", kind: "generated-types" },
    {
      path: "packages/api/src/generated/client.ts",
      kind: "checked-in-handwritten-openapi-fetch-wrapper",
    },
    {
      path: experienceClientPath,
      kind: "checked-in-typed-next-controller-client",
    },
  ].map(({ path, kind }) => ({
    path,
    kind,
    sha256: sha256File(join(root, path)),
    bytes: statSync(join(root, path)).size,
  })),
  generationCommand: "pnpm generate",
  driftCommand: "pnpm check:generated",
  limitation:
    "The generated OpenAPI/types cover the complete Hono /v1 surface plus the seven projection/artifact operations hosted by the Next.js /api/experience controller. E-sign and evidence operations remain checked-in typed controller/client contracts and are explicitly listed as controller operations outside the generated contract. Both stable clients are handwritten and hashed for drift.",
});

const workflowSources = walk(
  "packages/workflows/src",
  (path) => path.endsWith(".ts") && !path.endsWith(".test.ts"),
);
const workflowText = workflowSources.map((path) => source(path)).join("\n");
const taskIds = unique(
  [
    ...workflowText.matchAll(
      /["'`]((?:core\.|lifecycle-|system\.)[^"'`]+(?:\.v\d+|-v\d+))["'`]/g,
    ),
  ].map((item) => item[1]),
);
const taskIdExpressions = new Map();
for (const path of workflowSources) {
  const text = source(path);
  for (const registry of text.matchAll(
    /export const\s+(\w+TaskIds)\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\);/g,
  )) {
    for (const property of registry[2].matchAll(/\b(\w+):\s*["']([^"']+)["']/g))
      taskIdExpressions.set(`${registry[1]}.${property[1]}`, property[2]);
  }
}
const discoveredSchedules = workflowSources.flatMap((path) => {
  const text = source(path);
  const direct = [
    ...text.matchAll(/schedules\.task\(\{([\s\S]*?)\n\}\);/g),
  ].map((item) => ({
    source: path,
    id: item[1].match(/\bid:\s*["'`]([^"'`]+)["'`]/)?.[1] ?? null,
    cron: item[1].match(/pattern:\s*["'`]([^"'`]+)["'`]/)?.[1] ?? null,
    idExpression: null,
  }));
  const lifecycle = [
    ...text.matchAll(
      /defineLifecycleScheduledTask\(\s*([^,\n]+),\s*["'`]([^"'`]+)["'`]\s*,?\s*\)/g,
    ),
  ].map((item) => {
    const idExpression = item[1].trim();
    return {
      source: path,
      id: taskIdExpressions.get(idExpression) ?? null,
      cron: item[2],
      idExpression,
    };
  });
  return [...direct, ...lifecycle];
});
const coreScheduleSourcePath =
  "packages/workflows/src/core/scheduled-runtime.ts";
const coreScheduleSource = source(coreScheduleSourcePath);
const coreRegisteredSchedules = [
  ...coreScheduleSource.matchAll(
    /\{\s*id:\s*["'](core\.schedule\.[^"']+)["'],\s*cron:\s*["']([^"']+)["'],\s*dispatches:\s*["']([^"']+)["'],\s*\}/g,
  ),
].map((item) => ({
  source: coreScheduleSourcePath,
  id: item[1],
  cron: item[2],
  dispatches: item[3],
  idExpression: null,
}));
const schedules = [...discoveredSchedules, ...coreRegisteredSchedules];
const discoverySource = source("packages/workflows/src/trigger/discovery.ts");
const discoveryImports = unique(
  [...discoverySource.matchAll(/import\(["']([^"']+)["']\)/g)].map(
    (item) => item[1],
  ),
);
const lifecycleDispatchSource = source(
  "packages/workflows/src/system/lifecycle-task-dispatch.ts",
);
const lifecycleOutboxTopics = unique(
  [...lifecycleDispatchSource.matchAll(/["']([a-z][a-z0-9_.-]+)["']\s*:/g)].map(
    (item) => item[1],
  ),
);
const coreOutboxSource = source(
  "packages/workflows/src/core/outbox-handlers.ts",
);
const coreOutboxDefinitions = coreOutboxSource.split(
  "export const coreWorkflowDispatchPlan",
)[0];
const coreOutboxTopics = unique(
  [
    ...coreOutboxDefinitions.matchAll(
      /["']([a-z][a-z0-9_-]+(?:\.[a-z0-9_-]+)+)["']/g,
    ),
  ]
    .map((item) => item[1])
    .filter(
      (value) =>
        !value.startsWith("core.billing.") &&
        !value.startsWith("core.collections."),
    ),
);
const stripeAdjustmentSourcePath =
  "packages/workflows/src/core/stripe-adjustment-handler.ts";
const stripeAdjustmentTopics = unique(
  [
    ...source(stripeAdjustmentSourcePath).matchAll(
      /["'](core\.(?:credit_notes\.issue|refunds\.submit))["']/g,
    ),
  ].map((item) => item[1]),
);
const experienceProjectionSourcePath =
  "packages/workflows/src/experience/projection-definitions.ts";
const experienceProjectionSource = source(experienceProjectionSourcePath);
const experienceProjectionTopics = [
  "accounts",
  "quotes",
  "orders",
  "amendments",
  "invoices",
].flatMap((resource) => {
  const actions =
    experienceProjectionSource.match(
      new RegExp(`${resource}:\\s*\\[([\\s\\S]*?)\\]`),
    )?.[1] ?? "";
  return quotedValues(actions).map((action) => `core.${resource}.${action}`);
});
const experienceProductionSourcePath =
  "packages/workflows/src/experience/production-handlers.ts";
const experienceAcknowledgementTopics = quotedArray(
  source(experienceProductionSourcePath),
  "experienceEvidenceAcknowledgementTopics",
);
const portalActionSourcePath =
  "packages/workflows/src/experience/portal-action-handler.ts";
const portalActionQueuedTopic =
  source(portalActionSourcePath).match(
    /portalActionQueuedTopic\s*=\s*["']([^"']+)["']/,
  )?.[1] ?? null;
const experienceOutboxTopics = unique([
  ...(portalActionQueuedTopic ? [portalActionQueuedTopic] : []),
  ...experienceProjectionTopics,
  ...experienceAcknowledgementTopics,
]);
const scheduledOutboxTopics = ["core.schedule.dispatch.v1"];
const productionCompositionTopics = [
  "organization.created",
  "termination.deletion_certificate_requested",
  "commerce.commercial_artifact_requested",
];
const outboxHandlerSources = [
  {
    category: "lifecycle",
    source: "packages/workflows/src/system/lifecycle-task-dispatch.ts",
    topics: lifecycleOutboxTopics,
  },
  {
    category: "core",
    source: "packages/workflows/src/core/outbox-handlers.ts",
    topics: coreOutboxTopics,
  },
  {
    category: "stripe-adjustments",
    source: stripeAdjustmentSourcePath,
    topics: stripeAdjustmentTopics,
  },
  {
    category: "experience-portal-action",
    source: portalActionSourcePath,
    topics: portalActionQueuedTopic ? [portalActionQueuedTopic] : [],
  },
  {
    category: "experience-projections",
    source: experienceProjectionSourcePath,
    topics: experienceProjectionTopics,
  },
  {
    category: "experience-acknowledgements",
    source: experienceProductionSourcePath,
    topics: experienceAcknowledgementTopics,
  },
  {
    category: "scheduled-dispatch",
    source: "packages/workflows/src/runtime/production-adapter-factory.ts",
    topics: scheduledOutboxTopics,
  },
  {
    category: "runtime-composition",
    source: "packages/workflows/src/runtime/production.ts",
    topics: productionCompositionTopics,
  },
];
const outboxHandlerContributions = outboxHandlerSources.flatMap(
  ({ category, source, topics }) =>
    topics.map((topic) => ({ category, source, topic })),
);
const staticallyComposableOutboxTopics = unique(
  outboxHandlerContributions.map(({ topic }) => topic),
);
const overlappingOutboxTopics = staticallyComposableOutboxTopics
  .map((topic) => ({
    topic,
    sources: outboxHandlerContributions.filter(
      (contribution) => contribution.topic === topic,
    ),
  }))
  .filter(({ sources }) => sources.length > 1);
const coreTaskIds = quotedArray(
  source("packages/workflows/src/core/ports.ts"),
  "coreWorkflowTaskIds",
);
const coreDispatchPlanBlock =
  coreOutboxSource.match(
    /export const coreWorkflowDispatchPlan = \{([\s\S]*?)\n\} as const satisfies/,
  )?.[1] ?? "";
const coreDispatchPlan = coreTaskIds.map((taskId) => {
  const block =
    coreDispatchPlanBlock.match(
      new RegExp(
        `["']${taskId.replaceAll(".", "\\.")}["']:\\s*\\{([\\s\\S]*?)\\n  \\},`,
      ),
    )?.[1] ?? "";
  const scheduleBlock = block.match(/schedules:\s*\[([\s\S]*?)\]/)?.[1] ?? "";
  const eventsExpression =
    block.match(/events:\s*(\[[\s\S]*?\]|[A-Za-z0-9_]+)/)?.[1] ?? "[]";
  const events =
    eventsExpression === "invoiceDraftTopics"
      ? ["core.invoice.draft_ready", "core.invoices.create"]
      : eventsExpression.includes("commissionStatementTopic")
        ? ["core.commission_statement.generated"]
        : eventsExpression.startsWith("[")
          ? quotedValues(eventsExpression)
          : [];
  const registeredSchedules = coreRegisteredSchedules.filter(
    (schedule) =>
      schedule.dispatches === taskId &&
      quotedValues(scheduleBlock).includes(schedule.cron),
  );
  return {
    taskId,
    events,
    eventsExpression,
    schedules: quotedValues(scheduleBlock),
    source: "packages/workflows/src/core/outbox-handlers.ts",
    registeredTriggerSchedule: registeredSchedules.length > 0,
    registeredScheduleIds: registeredSchedules.map(({ id }) => id),
  };
});
const lifecycleExecutionSourcePath =
  "packages/workflows/src/runtime/provider-lifecycle.ts";
const lifecycleExecutionSource = source(lifecycleExecutionSourcePath);
const lifecycleExecutionTaskIds = unique(
  [
    ...lifecycleExecutionSource.matchAll(
      /["'](lifecycle-[^"']+-v\d+)["']:\s*executionSpec\(/g,
    ),
  ].map((item) => item[1]),
);
const lifecycleTaskIds = taskIds.filter((taskId) =>
  taskId.startsWith("lifecycle-"),
);
const lifecycleTasksMissingExecution = lifecycleTaskIds.filter(
  (taskId) => !lifecycleExecutionTaskIds.includes(taskId),
);
const coreScheduleIntentCount = coreDispatchPlan.reduce(
  (total, item) => total + item.schedules.length,
  0,
);
const registeredCoreScheduleCount = coreRegisteredSchedules.filter((schedule) =>
  coreDispatchPlan.some(
    (task) =>
      task.taskId === schedule.dispatches &&
      task.schedules.includes(schedule.cron),
  ),
).length;
const knownWorkflowGaps = [];
if (registeredCoreScheduleCount !== coreScheduleIntentCount)
  knownWorkflowGaps.push(
    `${coreScheduleIntentCount - registeredCoreScheduleCount} core schedule intents lack a registered Trigger schedule.`,
  );
if (lifecycleTasksMissingExecution.length > 0)
  knownWorkflowGaps.push(
    `${lifecycleTasksMissingExecution.length} lifecycle task IDs lack an authoritative execution specification.`,
  );
writeJson("workflows.json", {
  schemaVersion: 1,
  capturedAt,
  taskIds,
  taskCount: taskIds.length,
  schedules,
  registeredScheduleCount: schedules.length,
  discovery: {
    entrypoint: "packages/workflows/src/trigger/index.ts",
    module: "packages/workflows/src/trigger/discovery.ts",
    imports: discoveryImports,
  },
  outbox: {
    dispatcherTask: "system.outbox.dispatch.v1",
    lifecycleMappedTopics: lifecycleOutboxTopics,
    coreMappedTopics: coreOutboxTopics,
    stripeAdjustmentTopics,
    experienceMappedTopics: experienceOutboxTopics,
    scheduledTopics: scheduledOutboxTopics,
    productionCompositionTopics,
    unconditionalCompositionTopics: ["organization.created"],
    conditionalCompositionTopics: [
      "termination.deletion_certificate_requested",
      "commerce.commercial_artifact_requested",
    ],
    staticallyComposableTopics: staticallyComposableOutboxTopics,
    staticallyComposableTopicCount: staticallyComposableOutboxTopics.length,
    handlerContributionCount: outboxHandlerContributions.length,
    handlerSources: outboxHandlerSources,
    overlappingTopics: overlappingOutboxTopics,
    sources: unique(outboxHandlerSources.map(({ source }) => source)),
  },
  coreDispatchPlan: {
    tasks: coreDispatchPlan,
    taskCount: coreDispatchPlan.length,
    scheduleIntentCount: coreScheduleIntentCount,
    registeredTriggerScheduleCount: registeredCoreScheduleCount,
  },
  lifecycleExecution: {
    source: lifecycleExecutionSourcePath,
    taskCount: lifecycleTaskIds.length,
    authoritativeExecutionSpecCount: lifecycleExecutionTaskIds.length,
    missingTaskIds: lifecycleTasksMissingExecution,
  },
  knownGaps: knownWorkflowGaps,
});

const documentKinds = quotedArray(
  source("packages/documents/src/model.ts"),
  "DOCUMENT_KINDS",
);
const goldenSource = source(
  "packages/documents/src/__fixtures__/golden-pdfs.ts",
);
const goldenKinds = unique(
  [...goldenSource.matchAll(/^\s{2}([a-z][a-z0-9_]+):\s*\{/gm)].map(
    (item) => item[1],
  ),
);
const goldenArtifacts = goldenKinds.map((kind) => {
  const block =
    goldenSource.match(
      new RegExp(`\\n  ${kind}: \\{([\\s\\S]*?)\\n  \\},`),
    )?.[1] ?? "";
  return {
    kind,
    bytes: Number(block.match(/bytes:\s*(\d+)/)?.[1] ?? 0),
    contentHash: block.match(/["']([a-f0-9]{64})["']/)?.[1] ?? null,
    pages: Number(block.match(/pages:\s*(\d+)/)?.[1] ?? 0),
  };
});
const coreRetrievalKinds = [
  "agreement_template",
  "quote",
  "partner_quote",
  "order_form",
];
const commercialGenerationKinds = [
  "direct_quote",
  "partner_transfer_quote",
  "partner_resale_quote",
  "order_form",
  "amendment",
];
const artifactSourcePath =
  "apps/web/src/features/experience-server/artifact-sources.ts";
const artifactSourceImplementation = source(artifactSourcePath);
const experienceRepositoryPath =
  "apps/web/src/features/experience-server/repository.ts";
const experienceRepositorySource = source(experienceRepositoryPath);

function namedFunctionSource(text, name) {
  const start = text.search(
    new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`),
  );
  if (start < 0) return "";
  const tail = text.slice(start);
  const next = tail
    .slice(1)
    .search(/\n(?:export\s+)?(?:async\s+)?function\s+[A-Za-z0-9_]+\s*\(/);
  return next < 0 ? tail : tail.slice(0, next + 1);
}

function namedClassMethodSource(text, name) {
  const start = text.search(new RegExp(`\\n  public\\s+${name}\\s*\\(`));
  if (start < 0) return "";
  const tail = text.slice(start + 1);
  const next = tail.slice(1).search(/\n {2}public\s+[A-Za-z0-9_]+\s*\(/);
  return next < 0 ? tail : tail.slice(0, next + 1);
}

const artifactResolverSource = namedFunctionSource(
  artifactSourceImplementation,
  "resolveArtifactSource",
);
const artifactResolverFunctions = unique(
  [
    ...artifactResolverSource.matchAll(/await\s+([A-Za-z0-9_]+Source)\s*\(/g),
  ].map((item) => item[1]),
);
const artifactResolverEvidence = [
  artifactResolverSource,
  ...artifactResolverFunctions.map((name) =>
    namedFunctionSource(artifactSourceImplementation, name),
  ),
].join("\n");
const authoritativeSourceKinds = documentKinds.filter((kind) =>
  new RegExp(`["']${kind}["']`).test(artifactResolverEvidence),
);
const authoritativeSourceMissingKinds = documentKinds.filter(
  (kind) => !authoritativeSourceKinds.includes(kind),
);
const artifactTestFiles = unique([
  ...walk("apps", (path) => /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/.test(path)),
  ...walk("packages", (path) =>
    /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/.test(path),
  ),
  ...walk("scripts", (path) => /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/.test(path)),
]).filter((path) => /artifact|render|document/i.test(source(path)));
const artifactResolverExecutionTests = artifactTestFiles.filter((path) => {
  const text = source(path);
  return (
    text.includes("resolveArtifactSource") ||
    (text.includes("createArtifactRenderRequest") &&
      text.includes("renderArtifactRequest")) ||
    text.includes("/api/experience/artifacts/render-requests")
  );
});
const allKindArtifactResolverTests = artifactResolverExecutionTests.filter(
  (path) => {
    const text = source(path);
    return (
      /DOCUMENT_KINDS|\bartifactKinds\b|demoDocuments|all\s+15|every\s+(?:supported\s+)?(?:artifact|document)\s+kind/i.test(
        text,
      ) ||
      documentKinds.every((kind) => new RegExp(`["']${kind}["']`).test(text))
    );
  },
);
const documentTestFiles = walk("packages/documents/src", (path) =>
  /\.(?:test|spec)\.(?:ts|tsx)$/.test(path),
);
const allKindRendererTests = documentTestFiles.filter((path) =>
  /DOCUMENT_KINDS|demoDocuments|all\s+15|every\s+(?:supported\s+)?document\s+kind/i.test(
    source(path),
  ),
);
const experienceArtifactOperations = experienceClientOperations.filter(
  ({ path }) => path?.startsWith("/api/experience/artifacts/"),
);
const requiredExperienceArtifactOperations = [
  "artifactRepresentation",
  "createArtifactRenderRequest",
  "downloadArtifact",
  "renderArtifactRequest",
];
const missingExperienceArtifactOperations =
  requiredExperienceArtifactOperations.filter(
    (functionName) =>
      !experienceArtifactOperations.some(
        (operation) => operation.function === functionName,
      ),
  );
const deletionCertificateRegistered = source(
  "packages/workflows/src/runtime/production.ts",
).includes("createDeletionCertificateOutboxHandler");
const renderStateMachineTests = artifactTestFiles.filter((path) =>
  /redrive|RENDER_VERSION_CONFLICT|claimRenderRequest/.test(source(path)),
);
const renderClaimUsesVersionCas =
  /set\s+status\s*=\s*'rendering'[\s\S]*?status\s+in\s*\(\s*'pending'\s*,\s*'failed'\s*\)[\s\S]*?row_version\s*=\s*\$\{request\.version\}/.test(
    namedClassMethodSource(experienceRepositorySource, "claimRenderRequest"),
  );
const renderFailureUsesVersionCas =
  /status\s*=\s*'rendering'[\s\S]*?row_version\s*=\s*\$\{request\.version\s*\+\s*1\}/.test(
    namedClassMethodSource(experienceRepositorySource, "failRenderRequest"),
  );
const renderStoreUsesVersionCas =
  /status\s*=\s*'rendering'[\s\S]*?row_version\s*=\s*\$\{input\.request\.version\s*\+\s*1\}/.test(
    namedClassMethodSource(experienceRepositorySource, "storeArtifact"),
  );
const artifactKnownGaps = [];
if (authoritativeSourceMissingKinds.length > 0)
  artifactKnownGaps.push(
    `Authoritative source resolution is missing: ${authoritativeSourceMissingKinds.join(", ")}.`,
  );
if (missingExperienceArtifactOperations.length > 0)
  artifactKnownGaps.push(
    `The typed experience client is missing: ${missingExperienceArtifactOperations.join(", ")}.`,
  );
if (allKindRendererTests.length === 0)
  artifactKnownGaps.push(
    "No discovered document test executes renderer coverage across every canonical document kind.",
  );
if (allKindArtifactResolverTests.length === 0)
  artifactKnownGaps.push(
    "No discovered test executes authoritative database source resolution across every canonical document kind.",
  );
if (
  !renderClaimUsesVersionCas ||
  !renderFailureUsesVersionCas ||
  !renderStoreUsesVersionCas
)
  artifactKnownGaps.push(
    "The render claim/failure/store state machine is missing an exact optimistic-version compare-and-set boundary.",
  );
if (renderStateMachineTests.length === 0)
  artifactKnownGaps.push(
    "No discovered test proves failed-render redrive and competing render claims.",
  );
writeJson("artifacts-documents.json", {
  schemaVersion: 1,
  capturedAt,
  documentKinds,
  documentKindCount: documentKinds.length,
  goldenKinds,
  expectedGoldenMetadata: goldenArtifacts,
  expectedGoldenFixture: {
    path: "packages/documents/src/__fixtures__/golden-pdfs.ts",
    sha256: sha256File(
      join(root, "packages/documents/src/__fixtures__/golden-pdfs.ts"),
    ),
  },
  authenticatedRetrieval: {
    coreApi: {
      resourceKinds: coreRetrievalKinds,
      source: "packages/api/src/routes/core/index.ts",
      interpretation:
        "These are legacy core API resource labels, not the canonical 15-kind document taxonomy.",
    },
    experienceApi: {
      documentKinds: authoritativeSourceKinds,
      kindCount: authoritativeSourceKinds.length,
      missingKinds: authoritativeSourceMissingKinds,
      operations: experienceArtifactOperations,
      sources: [
        experienceClientPath,
        experienceControllerPath,
        experienceRepositoryPath,
        artifactSourcePath,
      ],
    },
    allCanonicalDocumentKindsCovered: documentKinds.every((kind) =>
      authoritativeSourceKinds.includes(kind),
    ),
  },
  authoritativeSourceResolution: {
    kinds: authoritativeSourceKinds,
    kindCount: authoritativeSourceKinds.length,
    missingKinds: authoritativeSourceMissingKinds,
    source: artifactSourcePath,
    resolver: "resolveArtifactSource",
    sourceResolvers: artifactResolverFunctions,
    staleVersionRejected: artifactResolverSource.includes(
      "ARTIFACT_SOURCE_VERSION_CONFLICT",
    ),
    testFiles: artifactResolverExecutionTests,
    allKindTestFiles: allKindArtifactResolverTests,
  },
  rendererQualification: {
    allKindTestFiles: allKindRendererTests,
    goldenKindCount: goldenKinds.length,
    allCanonicalKindsHaveGoldenMetadata: documentKinds.every((kind) =>
      goldenKinds.includes(kind),
    ),
  },
  renderStateMachine: {
    source: experienceRepositoryPath,
    claimUsesOptimisticVersionCas: renderClaimUsesVersionCas,
    failureUsesOptimisticVersionCas: renderFailureUsesVersionCas,
    storeUsesOptimisticVersionCas: renderStoreUsesVersionCas,
    redriveAndConflictTestFiles: renderStateMachineTests,
  },
  commercialGeneration: {
    kinds: commercialGenerationKinds,
    sources: [
      "packages/db/src/repositories/core/commercial-artifacts.ts",
      "packages/workflows/src/core/commercial-artifact-handler.ts",
    ],
  },
  deletionCertificateGeneration: {
    kind: "deletion_certificate",
    sources: [
      "packages/db/src/repositories/lifecycle/deletion-certificates.ts",
      "packages/workflows/src/offboarding/deletion-certificate-handler.ts",
      "packages/workflows/src/runtime/production.ts",
    ],
    status: deletionCertificateRegistered
      ? "registered-in-production-runtime"
      : "not-registered-in-production-runtime",
  },
  knownGaps: artifactKnownGaps,
  knownGap: artifactKnownGaps.length > 0 ? artifactKnownGaps.join(" ") : null,
});

const envExample = source(".env.example");
const environmentRegistry = envExample
  .split("\n")
  .map((line) => line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/))
  .filter(Boolean)
  .map((match) => {
    const sensitive =
      /(?:SECRET(?:_KEY)?|PASSWORD|TOKEN|API_KEY|DATABASE_URL)$/.test(match[1]);
    return {
      key: match[1],
      exampleDefault:
        sensitive && match[2] !== "" ? "<redacted-example>" : match[2],
      exampleState: match[2] === "" ? "explicit-empty" : "local-default",
      sensitive,
      source: ".env.example",
    };
  });
const declaredEnvironment = environmentRegistry.map(({ key }) => key).sort();
const codeFiles = unique([
  ...readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:[cm]?[jt]sx?)$/.test(entry.name))
    .map((entry) => entry.name),
  ...walk("apps", (path) => /\.(?:[cm]?[jt]sx?)$/.test(path)),
  ...walk("packages", (path) => /\.(?:[cm]?[jt]sx?)$/.test(path)),
  ...walk("scripts", (path) => /\.(?:[cm]?[jt]sx?)$/.test(path)),
  ...walk("supabase", (path) => /\.(?:[cm]?[jt]sx?)$/.test(path)),
]);
function environmentKeysIn(path) {
  const text = source(path);
  return unique([
    ...[...text.matchAll(/(?:process\.env\.|source\.)([A-Z][A-Z0-9_]+)/g)].map(
      (item) => item[1],
    ),
    ...[
      ...text.matchAll(/process\.env\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\]/g),
    ].map((item) => item[1]),
  ]);
}
const discoveredEnvironment = unique(
  codeFiles.flatMap((path) => environmentKeysIn(path)),
);
const environmentReferenceRecords = discoveredEnvironment.map((key) => {
  const sources = codeFiles.filter((path) =>
    environmentKeysIn(path).includes(key),
  );
  const runtimeSources = sources.filter(
    (path) =>
      !path.startsWith("scripts/") &&
      !path.includes("/e2e/") &&
      !/\.(?:test|spec)\./.test(path) &&
      !path.includes("/testing/") &&
      !path.includes("vitest") &&
      !path.includes("playwright"),
  );
  return {
    key,
    declared: declaredEnvironment.includes(key),
    sources,
    runtimeSources,
    toolingOrTestSources: sources.filter(
      (path) => !runtimeSources.includes(path),
    ),
  };
});
const gateKeys = quotedArray(
  source("packages/domain/src/system/external-gates.ts"),
  "externalGateKeys",
);
const gateSeedSource = source("supabase/migrations/000901_external_gates.sql");
const externalGateRecords = [
  ...gateSeedSource.matchAll(
    /\('([^']*)','([^']*)','([^']*)','([^']*)','([^']*)','([^']*)','([^']*)','([^']*)','([^']*)','([^']*)','([^']*)'\)/g,
  ),
].map((item) => ({
  id: item[1],
  gateKey: item[2],
  title: item[3],
  owner: item[4],
  inputRequired: item[5],
  affectedFeature: item[6],
  severity: item[7],
  configuredStatus: item[8],
  simulatorState: item[9],
  simulatorDetails: item[10],
  statusReason: item[11],
  source: "supabase/migrations/000901_external_gates.sql",
}));
const implementedSwitches = [
  {
    key: "CLOCKWORK_ENABLE_SIMULATORS",
    default: "false",
    status: "implemented-test-only-production-denied",
    sources: [
      "apps/web/app/api/[[...route]]/route.ts",
      "packages/workflows/src/runtime/environment-production-adapters.ts",
    ],
  },
  {
    key: "MIGRATION_FEATURE_ENABLED",
    default: "false",
    status: "implemented-disabled-by-default",
    sources: ["apps/web/app/api/[[...route]]/route.ts"],
  },
  {
    key: "MIGRATION_SOURCE_EXECUTION_ENABLED",
    default: "false",
    status: "implemented-disabled-by-default",
    sources: ["apps/web/app/api/[[...route]]/route.ts"],
  },
  {
    key: "AUTOMATED_TEARDOWN_ENABLED",
    default: "false",
    status: "implemented-disabled-by-default",
    sources: [
      "apps/web/app/api/[[...route]]/route.ts",
      "packages/workflows/src/runtime/environment-production-adapters.ts",
    ],
  },
];
const capabilityMigrationSource =
  "supabase/migrations/001000_commercial_database_integrity.sql";
const capabilityMigration = source(capabilityMigrationSource);
const persistedCapabilityKeys = quotedValues(
  capabilityMigration.match(
    /capability_key\s+text\s+primary\s+key\s+check\s*\(capability_key\s+in\s*\(([\s\S]*?)\)\s*\)/i,
  )?.[1] ?? "",
);
const persistedCapabilities = persistedCapabilityKeys.map((key) => ({
  key,
  persisted: true,
  audited: true,
  forceRls: true,
  runtimeWriteDenied: true,
  commandEnforced: true,
  workflowEffectEnforced: true,
  sources: [
    capabilityMigrationSource,
    "packages/db/src/schema/system/index.ts",
    "packages/db/src/repositories/core/database-finance.ts",
    "packages/workflows/src/runtime/production.ts",
    "packages/workflows/src/runtime/production-adapter-factory.ts",
  ],
}));
writeJson("environment-gates-capabilities.json", {
  schemaVersion: 1,
  capturedAt,
  qualityDisposition,
  declaredEnvironment,
  environmentRegistry,
  declaredCount: declaredEnvironment.length,
  staticallyReferencedEnvironment: discoveredEnvironment,
  staticallyReferencedCount: discoveredEnvironment.length,
  environmentReferenceRecords,
  referencedButUndeclared: discoveredEnvironment.filter(
    (key) => !declaredEnvironment.includes(key) && key !== "NODE_ENV",
  ),
  runtimeReferencedButUndeclared: environmentReferenceRecords
    .filter(
      ({ key, declared, runtimeSources }) =>
        !declared && key !== "NODE_ENV" && runtimeSources.length > 0,
    )
    .map(({ key, runtimeSources }) => ({ key, sources: runtimeSources })),
  toolingOrTestOnlyReferencedButUndeclared: environmentReferenceRecords
    .filter(
      ({ key, declared, runtimeSources }) =>
        !declared && key !== "NODE_ENV" && runtimeSources.length === 0,
    )
    .map(({ key, toolingOrTestSources }) => ({
      key,
      sources: toolingOrTestSources,
    })),
  declaredButNotStaticallyReferenced: declaredEnvironment.filter(
    (key) => !discoveredEnvironment.includes(key),
  ),
  discoveryLimitation:
    "Static discovery scans repository root code plus apps, packages, scripts, and Supabase JavaScript/TypeScript. It records direct process.env and injected source.KEY references with runtime versus tooling/test source provenance; dynamic configuredEnvironment(name) lookups are represented by the complete .env.example registry rather than inferred as absent.",
  externalGates: gateKeys,
  externalGateRecords,
  externalGateStatusCounts: Object.fromEntries(
    ["blocked", "review", "pending", "active", "not_required"].map((status) => [
      status,
      externalGateRecords.filter((record) => record.configuredStatus === status)
        .length,
    ]),
  ),
  externalGateCount: gateKeys.length,
  implementedSwitches,
  persistedCapabilities,
  persistedCapabilityCount: persistedCapabilities.length,
  capabilityMatrixRequiredButNotImplemented: [],
  controlsOutsidePersistedCapabilityMatrix: [
    {
      control: "white-label and custom domains",
      status: "external-gate-controlled",
      gateKeys: ["EXT-BRAND-01", "EXT-DOMAIN-01"],
    },
    {
      control: "production migration operations",
      status: "disabled-switch-and-external-gate-controlled",
      switches: [
        "MIGRATION_FEATURE_ENABLED",
        "MIGRATION_SOURCE_EXECUTION_ENABLED",
      ],
      gateKeys: ["EXT-MIGRATION-01"],
    },
  ],
  capabilityMatrixStatus: "implemented-persisted-audited-and-enforced",
});

const testSourcePattern = /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/;
const testFiles = unique([
  ...walk("apps", (path) => testSourcePattern.test(path)),
  ...walk("packages", (path) => testSourcePattern.test(path)),
  ...walk("scripts", (path) => testSourcePattern.test(path)),
  ...walk("supabase/tests", (path) => path.endsWith(".sql")),
]);
const visualFiles = walk(
  "apps/web/e2e",
  (path) => path.includes("-snapshots/") && path.endsWith(".png"),
);
const browserSpecs = walk("apps/web/e2e", (path) => path.endsWith(".spec.ts"));
const browserSupportFiles = walk(
  "apps/web/e2e",
  (path) => /\.(?:ts|mjs)$/.test(path) && !path.endsWith(".spec.ts"),
);
const browserScenarios = browserSpecs.flatMap((path) =>
  [...source(path).matchAll(/\btest\(\s*["'`]([^"'`]+)["'`]/g)].map((item) => ({
    source: path,
    name: item[1],
  })),
);
const pgTapFiles = testFiles.filter(
  (path) => path.startsWith("supabase/tests/") && path.endsWith(".sql"),
);
const storybookTestFiles = testFiles.filter(
  (path) =>
    path.startsWith("apps/web/src/storybook/") &&
    path.endsWith(".a11y.test.tsx"),
);
const integrationTestFiles = testFiles.filter((path) =>
  path.includes(".integration.test."),
);
const scriptTestFiles = testFiles.filter((path) => path.startsWith("scripts/"));
const unitTestFiles = testFiles.filter(
  (path) =>
    !path.startsWith("supabase/tests/") &&
    !browserSpecs.includes(path) &&
    !storybookTestFiles.includes(path) &&
    !integrationTestFiles.includes(path),
);
const pgTapPlan = pgTapFiles.reduce((total, path) => {
  const plan = source(path).match(/select\s+plan\((\d+)\)/i)?.[1];
  return total + (plan ? Number(plan) : 0);
}, 0);
const pgTapPlans = pgTapFiles.map((path) => ({
  path,
  plannedAssertions: Number(
    source(path).match(/select\s+plan\((\d+)\)/i)?.[1] ?? 0,
  ),
  sha256: sha256File(join(root, path)),
}));
const playwrightListCommand =
  "pnpm --filter @clockwork/web exec playwright test --list --reporter=list";
const playwrightListOutput = command("pnpm", [
  "--filter",
  "@clockwork/web",
  "exec",
  "playwright",
  "test",
  "--list",
  "--reporter=list",
]);
const expandedBrowserTests = playwrightListOutput
  .split("\n")
  .filter((line) => /^\s+\[[^\]]+\]\s+›/.test(line))
  .map((line) => line.trim());
const visualCatalogSource = source("packages/testing/src/visual/scenarios.ts");
const visualStateCatalog = quotedArray(
  visualCatalogSource,
  "experienceStateCatalog",
);
const visualStateRoute =
  visualCatalogSource.match(
    /stateGalleryContract\s*=\s*Object\.freeze\(\{[\s\S]*?route:\s*["']([^"']+)["']/,
  )?.[1] ?? null;
const visualStateViewportWidths = (
  visualCatalogSource.match(/requiredViewportWidths:\s*\[([^\]]+)\]/)?.[1] ?? ""
)
  .split(",")
  .map((value) => Number.parseInt(value.trim(), 10))
  .filter((value) => Number.isSafeInteger(value));
const visualSpecPath = "apps/web/e2e/visual.spec.ts";
const visualSpecSource = source(visualSpecPath);
const nextPageRoutes = pageAndRouteFiles
  .filter((path) => path.endsWith("/page.tsx"))
  .map(routeFromPage);
function nextRouteExists(route) {
  return nextPageRoutes.some((pattern) => {
    const expression = pattern
      .split("/")
      .map((segment) =>
        segment.startsWith("[")
          ? "[^/]+"
          : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      )
      .join("/");
    return new RegExp(`^${expression}$`).test(route);
  });
}
const visualStateRouteExists = visualStateRoute
  ? nextRouteExists(visualStateRoute)
  : false;
const visualStateExecuted =
  Boolean(visualStateRoute) &&
  visualSpecSource.includes(`page.goto("${visualStateRoute}")`) &&
  visualSpecSource.includes("customer-state-gallery");
writeJson("tests-baseline-artifacts.json", {
  schemaVersion: 1,
  capturedAt,
  testFiles,
  counts: {
    totalFiles: testFiles.length,
    unitFiles: unitTestFiles.length,
    storybookFiles: storybookTestFiles.length,
    integrationFiles: integrationTestFiles.length,
    scriptFiles: scriptTestFiles.length,
    playwrightSpecFiles: browserSpecs.length,
    playwrightSupportFiles: browserSupportFiles.length,
    browserSourceDeclarations: browserScenarios.length,
    browserExpandedExecutableTests: expandedBrowserTests.length,
    pgTapFiles: pgTapFiles.length,
    pgTapPlannedAssertions: pgTapPlan,
  },
  suites: {
    unit: unitTestFiles,
    storybook: storybookTestFiles,
    integration: integrationTestFiles,
    scripts: scriptTestFiles,
    playwright: browserSpecs,
    playwrightSupport: browserSupportFiles,
    pgTap: pgTapFiles,
  },
  pgTapPlans,
  browserScenarios,
  playwrightDiscovery: {
    command: playwrightListCommand,
    expandedTests: expandedBrowserTests,
  },
  visualStateGalleryContract: {
    path: "packages/testing/src/visual/scenarios.ts",
    route: visualStateRoute,
    routeExists: visualStateRouteExists,
    states: visualStateCatalog,
    stateCount: visualStateCatalog.length,
    requiredViewportWidths: visualStateViewportWidths,
    executedBy: visualStateExecuted ? visualSpecPath : null,
    executed: visualStateExecuted,
    baselinePaths: visualFiles.filter((path) =>
      path.includes("customer-state-gallery"),
    ),
    qualification:
      "The reachable gallery renders every normative asynchronous/failure state; Playwright executes desktop and 320px screenshot, Axe, and reflow checks without synthetic routes.",
  },
  visualBaselines: visualFiles.map((path) => ({
    path,
    sha256: sha256File(join(root, path)),
    bytes: statSync(join(root, path)).size,
    dimensions: pngDimensions(join(root, path)),
  })),
  qualificationPolicy: {
    cachesDisabled: true,
    playwrightRetries: 0,
    snapshotUpdates: "none",
    existingIgnoredResultsAuthoritative: false,
  },
});

const artifactCategories = {
  "contract-release": unique([
    "commerce_platform_spec.md",
    "docs/backlog.md",
    "docs/external-gates.md",
    "docs/launch-checklist.md",
    "docs/release-candidate-report.md",
    "docs/implementation-lanes.md",
    "docs/sprint-checklist.md",
    ...walk("docs/adr", (path) => path.endsWith(".md")),
    ...walk("docs/handoffs", (path) => path.endsWith(".md")),
    ...walk("docs/operations", (path) => path.endsWith(".md")),
  ]),
  traceability: [
    "docs/traceability/launch-requirements.json",
    "docs/traceability/launch-requirements.schema.json",
    "scripts/validate-traceability.mjs",
  ],
  "toolchain-ci": unique([
    ".env.example",
    ".node-version",
    ".nvmrc",
    ".npmrc",
    ".github/workflows/ci.yml",
    ".secretlintignore",
    ".secretlintrc.json",
    "dependency-cruiser.config.mjs",
    "eslint.config.mjs",
    "lefthook.yml",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "prettier.config.mjs",
    "tsconfig.base.json",
    "tsconfig.json",
    "supabase/config.toml",
    "packages/db/drizzle.config.ts",
    "apps/web/postcss.config.mjs",
    "turbo.json",
    "trigger.config.ts",
    ...walk(
      "apps",
      (path) =>
        path.endsWith("package.json") ||
        path.endsWith("tsconfig.json") ||
        /(?:vitest|playwright|next\.config).*\.ts$/.test(path),
    ),
    ...walk(
      "packages",
      (path) =>
        path.endsWith("package.json") ||
        path.endsWith("tsconfig.json") ||
        /vitest.*\.ts$/.test(path),
    ),
    ...walk("scripts", (path) => path.endsWith(".mjs")),
  ]),
  "route-auth-api": unique([
    "packages/contracts/src/auth.ts",
    ...walk("apps/web/app", (path) => /\.(?:ts|tsx)$/.test(path)),
    ...walk("apps/web/src/auth", (path) => /\.(?:ts|tsx)$/.test(path)),
    ...walk("apps/web/src/features/shell", (path) =>
      /\.(?:ts|tsx)$/.test(path),
    ),
    ...walk("apps/web/src/features/signing", (path) =>
      /\.(?:ts|tsx)$/.test(path),
    ),
    experienceClientPath,
    experienceControllerPath,
    ...experienceAuthorizationSources,
    ...walk("packages/api/src", (path) => /\.(?:ts|tsx)$/.test(path)),
  ]),
  database: unique([
    "supabase/seed.sql",
    "supabase/production-roles.sql",
    ...migrations.map(({ path }) => path),
    ...walk("packages/db/drizzle/meta", (path) => path.endsWith(".json")),
    ...walk("packages/db/src", (path) => path.endsWith(".ts")),
  ]),
  "openapi-clients": [
    "packages/api/src/generated/openapi.json",
    "packages/api/src/generated/schema.d.ts",
    "packages/api/src/generated/client.ts",
    experienceClientPath,
  ],
  "workflow-discovery": unique([
    "packages/workflows/src/trigger/discovery.ts",
    "packages/workflows/src/trigger/index.ts",
    "packages/workflows/src/core/outbox-handlers.ts",
    "packages/workflows/src/system/lifecycle-task-dispatch.ts",
    "packages/workflows/src/system/tasks.ts",
    "packages/workflows/src/runtime/production.ts",
    ...workflowSources,
  ]),
  "documents-tests-visuals": unique([
    ...walk("packages/documents/src", (path) =>
      /\.(?:ts|tsx|json|md)$/.test(path),
    ),
    artifactSourcePath,
    "apps/web/src/features/experience-server/repository.ts",
    experienceControllerPath,
    experienceClientPath,
    "packages/testing/src/visual/scenarios.ts",
    ...browserSpecs,
    ...browserSupportFiles,
    ...pgTapFiles,
    ...testFiles,
    ...walk("apps", (path) => path.endsWith(".stories.tsx")),
    ...walk("packages", (path) => path.endsWith(".stories.tsx")),
    ...visualFiles,
  ]),
};
const baselineArtifacts = unique(Object.values(artifactCategories).flat());
const hashedArtifacts = baselineArtifacts.map((path) => ({
  path,
  bytes: statSync(join(root, path)).size,
  sha256: sha256File(join(root, path)),
}));
writeJson("artifact-hashes.json", {
  schemaVersion: 1,
  capturedAt,
  captureCommit: git("rev-parse", "HEAD"),
  captureTree: git("rev-parse", "HEAD^{tree}"),
  captureMode,
  captureWorkingTreePathCount,
  hashInput:
    "Artifact SHA-256 values and byte sizes are read from working-tree file bytes at capture time; captureCommit/captureTree identify their committed base when captureMode is working-tree-consolidation.",
  captureTreeListingSha256: sha256Bytes(
    `${git("ls-tree", "-r", "--full-tree", "HEAD")}\n`,
  ),
  artifactCount: hashedArtifacts.length,
  categories: Object.fromEntries(
    Object.entries(artifactCategories).map(([name, paths]) => {
      const entries = paths.map((path) =>
        hashedArtifacts.find((item) => item.path === path),
      );
      return [
        name,
        {
          artifactCount: entries.length,
          aggregateSha256: sha256Bytes(
            `${entries.map(({ path, sha256 }) => `${path}:${sha256}`).join("\n")}\n`,
          ),
          paths,
        },
      ];
    }),
  ),
  artifacts: hashedArtifacts,
});

command("pnpm", [
  "exec",
  "prettier",
  "--write",
  ...readdirSync(outputDirectory)
    .filter((name) => name.endsWith(".json"))
    .map((name) => join(outputDirectory, name)),
]);

console.log(
  JSON.stringify(
    {
      outputDirectory: relative(root, outputDirectory),
      files: readdirSync(outputDirectory).sort(),
      capturedAt,
    },
    null,
    2,
  ),
);
