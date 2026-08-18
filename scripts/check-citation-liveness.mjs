// P0-71, citation liveness gate.
//
// For every `path#symbol` citation in the launch-requirements ledger, this
// checker requires an implementation reference outside tests. TypeScript and
// JavaScript references are resolved through a syntax-aware import/export
// binding graph, so a comment, string, unused import, overload declaration,
// lexical shadow, or unrelated declaration with the same name cannot make a
// dead symbol look live. A real call inside the declaring module is sufficient:
// private helpers are valid implementation evidence even when not exported.
//
// SQL objects use a narrower lexical check because the TypeScript compiler has
// no PostgreSQL symbol table. SQL comments are removed; identifiers in SQL and
// in executable TypeScript/JavaScript identifiers or string literals count.
// This proves that a cited SQL object is consumed, not that PostgreSQL resolves
// every dynamic statement to that exact object.
//
// A green run does not prove reachability from a production entrypoint, prove
// that the cited symbol is semantically sufficient for its requirement, or
// validate grandfathered prose citations. Those are deliberately not claimed.
// The check is conservative about dynamic TypeScript/JavaScript dispatch: a
// symbol reached only through a computed string may require a recorded
// exception with a specific reason.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import process from "node:process";

import ts from "typescript";

const root = resolve(import.meta.dirname, "..");

export const SCAN_ROOTS = Object.freeze([
  "apps",
  "packages",
  "scripts",
  "supabase",
]);

export const SCAN_EXTENSIONS = Object.freeze([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".sql",
]);

const TYPESCRIPT_EXTENSIONS = Object.freeze(
  SCAN_EXTENSIONS.filter((extension) => extension !== ".sql"),
);

const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  ".next",
  ".turbo",
  ".git",
  "dist",
  "build",
  "coverage",
  "out",
  "storybook-static",
  "playwright-report",
  "test-results",
]);

export const COVERAGE = Object.freeze({
  covers: [
    "every TypeScript/JavaScript `path#symbol` citation resolves through the import/export binding graph and has a non-test syntax use",
    "comments, strings, import/export bindings, overload declarations and unrelated same-name declarations do not count as TypeScript/JavaScript uses",
    "a private helper called inside its declaring module counts as implementation evidence",
    "SQL object citations have a non-comment lexical use in SQL or executable TypeScript/JavaScript syntax",
    "every dead or test-only symbol is a failure unless a specific, written exception remains earned",
  ],
  doesNotCover: [
    "whole-program reachability from a production entrypoint",
    "semantic sufficiency of a cited symbol for the requirement row",
    "PostgreSQL name resolution or dynamic SQL identity beyond non-comment lexical use",
    "computed-string or reflective TypeScript/JavaScript dispatch",
    "CommonJS require, dynamic import and conditional export forms outside the repository's current static import/export patterns",
    "grandfathered prose citations",
  ],
});

/**
 * Dynamic/reflection exceptions. Enforced in both directions: an unlisted dead
 * citation fails, while an entry whose citation disappears or becomes live
 * also fails. Keep reasons concrete and reviewable.
 */
export const DEAD_CITATION_EXCEPTIONS = Object.freeze({});

export function isTestFile(relativePath) {
  const segments = relativePath.split("/");
  if (
    segments.some(
      (segment) =>
        segment === "e2e" ||
        segment === "__tests__" ||
        segment === "__fixtures__" ||
        segment === ".storybook",
    )
  )
    return true;
  if (relativePath.startsWith("packages/testing/")) return true;
  if (relativePath.startsWith("supabase/tests/")) return true;
  const file = segments.at(-1) ?? "";
  return /\.(test|spec|contract\.test|integration\.test|stories)\./.test(file);
}

