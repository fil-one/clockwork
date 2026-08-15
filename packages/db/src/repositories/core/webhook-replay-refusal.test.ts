import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import type { RuntimeDatabase } from "../../client";
import {
  DatabaseCoreError,
  DatabaseCoreFinanceRepository,
  WebhookReplayTaskNotRegisteredError,
  webhookReplayTaskIdentifier,
} from "./database-finance";
import { FixtureTaxPort } from "./tax-fixture";

const authorizationSecret = "webhook-replay-secret-at-least-32-bytes-long";

/** Records whether the command reached the database at all. */
function pool(user: string) {
  const opened: string[] = [];
  const handle = {
    $client: { options: { user } },
    transaction: (): Promise<never> => {
      opened.push("begin");
      return Promise.reject(new Error("the replay command touched the inbox"));
    },
  };
  return { db: handle as unknown as RuntimeDatabase, opened };
}

describe("operator webhook replay refuses while no task is registered", () => {
  it("rejects with a typed error naming the missing task identifier", async () => {
    const runtime = pool("clockwork_runtime");
    const pricing = pool("clockwork_service");
    const repository = new DatabaseCoreFinanceRepository({
      database: runtime.db,
      pricingDatabase: pricing.db,
      authorizationSecret,
      tax: new FixtureTaxPort(),
    });

    const error: unknown = await repository
      .replay({
        provider: "stripe",
        eventId: "evt_1",
        actor: { kind: "user", id: "20000000-0000-4000-8000-000000000001" },
        requestId: "webhook-replay-refusal-0001",
      })
      .then(
        () => undefined,
        (thrown: unknown) => thrown,
      );

    expect(error).toBeInstanceOf(WebhookReplayTaskNotRegisteredError);
    expect(error).toBeInstanceOf(DatabaseCoreError);
    const refusal = error as WebhookReplayTaskNotRegisteredError;
    // INVALID_STATE is what the API surface renders as a non-retryable 422 and
    // what the operator server action reports as ok: false. A replay must never
    // come back as a success the operator then stops watching.
    expect(refusal.code).toBe("INVALID_STATE");
    expect(refusal.taskIdentifier).toBe(webhookReplayTaskIdentifier("stripe"));
    expect(refusal.message).toContain("webhook-replay:stripe");
  });

  it("does not open a transaction, so the inbox dedupe marker survives", async () => {
    const runtime = pool("clockwork_runtime");
    const pricing = pool("clockwork_service");
    const repository = new DatabaseCoreFinanceRepository({
      database: runtime.db,
      pricingDatabase: pricing.db,
      authorizationSecret,
      tax: new FixtureTaxPort(),
    });

    await expect(
      repository.replay({
        provider: "workos",
        eventId: "evt_2",
        actor: { kind: "user", id: "20000000-0000-4000-8000-000000000001" },
        requestId: "webhook-replay-refusal-0002",
      }),
    ).rejects.toBeInstanceOf(WebhookReplayTaskNotRegisteredError);

    expect(pricing.opened).toEqual([]);
    expect(runtime.opened).toEqual([]);
  });
});

const repositoryRoot = (() => {
  let directory = dirname(fileURLToPath(import.meta.url));
  while (!directory.endsWith(join("packages", "db"))) {
    const parent = dirname(directory);
    if (parent === directory)
      throw new Error("Could not locate the @clockwork/db package root");
    directory = parent;
  }
  return dirname(dirname(directory));
})();

function productionWorkflowSources(): string[] {
  const root = join(repositoryRoot, "packages", "workflows", "src");
  const found: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      if (entry === "node_modules" || entry === "dist" || entry.startsWith("."))
        continue;
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith(".ts") && !path.includes(".test."))
        found.push(path);
    }
  };
  walk(root);
  return found;
}

/** Strips `as const`, `satisfies T`, parentheses and `Object.freeze(...)`. */
function unwrap(node: ts.Expression): ts.Expression {
  if (
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isParenthesizedExpression(node)
  )
    return unwrap(node.expression);
  const frozen = ts.isCallExpression(node) ? node.arguments[0] : undefined;
  if (
    frozen &&
    ts.isCallExpression(node) &&
    node.expression.getText() === "Object.freeze"
  )
    return unwrap(frozen);
  return node;
}

function literalValue(node: ts.Expression): string | undefined {
  const inner = unwrap(node);
  if (ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner))
    return inner.text;
  return undefined;
}

function add(table: Map<string, Set<string>>, key: string, value: string) {
  const values = table.get(key) ?? new Set<string>();
  values.add(value);
  table.set(key, values);
}

/**
 * Every string constant in the workflow tree, keyed by the text you would
 * write to reach it: `NAME` for a bare string, `NAME.prop` for a property of
 * an object -- including one wrapped in `Object.freeze({...})` or `as const`,
 * which is how every task-id map in this tree is written. Keys are tree-wide
 * because the id maps are imported across modules.
 */
