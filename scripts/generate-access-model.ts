// Generates the access model's two derived artifacts from
// packages/contracts/src/auth.ts:
//
//   docs/security/access-matrix.md   the roles x permissions matrix, sides, and
//                                    where each permission is checked
//   supabase/migrations/<n>.sql      the role_permissions mirror (only with
//                                    --migration, since migrations are
//                                    append-only)
//
//   pnpm generate:access-model                       rewrite the matrix
//   pnpm generate:access-model --migration <file>    also write a migration
//   pnpm generate:access-model --check               fail when either is stale
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import process from "node:process";

import {
  accessMatrixMarkdown,
  permissionModelMarker,
  permissionModelSql,
  type PermissionEnforcement,
} from "../packages/contracts/src/access-model";
import { permissions } from "../packages/contracts/src/auth";

const root = resolve(import.meta.dirname, "..");
const matrixPath = join(root, "docs/security/access-matrix.md");
const migrationsDirectory = join(root, "supabase/migrations");

/** Application code that decides access: pages, actions, routes, navigation. */
const scannedRoots = [
  "apps/web/app",
  "apps/web/src/features",
  "packages/api/src/routes",
];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/u.test(name) &&
      !/\.(test|spec|stories)\.tsx?$/u.test(name)
      ? [path]
      : [];
  });
}

export function scanEnforcement(): PermissionEnforcement[] {
  const files = scannedRoots
    .flatMap((directory) => sourceFiles(join(root, directory)))
    .map((path) => ({
      path: relative(root, path),
      text: readFileSync(path, "utf8"),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return permissions.map((permission) => ({
    permission,
    places: files
      .filter(({ text }) => text.includes(`"${permission}"`))
      .map(({ path }) => `\`${path}\``),
  }));
}

/** The newest migration that carries the generated permission model. */
export function latestPermissionModelMigration(): string | undefined {
  return readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .reverse()
    .find((name) =>
      readFileSync(join(migrationsDirectory, name), "utf8").startsWith(
        `-- ${permissionModelMarker}`,
      ),
    );
}

function main(argv: readonly string[]) {
  const matrix = accessMatrixMarkdown(scanEnforcement());
  const sql = permissionModelSql();
  if (argv.includes("--check")) {
    const problems: string[] = [];
    let current = "";
    try {
      current = readFileSync(matrixPath, "utf8");
    } catch {
      // Reported below as stale.
    }
    if (current !== matrix)
      problems.push(
        "docs/security/access-matrix.md is stale: run pnpm generate:access-model",
      );
    const migration = latestPermissionModelMigration();
    if (!migration)
      problems.push("no migration carries the generated permission model");
    else if (
      readFileSync(join(migrationsDirectory, migration), "utf8") !== sql
    )
      problems.push(
        `supabase/migrations/${migration} no longer matches packages/contracts/src/auth.ts: write the next migration with pnpm generate:access-model --migration supabase/migrations/<next>.sql`,
      );
    if (problems.length) {
      for (const problem of problems) console.error(problem);
      process.exitCode = 1;
    }
    return;
  }
  writeFileSync(matrixPath, matrix);
  const target = argv[argv.indexOf("--migration") + 1];
  if (argv.includes("--migration")) {
    if (!target) throw new Error("--migration needs a file path");
    writeFileSync(resolve(process.cwd(), target), sql);
  }
}

main(process.argv.slice(2));