/** `[{ id, column, value, path, symbol }]` from a ledger object. */
export function collectSymbolCitations(
  ledger,
  columns = [
    "domain",
    "api",
    "database",
    "workflowProvider",
    "portalDocument",
    "tests",
  ],
) {
  const citations = [];
  for (const requirement of ledger.requirements ?? [])
    for (const column of columns)
      for (const value of requirement[column] ?? []) {
        const match = /^([^\s#]+)#([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(value);
        if (!match) continue;
        citations.push({
          id: requirement.id,
          column,
          value,
          path: match[1],
          symbol: match[2],
        });
      }
  return citations;
}

function extensionOf(path) {
  return SCAN_EXTENSIONS.find((extension) => path.endsWith(extension)) ?? "";
}

function scriptKind(path) {
  if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (path.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".cjs"))
    return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function isImportOrExportBinding(node) {
  let current = node;
  while (current?.parent) {
    current = current.parent;
    if (
      ts.isImportDeclaration(current) ||
      ts.isImportEqualsDeclaration(current) ||
      ts.isExportDeclaration(current)
    )
      return true;
    if (
      ts.isStatement(current) ||
      ts.isClassElement(current) ||
      ts.isTypeElement(current)
    )
      return false;
  }
  return false;
}

function declarationNames(name, output = []) {
  if (!name) return output;
  if (ts.isIdentifier(name)) output.push(name.text);
  else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name))
    for (const element of name.elements)
      if (ts.isBindingElement(element)) declarationNames(element.name, output);
  return output;
}

