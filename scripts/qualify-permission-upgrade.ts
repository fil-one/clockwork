// Rehearses the permission-model upgrade (migrations 001445 onward) on a
// populated database and proves every existing person keeps exactly the
// abilities they had, apart from the changes the release makes on purpose.
//
//   pnpm exec tsx scripts/qualify-permission-upgrade.ts \
//     --server "$LOCAL_SUPABASE_ADMIN_URL"   (a URL for the supabase_admin role)
//
// The server must be a Supabase Postgres image (the migrations expect its
// roles). A scratch database is created, migrated to the last version before
// the permission model, seeded, and given one person in every role on every
// side plus a row in every table whose policies the upgrade rewrites
// (scripts/fixtures/permission-upgrade-personas.sql). For each person the row
// policies are evaluated against every row of every table, for every command,
// with the claim the application signed before the upgrade (one role, a
// commerce administrator expanded into the four internal roles it acted as),
// and the primary keys of the rows each command admits are recorded. The
// permission-model migrations are applied, the side backfill is checked, and
// the same evaluation runs with the claim the application signs now (every
// role held, and the permissions they confer). Any row gained or lost that is
// not listed in `expectedDifferences` fails the run, and so does an expected
// difference that no longer happens.
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
const commands = ["select", "insert", "update", "delete"] as const;
type Command = (typeof commands)[number];
type Direction = "gained" | "lost";

const staffOrganization = "30000000-0000-4000-8000-000000000008";
const strayMembership = "39450000-0000-4000-8000-000000000011";

/** The side the backfill must give each fixture shape, and why. */
const backfillExpectations: readonly {
  organizationId: string;
  side: OrganizationSide;
  why: string;
}[] = [
  {
    organizationId: "39450000-0000-4000-8000-0000000000a1",
    side: "customer",
    why: "a memberless POC organization takes its side from its account",
  },
  {
    organizationId: "39450000-0000-4000-8000-0000000000a2",
    side: "fil_one",
    why: "a memberless organization bound to the production Fil One WorkOS organization is Fil One",
  },
  {
    organizationId: staffOrganization,
    side: "fil_one",
    why: "the staff organization stays Fil One although a stray customer member belongs to it",
  },
  {
    organizationId: "39450000-0000-4000-8000-0000000000a3",
    side: "channel_partner",
    why: "a partner account with no agreement type keeps partner quoting",
  },
];

/** Seed and fixture ids: `<prefix>-0000-4000-8000-<n, twelve digits>`. */
function ids(prefix: string, ...numbers: number[]): string[] {
  return numbers.map(
    (number) => `${prefix}-0000-4000-8000-${String(number).padStart(12, "0")}`,
  );
}

const referralPartners = [
  "referral_partner/partner_admin#0003",
  "referral_partner/partner_seller#0004",
];
const referralQuote =
  "a referral partner no longer holds partner:quote:write, so it cannot write its partner quote (it never could finish one: the audit append was already refused)";
const assistedAdministrator = ["fil_one/commerce_admin@assisted"];
const assisted = (permission: string, effect: string) =>
  `an assisted session withholds ${permission}, so ${effect}`;
const monotone =
  "the finance confinement is monotone: a commerce administrator in an assisted session appends for the assisted account as an operator does";

/**
 * Differences the release makes on purpose. Every combination of the listed
 * personas, tables and commands must gain or lose exactly `rows` (by primary
 * key), and nothing else may differ.
 */
