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
      ignoredArtifactListingSha256: sha256Bytes(ignoredListing),
      porcelainSha256: sha256Bytes(`${statusLines.join("\n")}\n`),
    },
  };
});

const bundlePath =
  "/Users/jameskurz/Downloads/Fil One/Clockwork-pre-consolidation-20260731.bundle";
const legacyAndPreservationRefs = [
  "commerce/foundation",
  "commerce/core-finance",
  "commerce/lifecycle-platform",
  "commerce/experience-docs",
  "commerce/integration",
  "ux/design-shell",
  "ux/customer-partner",
  "ux/internal-ops",
  "ux/integration",
  "6eec5773ab0dd4f578464a4dd88aa4982d5f3e5a",
  "92d10d3b8a12728804b70215799f9929e880c996",
  "c2f1e8c5ed0704956a004db6de518316bfd0f44f",
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
const ancestryAssertions = legacyAndPreservationRefs.map((ref) => {
  let represented = true;
  try {
    command("git", ["merge-base", "--is-ancestor", ref, "main"]);
  } catch {
    represented = false;
  }
  return {
    ref,
    commit: git("rev-parse", `${ref}^{commit}`),
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
  ? command("git", ["bundle", "list-heads", bundlePath])
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const split = line.indexOf(" ");
        return { object: line.slice(0, split), ref: line.slice(split + 1) };
      })
  : [];
const bundleVerification = (() => {
  if (!existsSync(bundlePath)) return { status: "missing", exitCode: null };
  const result = spawnSync("git", ["bundle", "verify", bundlePath], {
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
    command: `git bundle verify ${bundlePath}`,
    output: output.trim().split("\n"),
    outputSha256: sha256Bytes(output),
  };
})();
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
  captureMode:
    "Pre-commit preservation/setup capture: captureCommit identifies the last committed tree; worktree status separately enumerates every setup input that the manifest commit will add.",
  mainBase: "92d10d3b8a12728804b70215799f9929e880c996",
  releaseCandidateBaseRef: "rc-lanes-base-20260731^{commit}",
  releaseCandidateBaseCommit: null,
  releaseCandidateBaseTree: null,
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
      roots: status.ignoredRoots,
      artifactCount: status.ignoredArtifactCount,
      listingSha256: status.ignoredArtifactListingSha256,
      decision: "rejected-generated-or-local-only",
    })),
  },
  mergeCommits,
  releaseCandidateLanes: [
    {
      ref: "rc/commercial-integrity",
      worktree: "/Users/jameskurz/Downloads/Fil One/Clockwork-rc-commercial",
      migrationRange: "001000-001099",
      base: "rc-lanes-base-20260731^{commit}",
    },
    {
      ref: "rc/runtime-operations",
      worktree: "/Users/jameskurz/Downloads/Fil One/Clockwork-rc-runtime",
      migrationRange: "001100-001199",
      base: "rc-lanes-base-20260731^{commit}",
    },
    {
      ref: "rc/experience-release",
      worktree: "/Users/jameskurz/Downloads/Fil One/Clockwork-rc-experience",
      migrationRange: "001200-001299",
      base: "rc-lanes-base-20260731^{commit}",
    },
  ],
  preConsolidation: {
    annotatedTag: "pre-consolidation-20260731",
    tagObject: tagNames.includes("pre-consolidation-20260731")
      ? git("rev-parse", "pre-consolidation-20260731^{tag}")
      : null,
    bundlePath,
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
        mountedPath: `/api${path}`,
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
          : "integration";
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
  plannedReleaseCandidateRanges: {
    "rc/commercial-integrity": "001000-001099",
    "rc/runtime-operations": "001100-001199",
    "rc/experience-release": "001200-001299",
  },
  limitation:
    "Canonical SQL, not Drizzle snapshots, owns RLS, grants, roles, triggers, and views. Source expansion records literal foreach arrays, but executed qualification remains authoritative for effective catalog state.",
});