function nodeIsDeclarationName(node) {
  const parent = node.parent;
  if (!parent) return false;
  if (parent.name === node && ts.isDeclaration(parent)) return true;
  if (
    (ts.isLabeledStatement(parent) ||
      ts.isBreakStatement(parent) ||
      ts.isContinueStatement(parent)) &&
    parent.label === node
  )
    return true;
  return (
    (ts.isPropertyAssignment(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isMethodSignature(parent)) &&
    parent.name === node
  );
}

function statementDeclarationNames(statement) {
  const names = [];
  if (
    ts.isFunctionDeclaration(statement) ||
    ts.isClassDeclaration(statement) ||
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isEnumDeclaration(statement)
  ) {
    if (statement.name) names.push(statement.name.text);
  } else if (ts.isVariableStatement(statement))
    for (const declaration of statement.declarationList.declarations)
      declarationNames(declaration.name, names);
  return names;
}

function variableDeclarationListDeclaresName(declarationList, name) {
  return (
    declarationList?.declarations.some((declaration) =>
      declarationNames(declaration.name).includes(name),
    ) ?? false
  );
}

function functionScopeDeclaresVar(node, name) {
  if (!node.body) return false;
  let declared = false;
  const visit = (child) => {
    if (declared || (child !== node.body && ts.isFunctionLike(child))) return;
    if (
      ts.isVariableDeclarationList(child) &&
      (child.flags & ts.NodeFlags.BlockScoped) === 0 &&
      variableDeclarationListDeclaresName(child, name)
    ) {
      declared = true;
      return;
    }
    ts.forEachChild(child, visit);
  };
  visit(node.body);
  return declared;
}

function caseBlockDeclaresName(node, name) {
  return node.clauses.some((clause) =>
    clause.statements.some((statement) => {
      if (
        ts.isVariableStatement(statement) &&
        (statement.declarationList.flags & ts.NodeFlags.BlockScoped) === 0
      )
        return false;
      return statementDeclarationNames(statement).includes(name);
    }),
  );
}

function scopeDeclaresName(node, name) {
  if (ts.isSourceFile(node)) return false;
  if (
    (ts.isFunctionExpression(node) || ts.isClassExpression(node)) &&
    node.name?.text === name
  )
    return true;
  if (ts.isFunctionLike(node))
    return (
      node.parameters.some((parameter) =>
        declarationNames(parameter.name).includes(name),
      ) || functionScopeDeclaresVar(node, name)
    );
  if (ts.isBlock(node))
    return node.statements.some((statement) =>
      statementDeclarationNames(statement).includes(name),
    );
  if (ts.isCaseBlock(node)) return caseBlockDeclaresName(node, name);
  if (ts.isCatchClause(node))
    return declarationNames(node.variableDeclaration?.name).includes(name);
  return false;
}

function topLevelBindingUseCount(record, name, propertyName = null) {
  const cacheKey = propertyName ? `${name}.${propertyName}` : name;
  if (record.bindingUseCounts.has(cacheKey))
    return record.bindingUseCounts.get(cacheKey);
  let count = 0;
  const visit = (node, shadowed) => {
    if (
      (ts.isForOfStatement(node) || ts.isForInStatement(node)) &&
      ts.isVariableDeclarationList(node.initializer) &&
      variableDeclarationListDeclaresName(node.initializer, name)
    ) {
      visit(node.initializer, true);
      visit(node.expression, shadowed);
      visit(node.statement, true);
      return;
    }
    if (
      ts.isForStatement(node) &&
      node.initializer &&
      ts.isVariableDeclarationList(node.initializer) &&
      variableDeclarationListDeclaresName(node.initializer, name)
    ) {
      visit(node.initializer, true);
      if (node.condition) visit(node.condition, true);
      if (node.incrementor) visit(node.incrementor, true);
      visit(node.statement, true);
      return;
    }
    const nestedShadow = shadowed || scopeDeclaresName(node, name);
    if (!nestedShadow) {
      if (
        propertyName &&
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === name &&
        node.name.text === propertyName
      )
        count += 1;
      else if (
        !propertyName &&
        ts.isIdentifier(node) &&
        node.text === name &&
        !nodeIsDeclarationName(node) &&
        !isImportOrExportBinding(node) &&
        !(
          ts.isPropertyAccessExpression(node.parent) &&
          node.parent.name === node
        )
      )
        count += 1;
    }
    ts.forEachChild(node, (child) => visit(child, nestedShadow));
  };
  visit(record.sourceFile, false);
  record.bindingUseCounts.set(cacheKey, count);
  return count;
}

function hasExportModifier(statement) {
  return Boolean(
    ts
      .getModifiers(statement)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
  );
}

function workspacePackageTargets(baseDirectory) {
  const targets = new Map();
  for (const parent of ["packages", "apps"]) {
    let entries = [];
    try {
      entries = readdirSync(resolve(baseDirectory, parent), {
        withFileTypes: true,
      });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const packageRoot = resolve(baseDirectory, parent, entry.name);
      let manifest;
      try {
        manifest = JSON.parse(
          readFileSync(resolve(packageRoot, "package.json"), "utf8"),
        );
      } catch {
        continue;
      }
      if (typeof manifest.name !== "string") continue;
      const exports = manifest.exports ?? { ".": "./src/index.ts" };
      if (typeof exports === "string")
        targets.set(
          manifest.name,
          relative(baseDirectory, resolve(packageRoot, exports)),
        );
      else
        for (const [subpath, target] of Object.entries(exports)) {
          const value =
            typeof target === "string"
              ? target
              : (target?.import ?? target?.default ?? target?.types);
          if (typeof value !== "string") continue;
          const specifier =
            subpath === "."
              ? manifest.name
              : `${manifest.name}/${subpath.replace(/^\.\//, "")}`;
          targets.set(
            specifier,
            relative(baseDirectory, resolve(packageRoot, value)),
          );
        }
    }
  }
  return targets;
}

function createSyntaxMetadata(files, baseDirectory) {
  const filePaths = new Set(files.map((file) => file.path));
  const packageTargets = workspacePackageTargets(baseDirectory);
  const resolveModule = (fromPath, specifier) => {
    if (specifier.startsWith("@/")) {
      const candidate = `apps/web/${specifier.slice(2)}`;
      return resolveSourcePath(candidate, filePaths);
    }
    if (specifier.startsWith(".")) {
      const candidate = relative(
        baseDirectory,
        resolve(baseDirectory, dirname(fromPath), specifier),
      );
      return resolveSourcePath(candidate, filePaths);
    }
    return packageTargets.get(specifier) ?? null;
  };
  const metadata = new Map();
  for (const file of files) {
    if (!TYPESCRIPT_EXTENSIONS.includes(extensionOf(file.path))) continue;
    const sourceFile = ts.createSourceFile(
      file.path,
      file.text,
      ts.ScriptTarget.Latest,
      true,
      scriptKind(file.path),
    );
    const record = {
      path: file.path,
      sourceFile,
      declarations: new Set(),
      exportedDeclarations: new Set(),
      imports: new Map(),
      namespaceImports: new Map(),
      namedExports: new Map(),
      starExports: [],
      useCounts: new Map(),
      bindingUseCounts: new Map(),
      sqlStrings: [],
    };
    for (const statement of sourceFile.statements) {
      if (
        ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isEnumDeclaration(statement)
      ) {
        if (statement.name) {
          record.declarations.add(statement.name.text);
          if (hasExportModifier(statement))
            record.exportedDeclarations.add(statement.name.text);
        }
      } else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations)
          for (const name of declarationNames(declaration.name)) {
            record.declarations.add(name);
            if (hasExportModifier(statement))
              record.exportedDeclarations.add(name);
          }
      } else if (ts.isImportDeclaration(statement)) {
        const specifier = statement.moduleSpecifier.text;
        const target = resolveModule(file.path, specifier);
        const clause = statement.importClause;
        if (!target || !clause) continue;
        if (clause.name)
          record.imports.set(clause.name.text, {
            source: target,
            imported: "default",
          });
        if (clause.namedBindings && ts.isNamedImports(clause.namedBindings))
          for (const element of clause.namedBindings.elements)
            record.imports.set(element.name.text, {
              source: target,
              imported: element.propertyName?.text ?? element.name.text,
            });
        else if (
          clause.namedBindings &&
          ts.isNamespaceImport(clause.namedBindings)
        )
          record.namespaceImports.set(clause.namedBindings.name.text, target);
      } else if (ts.isExportDeclaration(statement)) {
        const target = statement.moduleSpecifier
          ? resolveModule(file.path, statement.moduleSpecifier.text)
          : null;
        if (!statement.exportClause && target) record.starExports.push(target);
        else if (ts.isNamedExports(statement.exportClause))
          for (const element of statement.exportClause.elements)
            record.namedExports.set(element.name.text, {
              source: target,
              local: element.propertyName?.text ?? element.name.text,
            });
      }
    }
    const visit = (node) => {
      if (
        ts.isIdentifier(node) &&
        !nodeIsDeclarationName(node) &&
        !isImportOrExportBinding(node) &&
        !(
          ts.isPropertyAccessExpression(node.parent) &&
          node.parent.name === node
        )
      )
        record.useCounts.set(
          node.text,
          (record.useCounts.get(node.text) ?? 0) + 1,
        );
      if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)) {
        const tagged =
          ts.isNoSubstitutionTemplateLiteral(node) &&
          ts.isTaggedTemplateExpression(node.parent) &&
          node.parent.tag.getText(sourceFile) === "sql";
        if (
          tagged ||
          /\b(select|from|join|insert|update|delete|call|table|view|function)\b/i.test(
            node.text,
          )
        )
          record.sqlStrings.push(node.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    metadata.set(file.path, record);
  }
  return metadata;
}

