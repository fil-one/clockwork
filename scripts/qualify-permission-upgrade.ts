// Rehearses the permission-model upgrade (migrations 001445 onward) on a
// populated database and proves every existing person keeps exactly the
// abilities they had, apart from the changes the release makes on purpose.
//
//   pnpm exec tsx scripts/qualify-permission-upgrade.ts \
//     --server postgresql://supabase_admin:postgres@127.0.0.1:<port>/postgres
//
// The server must be a Supabase Postgres image (the migrations expect its
// roles). A scratch database is created, migrated to the last version before
// the permission model, seeded, and given one person in every role on every
// side (scripts/fixtures/permission-upgrade-personas.sql). For each person the
// row policies are evaluated against every row of every table, for every
// command, with the claim the application signed before the upgrade (one role,
// a commerce administrator expanded into the four internal roles it acted
// as). The permission-model migrations are applied, the side backfill is
// checked, and the same evaluation runs with the claim the application signs
// now (every role held, and the permissions they confer). Any difference that
// is not listed in `expectedChanges` fails the run.
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

import postgres from "postgres";

import {
  permissionsForRoles,
  type OrganizationSide,
  type Role,
} from "../packages/contracts/src/auth";

const root = resolve(import.meta.dirname, "..");
const migrationsDirectory = join(root, "supabase/migrations");
const firstUpgradeMigration = "001445";
const database = "clockwork_permission_upgrade";

interface Persona {
  key: string;
  userId: string;
  accountId: string;
  organizationId: string;
  role: Role;
  isInternalStaff: boolean;
  /** An internal persona acting inside this account through an assisted session. */
  assistedAccountId?: string;
}

/**
 * Differences the release makes on purpose. Each entry names the persona key
 * prefix, the table and command, and why.
 */
const expectedChanges: readonly {
  persona: RegExp;
  table: RegExp;
  command: RegExp;
  why: string;
}[] = [
  {
    persona: /^referral_partner\//u,
    table: /^(quotes|quote_lines|core_quote_snapshots|core_quote_commercial_profiles)$/u,
    command: /^(insert|update)$/u,
    why: "a referral partner no longer holds partner:quote:write (it never could write a partner quote: the audit append was already refused)",
  },
  {
    persona: /^fil_one\/commerce_admin/u,
    table: /^audit_events$/u,
    command: /^insert$/u,
    why: "the finance confinement is monotone: an administrator appends as an operator does",
  },
  {
    persona: /^fil_one\/commerce_admin@assisted/u,
    table: /.*/u,
    command: /.*/u,
    why: "an assisted session no longer carries approver permissions",
  },
];

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function sessionRolesBeforeUpgrade(role: Role): Role[] {
  return role === "commerce_admin"
    ? [
        "commerce_admin",
        "internal_operator",
        "finance_approver",
        "legal_approver",
        "destructive_action_approver",
      ]
    : [role];
}

type Sql = postgres.Sql;

async function migrate(sql: Sql, predicate: (name: string) => boolean) {
  const files = readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith(".sql") && predicate(name))
    .sort();
  for (const name of files) {
    try {
      await sql.unsafe(readFileSync(join(migrationsDirectory, name), "utf8"));
    } catch (error) {
      throw new Error(`${name}: ${(error as Error).message}`);
    }
  }
  return files;
}

async function personas(sql: Sql): Promise<Persona[]> {
  const rows = await sql<
    {
      user_id: string;
      account_id: string;
      organization_id: string;
      role: Role;
      is_internal_staff: boolean;
      side: string;
    }[]
  >`
    select m.user_id, o.account_id, o.id as organization_id, m.role,
      u.is_internal_staff,
      case
        when m.role in ('partner_admin','partner_seller') then
          case when coalesce(a.partner_agreement_type,'referral') = 'referral'
            then 'referral_partner' else 'channel_partner' end
        when u.is_internal_staff then 'fil_one'
        else 'customer'
      end as side
    from memberships m
    join organizations o on o.id = m.organization_id
    join accounts a on a.id = o.account_id
    join commerce_users u on u.id = m.user_id
    order by side, m.role, m.user_id`;
  const list: Persona[] = rows.map((row) => ({
    key: `${row.side}/${row.role}#${row.user_id.slice(-4)}`,
    userId: row.user_id,
    accountId: row.account_id,
    organizationId: row.organization_id,
    role: row.role,
    isInternalStaff: row.is_internal_staff,
  }));
  for (const role of ["internal_operator", "commerce_admin"] as const) {
    const staff = list.find(
      (persona) => persona.role === role && persona.isInternalStaff,
    );
    if (staff)
      list.push({
        ...staff,
        key: `fil_one/${role}@assisted`,
        assistedAccountId: "10000000-0000-4000-8000-000000000001",
      });
  }
  return list;
}