function stringConstants(
  sources: readonly ts.SourceFile[],
): Map<string, Set<string>> {
  const constants = new Map<string, Set<string>>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const name = node.name.text;
      const initializer = unwrap(node.initializer);
      const direct = literalValue(initializer);
      if (direct !== undefined) add(constants, name, direct);
      const objects = ts.isObjectLiteralExpression(initializer)
        ? [initializer]
        : ts.isArrayLiteralExpression(initializer)
          ? initializer.elements
              .map(unwrap)
              .filter((element) => ts.isObjectLiteralExpression(element))
          : [];
      for (const object of objects)
        for (const property of object.properties) {
          if (!ts.isPropertyAssignment(property)) continue;
          const key =
            ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
              ? property.name.text
              : undefined;
          const value = literalValue(property.initializer);
          if (key !== undefined && value !== undefined)
            add(constants, `${name}.${key}`, value);
        }
    }
    ts.forEachChild(node, visit);
  };
  for (const source of sources) visit(source);
  return constants;
}

/**
 * String values reaching each named function's parameters, by position. Task
 * ids in this tree also arrive through factories -- `defineLifecycleTask(id)`
 * and `defineCoreSchedule(id)` -- so the id at the registration site is a
 * parameter, and the identifier only exists at the call sites.
 */
function factoryArguments(
  sources: readonly ts.SourceFile[],
  constants: Map<string, Set<string>>,
): Map<string, Map<number, Set<string>>> {
  const byFunction = new Map<string, Map<number, Set<string>>>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const callee = node.expression.text;
      node.arguments.forEach((argument, index) => {
        const direct = literalValue(argument);
        const values =
          direct !== undefined
            ? [direct]
            : [...(constants.get(unwrap(argument).getText()) ?? [])];
        if (values.length === 0) return;
        const positions =
          byFunction.get(callee) ?? new Map<number, Set<string>>();
        const seen = positions.get(index) ?? new Set<string>();
        for (const value of values) seen.add(value);
        positions.set(index, seen);
        byFunction.set(callee, positions);
      });
    }
    ts.forEachChild(node, visit);
  };
  for (const source of sources) visit(source);
  return byFunction;
}

function enclosingFunction(
  node: ts.Node,
): { name: string; declaration: ts.SignatureDeclaration } | undefined {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isFunctionDeclaration(current) && current.name)
      return { name: current.name.text, declaration: current };
    if (
      (ts.isFunctionExpression(current) || ts.isArrowFunction(current)) &&
      ts.isVariableDeclaration(current.parent) &&
      ts.isIdentifier(current.parent.name)
    )
      return { name: current.parent.name.text, declaration: current };
  }
  return undefined;
}

/** Index of the parameter an expression like `id` or `id.value` roots at. */
function parameterIndex(
  expression: ts.Expression,
  declaration: ts.SignatureDeclaration,
): number | undefined {
  let root: ts.Node = unwrap(expression);
  while (ts.isPropertyAccessExpression(root)) root = root.expression;
  if (!ts.isIdentifier(root)) return undefined;
  const index = declaration.parameters.findIndex(
    (parameter) =>
      ts.isIdentifier(parameter.name) && parameter.name.text === root.getText(),
  );
  return index >= 0 ? index : undefined;
}

interface Registration {
  where: string;
  expression: string;
  /** Every identifier this registration can resolve to. */
  identifiers: string[];
  via: "literal" | "constant" | "factory";
}

const taskRegistrationCallees = new Set(["task", "schedules.task"]);

/**
 * Every `task({...})` / `schedules.task({...})` registration in the production
 * workflow tree, with its id resolved to the string the worker would receive.
 *
 * The complete refused set -- what lands in `unresolvable` rather than being
 * treated as absent -- is: a registration with no `id` property at all, and a
 * registration whose `id` is none of (a) a string literal, (b) a reference to
 * a tree-wide string constant, (c) a value flowing in from the literal or
 * constant arguments at the call sites of the enclosing factory function.
 * A computed id, an id read from the environment, or an id assembled from a
 * template with substitutions is refused. That is deliberate: an id this
 * cannot read is an id it cannot clear, and reporting "no webhook-replay task"
 * because the scanner could not see one is the exact failure this file exists
 * to prevent.
 */