function resolveSourcePath(candidate, filePaths) {
  const normalized = candidate.replaceAll("\\", "/");
  for (const path of [
    normalized,
    ...TYPESCRIPT_EXTENSIONS.map((extension) => `${normalized}${extension}`),
    ...TYPESCRIPT_EXTENSIONS.map(
      (extension) => `${normalized}/index${extension}`,
    ),
  ])
    if (filePaths.has(path)) return path;
  return null;
}

function stripSqlComments(text) {
  let output = "";
  let state = "code";
  let dollarTag = "";
  let blockCommentDepth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (state === "line-comment") {
      if (char === "\n") {
        state = "code";
        output += "\n";
      } else output += " ";
      continue;
    }
    if (state === "block-comment") {
      if (char === "/" && next === "*") {
        output += "  ";
        index += 1;
        blockCommentDepth += 1;
      } else if (char === "*" && next === "/") {
        output += "  ";
        index += 1;
        blockCommentDepth -= 1;
        if (blockCommentDepth === 0) state = "code";
      } else output += char === "\n" ? "\n" : " ";
      continue;
    }
    if (state === "single-quote") {
      output += char;
      if (char === "'" && next === "'") {
        output += next;
        index += 1;
      } else if (char === "'") state = "code";
      continue;
    }
    if (state === "double-quote") {
      output += char;
      if (char === '"' && next === '"') {
        output += next;
        index += 1;
      } else if (char === '"') state = "code";
      continue;
    }
    if (state === "dollar-quote") {
      if (text.startsWith(dollarTag, index)) {
        output += dollarTag;
        index += dollarTag.length - 1;
        state = "code";
      } else output += char;
      continue;
    }
    if (char === "-" && next === "-") {
      output += "  ";
      index += 1;
      state = "line-comment";
    } else if (char === "/" && next === "*") {
      output += "  ";
      index += 1;
      state = "block-comment";
      blockCommentDepth = 1;
    } else if (char === "'") {
      output += char;
      state = "single-quote";
    } else if (char === '"') {
      output += char;
      state = "double-quote";
    } else if (char === "$") {
      const match = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(text.slice(index));
      if (match) {
        dollarTag = match[0];
        output += dollarTag;
        index += dollarTag.length - 1;
        state = "dollar-quote";
      } else output += char;
    } else output += char;
  }
  return output;
}