const expectedDifferences: readonly {
  personas: readonly string[];
  tables: readonly string[];
  commands: readonly Command[];
  direction: Direction;
  rows: readonly string[];
  why: string;
}[] = [
  {
    personas: referralPartners,
    tables: ["quotes", "core_quote_commercial_profiles"],
    commands: ["insert", "update"],
    direction: "lost",
    rows: ids("70000000", 2),
    why: referralQuote,
  },
  {
    personas: referralPartners,
    tables: ["quote_lines"],
    commands: ["insert", "update"],
    direction: "lost",
    rows: ids("71000000", 2),
    why: referralQuote,
  },
  {
    personas: referralPartners,
    tables: ["core_quote_snapshots"],
    commands: ["insert", "update"],
    direction: "lost",
    rows: ids("49450000", 9),
    why: referralQuote,
  },
  {
    personas: assistedAdministrator,
    tables: ["audit_events"],
    commands: ["insert"],
    direction: "gained",
    rows: ids("95000000", 1),
    why: monotone,
  },
  {
    personas: assistedAdministrator,
    tables: ["outbox_messages"],
    commands: ["insert"],
    direction: "gained",
    rows: ids("96000000", 1),
    why: monotone,
  },
  {
    personas: assistedAdministrator,
    tables: ["core_billing_policies"],
    commands: ["select"],
    direction: "lost",
    rows: ids("10000000", 2, 3, 4, 5, 6, 7, 8),
    why: assisted(
      "billing:approve",
      "other accounts' billing policies are hidden",
    ),
  },
  {
    personas: assistedAdministrator,
    tables: ["entitlements"],
    commands: ["select"],
    direction: "lost",
    rows: ids("83000000", 2, 3, 4, 5, 6, 7),
    why: assisted("billing:approve", "other accounts' entitlements are hidden"),
  },
  {
    personas: assistedAdministrator,
    tables: ["invoices"],
    commands: ["select"],
    direction: "lost",
    rows: ids("90000000", 2, 3, 4, 5, 6, 7),
    why: assisted("billing:approve", "other accounts' invoices are hidden"),
  },
  {
    personas: assistedAdministrator,
    tables: ["payments"],
    commands: ["select"],
    direction: "lost",
    rows: ids("91000000", 2),
    why: assisted("billing:approve", "other accounts' payments are hidden"),
  },
  {
    personas: assistedAdministrator,
    tables: ["credit_notes"],
    commands: ["select"],
    direction: "lost",
    rows: ids("49450000", 12),
    why: assisted("billing:approve", "other accounts' credit notes are hidden"),
  },
  {
    personas: assistedAdministrator,
    tables: ["refunds"],
    commands: ["select"],
    direction: "lost",
    rows: ids("49450000", 14),
    why: assisted("billing:approve", "other accounts' refunds are hidden"),
  },
  {
    personas: assistedAdministrator,
    tables: ["credit_notes"],
    commands: ["insert"],
    direction: "lost",
    rows: ids("49450000", 11, 12),
    why: assisted("billing:approve", "it cannot issue credit notes"),
  },
  {
    personas: assistedAdministrator,
    tables: ["refunds"],
    commands: ["insert"],
    direction: "lost",
    rows: ids("49450000", 13, 14),
    why: assisted("billing:approve", "it cannot issue refunds"),
  },
  {
    personas: assistedAdministrator,
    tables: ["dispute_cases"],
    commands: ["insert"],
    direction: "lost",
    rows: ids("92000000", 1),
    why: assisted("billing:approve", "it cannot open dispute cases"),
  },
  {
    personas: assistedAdministrator,
    tables: ["core_collection_cases"],
    commands: ["select"],
    direction: "lost",
    rows: ids("49450000", 3),
    why: assisted(
      "billing:approve",
      "other accounts' collection cases are hidden",
    ),
  },
  {
    personas: assistedAdministrator,
    tables: ["core_collection_cases"],
    commands: ["update"],
    direction: "lost",
    rows: ids("49450000", 2, 3),
    why: assisted("billing:approve", "it cannot work collection cases"),
  },
  {
    personas: assistedAdministrator,
    tables: ["core_partner_transfer_tiers"],
    commands: ["select"],
    direction: "lost",
    rows: ids("49450000", 6),
    why: assisted("billing:approve", "partner transfer economics are hidden"),
  },
  {
    personas: assistedAdministrator,
    tables: ["rate_cards"],
    commands: ["select"],
    direction: "lost",
    rows: ids("61000000", 1, 2),
    why: assisted("quote:approve", "rate card economics are hidden"),
  },
  {
    personas: assistedAdministrator,
    tables: ["lifecycle_offboarding_plans"],
    commands: ["update"],
    direction: "lost",
    rows: ids("93600000", 1),
    why: assisted(
      "destructive:approve",
      "it cannot approve an offboarding plan",
    ),
  },
  {
    personas: assistedAdministrator,
    tables: ["experience_portal_projections"],
    commands: ["select"],
    direction: "lost",
    rows: ids("49450000", 29),
    why: assisted(
      "agreement:approve, quote:approve, billing:approve and destructive:approve",
      "the staff approvals queue is hidden",
    ),
  },
];