writeJson("openapi-clients.json", {
  schemaVersion: 1,
  capturedAt,
  openapiVersion: openapi.openapi,
  paths: Object.keys(openapi.paths ?? {}).length,
  operations: apiOperations.length,
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
  ].map(({ path, kind }) => ({
    path,
    kind,
    sha256: sha256File(join(root, path)),
    bytes: statSync(join(root, path)).size,
  })),
  generationCommand: "pnpm generate",
  driftCommand: "pnpm check:generated",
  limitation:
    "client.ts is a stable handwritten wrapper around the generated paths type; it is checked for drift as an artifact but is not emitted by the OpenAPI generator.",
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
const schedules = workflowSources.flatMap((path) => {
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
const productionCompositionTopics = [
  "organization.created",
  "termination.deletion_certificate_requested",
  "commerce.commercial_artifact_requested",
];
const staticallyComposableOutboxTopics = unique([
  ...lifecycleOutboxTopics,
  ...coreOutboxTopics,
  ...productionCompositionTopics,
]);
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
  const events = eventsExpression.startsWith("[")
    ? quotedValues(eventsExpression)
    : eventsExpression === "invoiceDraftTopics"
      ? ["core.invoice.draft_ready", "core.invoices.create"]
      : eventsExpression === "commissionStatementTopic"
        ? ["core.commission_statement.generated"]
        : [];
  return {
    taskId,
    events,
    eventsExpression,
    schedules: quotedValues(scheduleBlock),
    source: "packages/workflows/src/core/outbox-handlers.ts",
    registeredTriggerSchedule: false,
  };
});
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
    productionCompositionTopics,
    unconditionalCompositionTopics: ["organization.created"],
    conditionalCompositionTopics: [
      "termination.deletion_certificate_requested",
      "commerce.commercial_artifact_requested",
    ],
    staticallyComposableTopics: staticallyComposableOutboxTopics,
    staticallyComposableTopicCount: staticallyComposableOutboxTopics.length,
    handlerContributionCount:
      lifecycleOutboxTopics.length +
      coreOutboxTopics.length +
      productionCompositionTopics.length,
    overlappingTopics: lifecycleOutboxTopics.filter((topic) =>
      coreOutboxTopics.includes(topic),
    ),
    sources: [
      "packages/workflows/src/system/lifecycle-task-dispatch.ts",
      "packages/workflows/src/core/outbox-handlers.ts",
      "packages/workflows/src/runtime/production.ts",
    ],
  },
  coreDispatchPlan: {
    tasks: coreDispatchPlan,
    taskCount: coreDispatchPlan.length,
    scheduleIntentCount: coreDispatchPlan.reduce(
      (total, item) => total + item.schedules.length,
      0,
    ),
    registeredTriggerScheduleCount: 0,
  },
  knownGaps: [
    "Six core operations have seven schedule intents in the dispatch plan but no registered Trigger schedules.",
    "Twenty-four lifecycle task IDs still require authoritative planner/state/provider execution per backlog.",
  ],
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
const retrievalKinds = [
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
    kinds: retrievalKinds,
    source: "packages/api/src/routes/core/index.ts",
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
    status: "conditional-runtime-composition",
  },
  knownGap:
    "The fixture records expected metadata for all 15 document kinds; executed qualification must prove renderer output. Authenticated retrieval exposes four stored artifact kinds, commercial generation covers five kinds, and deletion-certificate generation is conditional, so end-to-end delivery is not complete for all 15.",
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
const codeFiles = [
  ...readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:ts|tsx|mjs)$/.test(entry.name))
    .map((entry) => entry.name),
  ...walk("apps", (path) => /\.(?:ts|tsx|mjs)$/.test(path)),
  ...walk("packages", (path) => /\.(?:ts|tsx|mjs)$/.test(path)),
];
const discoveredEnvironment = unique(
  codeFiles.flatMap((path) => {
    const text = source(path);
    return [
      ...[
        ...text.matchAll(/(?:process\.env\.|source\.)([A-Z][A-Z0-9_]+)/g),
      ].map((item) => item[1]),
      ...[
        ...text.matchAll(/process\.env\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\]/g),
      ].map((item) => item[1]),
    ];
  }),
);
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
writeJson("environment-gates-capabilities.json", {
  schemaVersion: 1,
  capturedAt,
  declaredEnvironment,
  environmentRegistry,
  declaredCount: declaredEnvironment.length,
  staticallyReferencedEnvironment: discoveredEnvironment,
  staticallyReferencedCount: discoveredEnvironment.length,
  referencedButUndeclared: discoveredEnvironment.filter(
    (key) => !declaredEnvironment.includes(key) && key !== "NODE_ENV",
  ),
  declaredButNotStaticallyReferenced: declaredEnvironment.filter(
    (key) => !discoveredEnvironment.includes(key),
  ),
  discoveryLimitation:
    "Static discovery sees direct process.env and injected source.KEY references; dynamic configuredEnvironment(name) lookups are represented by the complete .env.example registry rather than inferred as absent.",
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
  capabilityMatrixRequiredButNotImplemented: [
    "new-business commerce",
    "legal execution",
    "paid provisioning and invoicing",
    "partner referral/resale/distributor paths",
    "white-label and custom domains",
    "marketplace paths",
    "automated teardown operations",
    "production migration operations",
  ],
  capabilityMatrixStatus:
    "backlog-partial-no-persisted-audited-command-and-effect-boundary-matrix",
});