function wordOccurrences(text, symbol) {
  const escaped = symbol.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  return text.match(new RegExp(String.raw`\b${escaped}\b`, "g"))?.length ?? 0;
}

function syntaxContainsSqlName(metadata, symbol) {
  return Boolean(
    metadata &&
    ((metadata.useCounts.get(symbol) ?? 0) > 0 ||
      metadata.sqlStrings.some((text) => wordOccurrences(text, symbol) > 0)),
  );
}

function groupCitations(citations) {
  const byKey = new Map();
  for (const citation of citations) {
    const key = `${citation.path}#${citation.symbol}`;
    if (!byKey.has(key)) byKey.set(key, { ...citation, key, citedBy: [] });
    byKey.get(key).citedBy.push(`${citation.id}:${citation.column}`);
  }
  return byKey;
}

function typeScriptReferences(citations, metadata) {
  const resolved = new Map();
  for (const citation of citations) {
    const defining = metadata.get(citation.path);
    const result = {
      resolved: Boolean(defining?.declarations.has(citation.symbol)),
      inFileReferenceCount: 0,
      references: new Set(),
      testReferences: new Set(),
    };
    if (defining)
      result.inFileReferenceCount = topLevelBindingUseCount(
        defining,
        citation.symbol,
      );
    if (result.resolved)
      for (const [path, candidate] of metadata) {
        if (path === citation.path) continue;
        let used = false;
        for (const [local, binding] of candidate.imports) {
          if (topLevelBindingUseCount(candidate, local) === 0) continue;
          if (
            resolveExport(metadata, binding.source, binding.imported) ===
            citation.key
          ) {
            used = true;
            break;
          }
        }
        if (!used)
          for (const [local, source] of candidate.namespaceImports)
            if (
              topLevelBindingUseCount(candidate, local, citation.symbol) > 0 &&
              resolveExport(metadata, source, citation.symbol) === citation.key
            ) {
              used = true;
              break;
            }
        if (!used) continue;
        (isTestFile(path) ? result.testReferences : result.references).add(
          path,
        );
      }
    resolved.set(citation.key, result);
  }
  return resolved;
}

