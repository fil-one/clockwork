import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  accessMatrixMarkdown,
  permissionDescriptions,
  permissionModelMarker,
  permissionModelSql,
  roleDescriptions,
} from "./access-model";
import {
  organizationSides,
  permissions,
  rolePermissions,
  roles,
  sideRoles,
} from "./auth";

const root = resolve(import.meta.dirname, "../../..");
const migrations = join(root, "supabase/migrations");

function latestGeneratedMigration(): { name: string; text: string } {
  const name = readdirSync(migrations)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .reverse()
    .find((file) =>
      readFileSync(join(migrations, file), "utf8").startsWith(
        `-- ${permissionModelMarker}`,
      ),
    );
  if (!name) throw new Error("no generated permission-model migration");
  return { name, text: readFileSync(join(migrations, name), "utf8") };
}

describe("the database mirror of the role table", () => {
  it("matches auth.ts exactly in the newest generated migration", () => {
    // When this fails, run `pnpm generate:access-model --migration
    // supabase/migrations/<next>.sql`: migrations are append-only.
    expect(latestGeneratedMigration().text).toBe(permissionModelSql());
  });

  it("lists every role's whole bundle and nothing else", () => {
    const sql = permissionModelSql();
    const rows = [...sql.matchAll(/^\s+\('([a-z_]+)', '([a-z:_]+)'\)/gmu)].map(
      ([, first, second]) => `${first} ${second}`,
    );
    const expected = [
      ...roles.flatMap((role) =>
        rolePermissions[role].map((permission) => `${role} ${permission}`),
      ),
      ...organizationSides.flatMap((side) =>
        sideRoles[side].map((role) => `${side} ${role}`),
      ),
      "referral_partner partner:quote:write",
    ];
    expect(rows.sort()).toEqual(expected.sort());
  });
});

describe("the generated access matrix", () => {
  const document = readFileSync(
    join(root, "docs/security/access-matrix.md"),
    "utf8",
  );

  it("is current with auth.ts", () => {
    // The enforcement section is checked by `pnpm check:generated`, which
    // scans the application; everything above it comes from contracts alone.
    expect(document.startsWith(accessMatrixMarkdown())).toBe(true);
  });

  it("gives every role and permission a plain description", () => {
    for (const role of roles) expect(roleDescriptions[role].label).toBeTruthy();
    for (const permission of permissions)
      expect(permissionDescriptions[permission]).toBeTruthy();
    // No em dashes in generated documentation.
    expect(document).not.toContain(String.fromCharCode(0x2014));
  });

  it("marks exactly the bundles in the role table", () => {
    const row = (permission: string) =>
      document
        .split("\n")
        .find(
          (line) =>
            line.startsWith(`| \`${permission}\` | `) && line.includes(" x "),
        );
    expect(
      row("signatory:manage")
        ?.split("|")
        .filter((cell) => cell.trim() === "x"),
    ).toHaveLength(1);
    expect(row("staff:manage")).toMatch(/\| x \|$/u);
  });
});