function claims(
  persona: Persona,
  phase: "before" | "after",
  roles: readonly Role[],
  side: OrganizationSide,
) {
  const accountIds = persona.assistedAccountId
    ? [persona.assistedAccountId]
    : persona.isInternalStaff
      ? []
      : [persona.accountId];
  return {
    userId: persona.userId,
    accountIds,
    roles: phase === "before" ? sessionRolesBeforeUpgrade(persona.role) : roles,
    ...(phase === "after"
      ? {
          permissions: permissionsForRoles(roles, {
            side,
            assisted: Boolean(persona.assistedAccountId),
          }),
        }
      : {}),
    isInternalStaff: persona.isInternalStaff,
    requestId: `permission-upgrade:${persona.key}`,
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  };
}

interface PolicyRow {
  tablename: string;
  cmd: string;
  permissive: string;
  qual: string | null;
  with_check: string | null;
}

/** Number of existing rows each command's row policies admit, per table. */
async function abilities(
  sql: Sql,
  payload: object,
): Promise<Map<string, number>> {
  const policies = await sql<PolicyRow[]>`
    select p.tablename, p.cmd, p.permissive, p.qual, p.with_check
    from pg_policies p
    join pg_class c on c.relname = p.tablename
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = p.schemaname
    where p.schemaname = 'public' and c.relrowsecurity
      and (p.roles @> array['clockwork_runtime']::name[] or p.roles @> array['public']::name[])`;
  const tables = [...new Set(policies.map((policy) => policy.tablename))].sort();
  const result = new Map<string, number>();
  await sql.begin(async (tx) => {
    const text = JSON.stringify(payload);
    await tx`select set_config('app.authorization_context', ${text}, true)`;
    await tx`select set_config('app.authorization_signature', encode(extensions.hmac(
      ${text}, (select secret from private.authorization_secrets where active
        order by created_at desc limit 1), 'sha256'), 'hex'), true)`;
    for (const table of tables) {
      for (const command of ["select", "insert", "update", "delete"]) {
        const applicable = policies.filter(
          (policy) =>
            policy.tablename === table &&
            (policy.cmd === "ALL" || policy.cmd.toLowerCase() === command),
        );
        const expression = (policy: PolicyRow) =>
          command === "insert"
            ? policy.with_check
            : command === "update"
              ? [policy.qual, policy.with_check ?? policy.qual]
                  .filter(Boolean)
                  .map((part) => `(${part})`)
                  .join(" and ")
              : policy.qual;
        const permissive = applicable
          .filter((policy) => policy.permissive === "PERMISSIVE")
          .map(expression)
          .filter((part): part is string => Boolean(part));
        const restrictive = applicable
          .filter((policy) => policy.permissive === "RESTRICTIVE")
          .map(expression)
          .filter((part): part is string => Boolean(part));
        if (permissive.length === 0) {
          result.set(`${table} ${command}`, 0);
          continue;
        }
        const predicate = [
          `(${permissive.map((part) => `(${part})`).join(" or ")})`,
          ...restrictive.map((part) => `(${part})`),
        ].join(" and ");
        const [row] = await tx.unsafe<{ total: number }[]>(
          `select count(*)::int as total from public.${table} where ${predicate}`,
        );
        result.set(`${table} ${command}`, row?.total ?? 0);
      }
    }
  });
  return result;
}