function resolveExport(metadata, path, exportedName, visiting = new Set()) {
  const visitKey = `${path}#${exportedName}`;
  if (visiting.has(visitKey)) return null;
  visiting.add(visitKey);
  const record = metadata.get(path);
  if (!record) return null;
  const named = record.namedExports.get(exportedName);
  if (named) {
    if (named.source)
      return resolveExport(metadata, named.source, named.local, visiting);
    const imported = record.imports.get(named.local);
    if (imported)
      return resolveExport(
        metadata,
        imported.source,
        imported.imported,
        visiting,
      );
    if (record.declarations.has(named.local)) return `${path}#${named.local}`;
  }
  if (record.exportedDeclarations.has(exportedName))
    return `${path}#${exportedName}`;
  for (const source of record.starExports) {
    const target = resolveExport(metadata, source, exportedName, visiting);
    if (target) return target;
  }
  return null;
}

/**
 * Pure with respect to repository state. `files` is
 * `[{ path, text }]` with repository-relative paths.
 */
export function analyzeCitationLiveness({
  citations,
  files,
  exceptions = DEAD_CITATION_EXCEPTIONS,
  baseDirectory = root,
}) {
  const failures = [];
  const byKey = groupCitations(citations);
  const fileByPath = new Map(files.map((file) => [file.path, file]));
  const syntaxMetadata = createSyntaxMetadata(files, baseDirectory);
  const typeScriptCitations = [...byKey.values()].filter((citation) =>
    TYPESCRIPT_EXTENSIONS.includes(extensionOf(citation.path)),
  );
  const compilerReferences = typeScriptReferences(
    typeScriptCitations,
    syntaxMetadata,
  );
  const symbols = [];
  const failingKeys = new Set();

  for (const key of [...byKey.keys()].sort()) {
    const citation = byKey.get(key);
    const definingFile = fileByPath.get(citation.path);
    if (!definingFile) {
      failures.push({
        id: `CITATION_DEFINING_FILE_UNSCANNED:${key}`,
        detail: `\`${citation.path}\` is not in the scanned corpus`,
      });
      symbols.push({ ...citation, verdict: "unscanned", references: [] });
      continue;
    }

    let references = [];
    let testReferences = [];
    let inFileReferenceCount = 0;
    const extension = extensionOf(citation.path);
    if (TYPESCRIPT_EXTENSIONS.includes(extension)) {
      const result = compilerReferences.get(key);
      if (!result?.resolved) {
        failures.push({
          id: `CITATION_SYMBOL_UNRESOLVED:${key}`,
          detail: `the TypeScript compiler cannot resolve \`${citation.symbol}\` to a declaration in \`${citation.path}\``,
        });
        symbols.push({
          ...citation,
          verdict: "unresolved",
          references: [],
          testReferences: [],
          inFileReferenceCount: 0,
        });
        continue;
      }
      references = [...result.references].sort();
      testReferences = [...result.testReferences].sort();
      inFileReferenceCount = result.inFileReferenceCount;
    } else if (extension === ".sql") {
      inFileReferenceCount = Math.max(
        0,
        wordOccurrences(stripSqlComments(definingFile.text), citation.symbol) -
          1,
      );
      for (const file of files) {
        if (file.path === citation.path) continue;
        const used = file.path.endsWith(".sql")
          ? wordOccurrences(stripSqlComments(file.text), citation.symbol) > 0
          : syntaxContainsSqlName(
              syntaxMetadata.get(file.path),
              citation.symbol,
            );
        if (!used) continue;
        (isTestFile(file.path) ? testReferences : references).push(file.path);
      }
      references.sort();
      testReferences.sort();
    } else {
      failures.push({
        id: `CITATION_DEFINING_FILE_UNSCANNED:${key}`,
        detail: `\`${citation.path}\` has no supported citation-liveness analyzer`,
      });
      symbols.push({ ...citation, verdict: "unscanned", references: [] });
      continue;
    }

    let verdict = "dead";
    if (references.length > 0) verdict = "referenced";
    else if (!isTestFile(citation.path) && inFileReferenceCount > 0)
      verdict = "file-local";
    else if (testReferences.length > 0) verdict = "test-only";

    const excepted = Object.hasOwn(exceptions, key);
    const live = verdict === "referenced" || verdict === "file-local";
    if (!live) {
      failingKeys.add(key);
      if (!excepted)
        failures.push({
          id: `${verdict === "test-only" ? "CITATION_TEST_ONLY" : "CITATION_DEAD"}:${key}`,
          detail: `cited as evidence by ${citation.citedBy.join(", ")}, but has no binding-resolved or non-comment SQL implementation use`,
        });
    } else if (excepted) {
      failures.push({
        id: `CITATION_EXCEPTION_EARNED_BACK:${key}`,
        detail: `the exception is stale because the symbol is now ${verdict}`,
      });
    }
    symbols.push({
      ...citation,
      verdict,
      excepted,
      references,
      testReferences,
      inFileReferenceCount,
    });
  }

  for (const [key, reason] of Object.entries(exceptions).sort()) {
    if (typeof reason !== "string" || reason.trim().length < 20)
      failures.push({
        id: `CITATION_EXCEPTION_REASON_INVALID:${key}`,
        detail: "the exception reason must be a specific explanation",
      });
    if (failingKeys.has(key)) continue;
    if (!byKey.has(key))
      failures.push({
        id: `CITATION_EXCEPTION_STALE:${key}`,
        detail: "the ledger no longer carries this citation",
      });
  }

  return { failures, symbols };
}