const testFiles = [
  ...walk("apps", (path) => /\.(?:test|spec)\.(?:ts|tsx)$/.test(path)),
  ...walk("packages", (path) => /\.(?:test|spec)\.(?:ts|tsx)$/.test(path)),
  ...walk("supabase/tests", (path) => path.endsWith(".sql")),
];
const visualFiles = walk(
  "apps/web/e2e",
  (path) => path.includes("-snapshots/") && path.endsWith(".png"),
);
const browserSpecs = walk("apps/web/e2e", (path) => path.endsWith(".spec.ts"));
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
const visualCatalog = [
  ...visualCatalogSource.matchAll(
    /\{\s*id:\s*["']([^"']+)["'],\s*route:\s*["']([^"']+)["'],\s*persona:\s*["']([^"']+)["'],\s*state:\s*["']([^"']+)["'],\s*viewport:\s*["']([^"']+)["'],\s*colorScheme:\s*["']([^"']+)["']/g,
  ),
].map((item) => ({
  id: item[1],
  route: item[2],
  persona: item[3],
  state: item[4],
  viewport: item[5],
  colorScheme: item[6],
}));
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
const absentVisualCatalogRoutes = unique(
  visualCatalog
    .map(({ route }) => route)
    .filter((route) => !nextRouteExists(route)),
);
writeJson("tests-baseline-artifacts.json", {
  schemaVersion: 1,
  capturedAt,
  testFiles,
  counts: {
    totalFiles: testFiles.length,
    unitFiles: unitTestFiles.length,
    storybookFiles: storybookTestFiles.length,
    integrationFiles: integrationTestFiles.length,
    playwrightSpecFiles: browserSpecs.length,
    browserSourceDeclarations: browserScenarios.length,
    browserExpandedExecutableTests: expandedBrowserTests.length,
    pgTapFiles: pgTapFiles.length,
    pgTapPlannedAssertions: pgTapPlan,
  },
  suites: {
    unit: unitTestFiles,
    storybook: storybookTestFiles,
    integration: integrationTestFiles,
    playwright: browserSpecs,
    pgTap: pgTapFiles,
  },
  pgTapPlans,
  browserScenarios,
  playwrightDiscovery: {
    command: playwrightListCommand,
    expandedTests: expandedBrowserTests,
  },
  visualScenarioCatalog: {
    path: "packages/testing/src/visual/scenarios.ts",
    scenarioCount: visualCatalog.length,
    uniqueRouteCount: unique(visualCatalog.map(({ route }) => route)).length,
    scenarios: visualCatalog,
    absentNextRoutes: absentVisualCatalogRoutes,
    absentNextRouteCount: absentVisualCatalogRoutes.length,
    limitation:
      "The 14-scenario release catalog is distinct from the four checked-in Playwright screenshot baselines; absentNextRoutes records exact catalog/route-tree drift.",
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
    "packages/testing/src/visual/scenarios.ts",
    ...browserSpecs,
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