interface Persona {
  key: string;
  side: OrganizationSide;
  userId: string;
  accountId: string;
  organizationId: string;
  role: Role;
  isInternalStaff: boolean;
  /** An internal persona acting inside this account through an assisted session. */
  assistedAccountId?: string;
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/**
 * The roles the application signed before this release, reproduced exactly:
 * a commerce administrator's claim carried the four internal roles it acted
 * as, because the database tested role names. This is the baseline being
 * compared against, so it names roles on purpose.
 */
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
  // The side label follows the backfill rule in 001446 (an identity-provider
  // binding or an internal member, then a partner member, then a customer
  // member), computed from pre-upgrade data. After the upgrade every label is
  // checked against the side the backfill actually stored.
  const rows = await sql<
    {
      user_id: string;
      account_id: string;
      organization_id: string;
      role: Role;
      is_internal_staff: boolean;
      side: OrganizationSide;
    }[]
  >`
    with kinds as (
      select organization_id,
        bool_or(role in ('internal_operator','finance_approver','legal_approver',
          'destructive_action_approver','revenue','commerce_admin')) as internal,
        bool_or(role in ('partner_admin','partner_seller')) as partner
      from memberships group by organization_id
    )
    select m.user_id, o.account_id, o.id as organization_id, m.role,
      u.is_internal_staff,
      case
        when o.workos_organization_id in ('org_01M21Q2N3ER4KWVJ30VRN8G0PV',
          'org_01M21RDQDM5NHYD4CEHWJZFG3J') or k.internal then 'fil_one'
        when k.partner then
          case when a.partner_agreement_type = 'referral'
            then 'referral_partner' else 'channel_partner' end
        else 'customer'
      end as side
    from memberships m
    join organizations o on o.id = m.organization_id
    join accounts a on a.id = o.account_id
    join commerce_users u on u.id = m.user_id
    join kinds k on k.organization_id = o.id
    order by side, m.role, m.user_id`;
  const list: Persona[] = rows.map((row) => ({
    key: `${row.side}/${row.role}#${row.user_id.slice(-4)}`,
    side: row.side,
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
  policyname: string;
  cmd: string;
  permissive: string;
  roles: string[];
  qual: string | null;
  with_check: string | null;
}

async function policies(sql: Sql): Promise<PolicyRow[]> {
  return sql<PolicyRow[]>`
    select p.tablename, p.policyname, p.cmd, p.permissive,
      p.roles::text[] as roles, p.qual, p.with_check
    from pg_policies p
    join pg_class c on c.relname = p.tablename
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = p.schemaname
    where p.schemaname = 'public' and c.relrowsecurity
    order by p.tablename, p.policyname`;
}

/** Tables whose policies differ between two snapshots. */
function rewrittenTables(before: PolicyRow[], after: PolicyRow[]): string[] {
  const fingerprint = (rows: PolicyRow[]) => {
    const byTable = new Map<string, string[]>();
    for (const row of rows)
      byTable.set(row.tablename, [
        ...(byTable.get(row.tablename) ?? []),
        JSON.stringify(row),
      ]);
    return byTable;
  };
  const previous = fingerprint(before);
  const next = fingerprint(after);
  return [...new Set([...previous.keys(), ...next.keys()])]
    .filter(
      (table) =>
        JSON.stringify(previous.get(table)) !== JSON.stringify(next.get(table)),
    )
    .sort();
}

/** SQL for a row's identity: its primary key, columns joined by `|`. */
async function rowIdentities(
  sql: Sql,
  tables: readonly string[],
): Promise<Map<string, string>> {
  const keys = await sql<{ table: string; columns: string[] }[]>`
    select c.relname as table,
      array_agg(a.attname::text order by array_position(i.indkey::int2[], a.attnum)) as columns
    from pg_index i
    join pg_class c on c.oid = i.indrelid
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    join pg_attribute a on a.attrelid = c.oid and a.attnum = any(i.indkey)
    where i.indisprimary and c.relname = any(${tables as string[]})
    group by c.relname`;
  const identities = new Map(
    keys.map((key) => [
      key.table,
      key.columns.length === 1
        ? `"${key.columns[0]}"::text`
        : `concat_ws('|', ${key.columns.map((column) => `"${column}"::text`).join(", ")})`,
    ]),
  );
  const missing = tables.filter((table) => !identities.has(table));
  if (missing.length)
    throw new Error(`tables without a primary key: ${missing.join(", ")}`);
  return identities;
}

/** Every row id in each table. */
async function universe(
  sql: Sql,
  identities: Map<string, string>,
): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>();
  for (const [table, identity] of identities) {
    const rows = await sql.unsafe<{ id: string }[]>(
      `select ${identity} as id from public.${table}`,
    );
    result.set(table, new Set(rows.map((row) => row.id)));
  }
  return result;
}

/** Ids of the existing rows each command's row policies admit, per table. */
async function abilities(
  sql: Sql,
  payload: object,
  identities: Map<string, string>,
): Promise<Map<string, Set<string>>> {
  const runtime = (await policies(sql)).filter(
    (policy) =>
      policy.roles.includes("clockwork_runtime") ||
      policy.roles.includes("public"),
  );
  const tables = [...new Set(runtime.map((policy) => policy.tablename))].sort();
  const result = new Map<string, Set<string>>();
  await sql.begin(async (tx) => {
    const text = JSON.stringify(payload);
    await tx`select set_config('app.authorization_context', ${text}, true)`;
    await tx`select set_config('app.authorization_signature', encode(extensions.hmac(
      ${text}, (select secret from private.authorization_secrets where active
        order by created_at desc limit 1), 'sha256'), 'hex'), true)`;
    for (const table of tables) {
      const identity = identities.get(table);
      if (!identity) continue;
      for (const command of commands) {
        const applicable = runtime.filter(
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
          result.set(`${table} ${command}`, new Set());
          continue;
        }
        const predicate = [
          `(${permissive.map((part) => `(${part})`).join(" or ")})`,
          ...restrictive.map((part) => `(${part})`),
        ].join(" and ");
        const rows = await tx.unsafe<{ id: string }[]>(
          `select ${identity} as id from public.${table} where ${predicate}`,
        );
        result.set(`${table} ${command}`, new Set(rows.map((row) => row.id)));
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
  const failures: string[] = [];
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
    await sql.begin((tx) =>
      tx.unsafe(
        readFileSync(
          join(root, "scripts/fixtures/permission-upgrade-personas.sql"),
          "utf8",
        ),
      ),
    );

    const policiesBefore = await policies(sql);
    const identitiesBefore = await rowIdentities(sql, [
      ...new Set(policiesBefore.map((policy) => policy.tablename)),
    ]);
    const rowsBefore = await universe(sql, identitiesBefore);
    const people = await personas(sql);
    const snapshots = new Map<string, Map<string, Set<string>>>();
    for (const persona of people)
      snapshots.set(
        persona.key,
        await abilities(
          sql,
          claims(persona, "before", [persona.role], persona.side),
          identitiesBefore,
        ),
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
    const backfillNotices = notices.filter(
      (notice) =>
        notice.startsWith("organization sides") ||
        notice.startsWith("ORGANIZATION_SIDE_CONFLICT"),
    );

    // Every table the upgrade rewrites must hold rows, or the comparison
    // below proves nothing about it.
    const policiesAfter = await policies(sql);
    const rewritten = rewrittenTables(policiesBefore, policiesAfter).filter(
      (table) => rowsBefore.has(table),
    );
    const rowsSeeded = Object.fromEntries(
      rewritten.map((table) => [table, rowsBefore.get(table)?.size ?? 0]),
    );
    for (const [table, total] of Object.entries(rowsSeeded))
      if (total === 0)
        failures.push(
          `${table} has no rows, so its rewritten policies are untested`,
        );

    // The side backfill.
    const sides = await sql<{ side: OrganizationSide; total: number }[]>`
      select side, count(*)::int as total from organizations group by side order by side`;
    const stored = new Map(
      (
        await sql<{ id: string; side: OrganizationSide }[]>`
          select id, side from organizations`
      ).map((row) => [row.id, row.side]),
    );
    const backfill = backfillExpectations.map((expectation) => {
      const side = stored.get(expectation.organizationId);
      if (side !== expectation.side)
        failures.push(
          `organization ${expectation.organizationId} was backfilled to ${side ?? "nothing"}, expected ${expectation.side} (${expectation.why})`,
        );
      return { ...expectation, backfilled: side };
    });
    const [stray] = await sql<{ role: string; granted: boolean }[]>`
      select m.role, exists (select 1 from membership_roles r
        where r.membership_id = m.id and r.role = m.role) as granted
      from memberships m where m.id = ${strayMembership}`;
    if (stray?.role !== "member" || !stray.granted)
      failures.push(
        "the stray member of the staff organization was not kept as a member",
      );
    const [conflict] = await sql<{ total: number }[]>`
      select count(*)::int as total from audit_events
      where event_type = 'organization.side_conflict_resolved'
        and aggregate_type = 'organization' and aggregate_id = ${staffOrganization}`;
    if (conflict?.total !== 1)
      failures.push(
        `expected one organization.side_conflict_resolved event for the staff organization, found ${conflict?.total ?? 0}`,
      );
    if (
      !backfillNotices.some(
        (notice) =>
          notice.startsWith("ORGANIZATION_SIDE_CONFLICT") &&
          notice.includes(staffOrganization),
      )
    )
      failures.push("no NOTICE named the staff organization's side conflict");
    const [unmatched] = await sql<{ total: number }[]>`
      select count(*)::int as total from memberships m
      where not exists (select 1 from membership_roles r
        where r.membership_id = m.id and r.role = m.role)`;
    if (unmatched?.total !== 0)
      failures.push("a membership lost its primary role in membership_roles");

    // Row-level comparison, over the rows that existed before the upgrade.
    // Rows the upgrade itself writes (the conflict audit event) are counted
    // separately: a policy that admits a new row is not a change in ability.
    const identitiesAfter = await rowIdentities(sql, [
      ...identitiesBefore.keys(),
    ]);
    const rowsAfter = await universe(sql, identitiesAfter);
    const rowsAddedByUpgrade = Object.fromEntries(
      [...rowsAfter]
        .map(([table, ids]): [string, number] => {
          const previous = rowsBefore.get(table) ?? new Set<string>();
          return [table, [...ids].filter((id) => !previous.has(id)).length];
        })
        .filter(([, added]) => added !== 0),
    );

    interface Difference {
      persona: string;
      table: string;
      command: Command;
      direction: Direction;
      rows: string[];
    }
    const observed: Difference[] = [];
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
      if (membership.side !== persona.side)
        failures.push(
          `${persona.key} is labelled ${persona.side} but the backfill stored ${membership.side}`,
        );
      const after = await abilities(
        sql,
        claims(persona, "after", membership.roles, membership.side),
        identitiesAfter,
      );
      const previous =
        snapshots.get(persona.key) ?? new Map<string, Set<string>>();
      for (const [key, then] of previous) {
        const [table = "", command] = key.split(" ") as [string, Command];
        const existing = rowsBefore.get(table) ?? new Set<string>();
        const now = new Set(
          [...(after.get(key) ?? [])].filter((id) => existing.has(id)),
        );
        const gained = [...now].filter((id) => !then.has(id)).sort();
        const lost = [...then].filter((id) => !now.has(id)).sort();
        for (const [direction, rows] of [
          ["gained", gained],
          ["lost", lost],
        ] as const)
          if (rows.length)
            observed.push({
              persona: persona.key,
              table,
              command,
              direction,
              rows,
            });
      }
    }

    const expected = expectedDifferences.flatMap((entry) =>
      entry.personas.flatMap((persona) =>
        entry.tables.flatMap((table) =>
          entry.commands.map((command) => ({
            persona,
            table,
            command,
            direction: entry.direction,
            rows: [...entry.rows].sort(),
            why: entry.why,
          })),
        ),
      ),
    );
    const label = (difference: Difference) =>
      `${difference.persona} ${difference.table} ${difference.command} ${difference.direction} ${difference.rows.length}: ${difference.rows.join(", ")}`;
    const same = (left: Difference, right: Difference) =>
      label(left) === label(right);
    const matched: string[] = [];
    const unexpected: string[] = [];
    for (const difference of observed) {
      const reason = expected.find((entry) => same(entry, difference));
      if (reason) matched.push(`${label(difference)} (${reason.why})`);
      else unexpected.push(label(difference));
    }
    const unobserved = expected
      .filter(
        (entry) => !observed.some((difference) => same(entry, difference)),
      )
      .map((entry) => `${label(entry)} (${entry.why})`);
    if (unexpected.length)
      failures.push(`${unexpected.length} unexpected differences`);
    if (unobserved.length)
      failures.push(`${unobserved.length} expected differences did not happen`);

    console.log(
      JSON.stringify(
        {
          migrationsBeforeUpgrade: before.length,
          upgradeMigrations: applied,
          backfillNotices,
          backfill,
          sides,
          personas: people.map((persona) => persona.key),
          rewrittenTables: rewritten.length,
          rowsSeeded,
          rowsAddedByUpgrade,
          expectedDifferences: matched,
          unexpectedDifferences: unexpected,
          expectedButNotObserved: unobserved,
          failures,
        },
        null,
        2,
      ),
    );
    if (failures.length) process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