/** Repository-relative source files under SCAN_ROOTS. */
export function collectSourceFiles(
  baseDirectory = root,
  scanRoots = SCAN_ROOTS,
) {
  const files = [];
  const walk = (absolute) => {
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      if (entry.name.startsWith(".") && entry.name !== ".storybook") continue;
      const child = resolve(absolute, entry.name);
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
        walk(child);
        continue;
      }
      if (!SCAN_EXTENSIONS.some((extension) => entry.name.endsWith(extension)))
        continue;
      files.push({
        path: relative(baseDirectory, child),
        text: readFileSync(child, "utf8"),
      });
    }
  };
  for (const scanRoot of scanRoots) {
    const absolute = resolve(baseDirectory, scanRoot);
    try {
      if (!statSync(absolute).isDirectory()) continue;
    } catch {
      continue;
    }
    walk(absolute);
  }
  return files;
}

function main() {
  const ledger = JSON.parse(
    readFileSync(
      resolve(root, "docs/traceability/launch-requirements.json"),
      "utf8",
    ),
  );
  const citations = collectSymbolCitations(ledger);
  const files = collectSourceFiles();
  const { failures, symbols } = analyzeCitationLiveness({ citations, files });
  console.log(
    JSON.stringify(
      {
        source:
          "docs/traceability/launch-requirements.json `path#symbol` citations",
        scannedFiles: files.length,
        scannedNonTestFiles: files.filter((file) => !isTestFile(file.path))
          .length,
        symbolCitations: citations.length,
        distinctSymbols: symbols.length,
        verdicts: Object.fromEntries(
          [
            "referenced",
            "file-local",
            "test-only",
            "dead",
            "unresolved",
            "unscanned",
          ].map((verdict) => [
            verdict,
            symbols.filter((symbol) => symbol.verdict === verdict).length,
          ]),
        ),
        exceptions: Object.keys(DEAD_CITATION_EXCEPTIONS).length,
        symbols,
        coverage: COVERAGE,
      },
      null,
      2,
    ),
  );
  if (failures.length > 0)
    throw new Error(
      `CITATION_LIVENESS_FAILED:${failures.length}\n${failures
        .map((failure) => `${failure.id} (${failure.detail})`)
        .join("\n")}`,
    );
}

if (process.argv[1] === import.meta.filename) main();