function taskRegistrations(sources: readonly ts.SourceFile[]): {
  registrations: Registration[];
  unresolvable: string[];
} {
  const constants = stringConstants(sources);
  const factories = factoryArguments(sources, constants);
  const registrations: Registration[] = [];
  const unresolvable: string[] = [];

  for (const source of sources) {
    const where = (node: ts.Node) =>
      `${relative(repositoryRoot, source.fileName)}:${
        source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
      }`;
    const visit = (node: ts.Node): void => {
      ts.forEachChild(node, visit);
      if (
        !ts.isCallExpression(node) ||
        !taskRegistrationCallees.has(node.expression.getText())
      )
        return;
      const argument = node.arguments[0];
      if (!argument || !ts.isObjectLiteralExpression(argument)) return;
      const property = argument.properties.find(
        (candidate) =>
          candidate.name !== undefined &&
          ts.isIdentifier(candidate.name) &&
          candidate.name.text === "id",
      );
      const expression = !property
        ? undefined
        : ts.isPropertyAssignment(property)
          ? property.initializer
          : ts.isShorthandPropertyAssignment(property)
            ? property.name
            : undefined;
      if (!expression) {
        unresolvable.push(
          `${where(node)}: registration declares no readable id`,
        );
        return;
      }
      const text = expression.getText(source);
      const enclosing = enclosingFunction(node);
      const literal = literalValue(expression);
      const fromParameter = (() => {
        if (!enclosing) return undefined;
        const index = parameterIndex(expression, enclosing.declaration);
        if (index === undefined) return undefined;
        return factories.get(enclosing.name)?.get(index);
      })();
      const constant = constants.get(unwrap(expression).getText(source));
      const fromAnyPosition = enclosing
        ? [...(factories.get(enclosing.name)?.values() ?? [])].flatMap(
            (values) => [...values],
          )
        : [];

      if (literal !== undefined)
        registrations.push({
          where: where(node),
          expression: text,
          identifiers: [literal],
          via: "literal",
        });
      else if (fromParameter?.size)
        registrations.push({
          where: where(node),
          expression: text,
          identifiers: [...fromParameter],
          via: "factory",
        });
      else if (constant?.size)
        registrations.push({
          where: where(node),
          expression: text,
          identifiers: [...constant],
          via: "constant",
        });
      else if (fromAnyPosition.length > 0)
        registrations.push({
          where: where(node),
          expression: text,
          identifiers: fromAnyPosition,
          via: "factory",
        });
      else unresolvable.push(`${where(node)}: id ${text} did not resolve`);
    };
    visit(source);
  }
  return { registrations, unresolvable };
}

const removalInstruction =
  "A webhook replay task now exists. Remove the refusal in " +
  "packages/db/src/repositories/core/database-finance.ts -- delete the class " +
  "WebhookReplayTaskNotRegisteredError and the export of " +
  "webhookReplayTaskIdentifier, and replace the body of " +
  "DatabaseCoreFinanceRepository.replay (the Promise.reject) with the enqueue: " +
  "one transaction that clears processed_at/processing_error, submits the run, " +
  "and writes the workflow_runs row under the identifier the task registered " +
  "under. Then delete the first two tests in this describe block. Registering " +
  "a task that nothing enqueues and no runtime backs does not satisfy this.";

/**
 * The refusal above is a stub, and a stub that nothing watches becomes
 * permanent. These fail the moment a replay task is registered, which is the
 * signal to do the removal spelled out in `removalInstruction`.
 */
describe("no replay task is registered in the production workflow tree", () => {
  const paths = productionWorkflowSources();
  const sources = paths.map((path) =>
    ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.ESNext,
      true,
      ts.ScriptKind.TS,
    ),
  );

  it("reads the production task tree", () => {
    expect(paths.length).toBeGreaterThan(20);
    expect(
      paths.some((path) => path.endsWith(join("trigger", "discovery.ts"))),
    ).toBe(true);
  });

  it("registers no task id under the webhook-replay namespace", () => {
    const { registrations, unresolvable } = taskRegistrations(sources);

    // Refused, not ignored. See taskRegistrations for the complete set.
    expect(
      unresolvable,
      "A task id in the workflow tree is written in a form this scanner cannot resolve, so it cannot report whether a webhook replay task exists. Extend the resolver in this file to read it, or write the id as a literal or a constant reference.",
    ).toEqual([]);

    const namespaced = registrations.filter((registration) =>
      registration.identifiers.some((identifier) =>
        identifier.startsWith("webhook-replay"),
      ),
    );
    expect(namespaced, removalInstruction).toEqual([]);
  });

  it("never references the identifier the refusal names", () => {
    const referencing = paths.filter((path) =>
      readFileSync(path, "utf8").includes("webhook-replay"),
    );
    expect(
      referencing.map((path) => relative(repositoryRoot, path)),
      removalInstruction,
    ).toEqual([]);
  });

  // The assertion above once missed a registration written as
  // `id: webhookReplayTaskIds.replay`, because it matched `id: "literal"` as
  // source text. A guard against declaration-without-implementation that is
  // itself only declarative is worth nothing, so this pins that all three
  // spellings the tree actually uses still resolve. It asserts on the shapes,
  // not on any particular id, so renaming a task does not fail it -- only
  // weakening the resolver does.
  it("resolves ids written as literals, as constant references, and as factory arguments", () => {
    const { registrations } = taskRegistrations(sources);
    expect(registrations.length).toBeGreaterThan(10);
    expect(new Set(registrations.map((entry) => entry.via))).toEqual(
      new Set(["literal", "constant", "factory"]),
    );
    for (const registration of registrations)
      expect(
        registration.identifiers.every((identifier) => identifier.length > 0),
        `${registration.where} resolved to an empty identifier`,
      ).toBe(true);
  });
});