async function main() {
  const server = argument("--server");
  if (!server) throw new Error("--server <postgres url> is required");
  const admin = postgres(server, { max: 1, onnotice: () => {} });
  await admin.unsafe(`drop database if exists ${database} with (force)`);
  await admin.unsafe(`create database ${database}`);
  await admin.end();
  const url = new URL(server);
  url.pathname = `/${database}`;
  const sql = postgres(url.toString(), { max: 1, onnotice: () => {} });
  const notices: string[] = [];
  try {
    await sql.unsafe(`create schema if not exists extensions;
      grant usage on schema extensions to public;
      create extension if not exists pgcrypto with schema extensions;`);
    const before = await migrate(sql, (name) => name < firstUpgradeMigration);
    // The canonical seed names Fil One's own organization's side, which the
    // pre-upgrade schema does not have yet.
    const seed = readFileSync(join(root, "supabase/seed.sql"), "utf8").replace(
      /update organizations set side = 'fil_one'\s+where id = '[^']+';/u,
      "",
    );
    await sql.begin((tx) => tx.unsafe(seed));
    await sql.unsafe(
      readFileSync(
        join(root, "scripts/fixtures/permission-upgrade-personas.sql"),
        "utf8",
      ),
    );
    const people = await personas(sql);
    const snapshots = new Map<string, Map<string, number>>();
    for (const persona of people)
      snapshots.set(
        persona.key,
        await abilities(sql, claims(persona, "before", [persona.role], "customer")),
      );

    const upgrade = postgres(url.toString(), {
      max: 1,
      onnotice: (notice) => notices.push(String(notice.message)),
    });
    const applied = await migrate(
      upgrade,
      (name) => name >= firstUpgradeMigration,
    );
    await upgrade.end();

    const sides = await sql<{ side: OrganizationSide; total: number }[]>`
      select side, count(*)::int as total from organizations group by side order by side`;
    const staffSide = await sql<{ side: string }[]>`
      select side from organizations where id = '30000000-0000-4000-8000-000000000008'`;
    if (staffSide[0]?.side !== "fil_one")
      throw new Error("the staff organization was not backfilled to fil_one");
    const unmatched = await sql<{ total: number }[]>`
      select count(*)::int as total from memberships m
      where not exists (select 1 from membership_roles r
        where r.membership_id = m.id and r.role = m.role)`;
    if (unmatched[0]?.total !== 0)
      throw new Error("a membership lost its primary role in membership_roles");

    const differences: string[] = [];
    const expected: string[] = [];
    for (const persona of people) {
      const [membership] = await sql<
        { roles: Role[]; side: OrganizationSide }[]
      >`
        select array_agg(r.role order by r.role) as roles, o.side
        from memberships m
        join membership_roles r on r.membership_id = m.id
        join organizations o on o.id = m.organization_id
        where m.user_id = ${persona.userId} and m.organization_id = ${persona.organizationId}
        group by o.side`;
      if (!membership) throw new Error(`no membership for ${persona.key}`);
      const after = await abilities(
        sql,
        claims(persona, "after", membership.roles, membership.side),
      );
      const previous = snapshots.get(persona.key) ?? new Map();
      for (const [key, total] of previous) {
        const now = after.get(key);
        if (now === undefined || now === total) continue;
        const [table = "", command = ""] = key.split(" ");
        const reason = expectedChanges.find(
          (change) =>
            change.persona.test(persona.key) &&
            change.table.test(table) &&
            change.command.test(command),
        );
        const line = `${persona.key} ${key}: ${total} -> ${now}`;
        if (reason) expected.push(`${line} (${reason.why})`);
        else differences.push(line);
      }
    }

    console.log(
      JSON.stringify(
        {
          migrationsBeforeUpgrade: before.length,
          upgradeMigrations: applied,
          backfillNotices: notices.filter((notice) =>
            notice.startsWith("organization sides"),
          ),
          sides,
          personas: people.map((persona) => persona.key),
          expectedChanges: expected,
          unexpectedChanges: differences,
        },
        null,
        2,
      ),
    );
    if (differences.length) process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
