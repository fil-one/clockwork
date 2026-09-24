// Finds interface text that bypasses the message catalogs.
//
// Lanes use this as proof that a file is fully migrated: run it over the files
// you own and the count should be zero, or every remaining finding should carry
// an `i18n-exempt` marker whose reason a reviewer can check.
//
// What it reports, by kind:
//   jsx-text      text between JSX tags, or a string literal rendered as a child
//   jsx-attr      a string literal in an attribute that reaches the reader
//                 (aria-label, title, placeholder, label, description, ...)
//   jsx-template  a template literal with English static text inside JSX
//   literal       English prose in a copy or data position: object and array
//                 values, returns, conditional branches, defaults, assignments,
//                 and setState-style calls such as setMessage("...")
//   error         the message of `new Error("...")` and its relatives, which
//                 some surfaces show to the reader
//   exempt-without-reason / exempt-misplaced
//                 an exemption marker that cannot be honoured
//
// It is a heuristic, not a parser of meaning. It skips identifiers, message
// IDs, URLs, CSS class lists, SCREAMING_CASE and Title Case strings that look
// like proper nouns ("Halcyon Research Cooperative"), which means a Title Case
// label made only of unusual words can be missed, and a sentence that happens
// to be data can be reported. Review the output; do not treat zero as a proof
// that no English remains.
//
// EXEMPTIONS need no shared file. At the end of the finding's line, or alone on
// the line above it:
//   // i18n-exempt: <reason>
//   {/* i18n-exempt: <reason> */}
// In the first 20 lines of a file, to exempt the whole file:
//   // i18n-exempt-file: <reason>
// A marker without a reason is itself reported and exempts nothing.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import process from "node:process";

import ts from "typescript";

const repositoryRoot = resolve(import.meta.dirname, "..");

export const DEFAULT_ROOTS = Object.freeze([
  "apps/web/src",
  "apps/web/app",
  "packages/ui/src/components",
  "packages/testing/src/personas/catalog.ts",
  "packages/testing/src/demo/journeys.ts",
]);

const FILE_MARKER_LINES = 20;

// Product and unit names that stay the same in every language. A string made
// only of these (plus numbers and punctuation) is not reported.
const NEVER_TRANSLATED = [
  "Fil One",
  "Filecoin",
  "AWS",
  "Azure",
  "Stripe",
  "WorkOS",
  "DocuSign",
  "Netlify",
  "Supabase",
  "GitHub",
  "PDF",
  "API",
  "CSV",
  "JSON",
  "SLA",
  "ACH",
  "TB",
  "GB",
  "USD",
  "EUR",
  "GBP",
];

// Words that make a Title Case phrase an interface label rather than a name.
// "Commercial Director" is copy; "Halcyon Research Cooperative" is a name
// because "halcyon" is not here. Only consulted when every word is
// capitalized.
const COMMON_WORDS = new Set(
  `about access account accounts action actions active activity add address
  admin administration administrator agreement agreements alliance all amount
  analyst apply approval approvals approve approved approver archive assisted
  attention audit back balance billing brand browse build buy cancel canceled
  capacity case cases catalog change changes channel checkout clear client
  clients close closed collection collections commercial commission
  commissions complete confirm connected contact continue contract contracts
  control controls create credit credits current customer customers dashboard
  data date decision decisions default delete deliver delivery demo desk
  details director disputes dispute document documents done download draft due
  east edit enablement end error errors evidence expired expiry export exports
  failed filter filters finance financial first help high history home import
  incident incidents info internal invoice invoices issue issued last latest
  legal load loading low manage manager marketplace medium member members
  migration migrations month monthly more name new next north note notes
  notice offer offers officer open operations operator order orders
  organization overview owner page paid partner partners payment payments
  pending people permission plan pending policy portfolio preview previous
  price pricing primary private procurement product profile provider providers
  provisioning purchase quote quotes read ready recent record records recovery
  refresh region registration registrations reject rejected renewal renewals
  replay report reports request requests reseller resale results retry return
  revenue review risk role roles sales sandbox sandboxes save search security
  select send service services session settings sign signing south specialist
  start status statement statements storage submit summary support system
  team term terms total trial trust type update updated usage user users
  version view west workspace year yearly`
    .split(/\s+/u)
    .filter(Boolean),
);

// Attributes whose string value is shown or announced to the reader.
const COPY_ATTRIBUTES = new Set([
  "aria-label",
  "aria-description",
  "aria-roledescription",
  "aria-valuetext",
  "aria-placeholder",
  "title",
  "placeholder",
  "alt",
  "label",
  "description",
  "hint",
  "caption",
  "eyebrow",
  "heading",
  "summary",
  "message",
  "detail",
  "body",
  "emptyMessage",
  "confirmLabel",
  "cancelLabel",
  "actionLabel",
  "tooltip",
  "subtitle",
  "legend",
  "error",
  "helperText",
]);
const COPY_ATTRIBUTE_SUFFIX =
  /(?:Label|Title|Text|Description|Message|Hint|Heading|Placeholder|Caption)$/u;

// Attributes whose value is never reader-facing. A string anywhere beneath
// one of these (including inside a conditional) is skipped.
const NON_COPY_ATTRIBUTES = new Set([
  "className",
  "class",
  "href",
  "src",
  "srcSet",
  "id",
  "key",
  "type",
  "role",
  "name",
  "value",
  "defaultValue",
  "method",
  "rel",
  "target",
  "htmlFor",
  "form",
  "autoComplete",
  "inputMode",
  "lang",
  "dir",
  "style",
  "action",
  "encType",
  "pattern",
  "accept",
  "as",
  "sizes",
  "media",
  "crossOrigin",
  "integrity",
  "referrerPolicy",
  "loading",
  "decoding",
  "fetchPriority",
  "variant",
  "size",
  "tone",
  "state",
  "icon",
  "kind",
  "color",
  "width",
  "height",
  "viewBox",
  "d",
  "fill",
  "stroke",
  "xmlns",
  "testId",
]);

// Object keys whose value is an identifier, route, or setting, not copy.
const NON_COPY_KEYS = new Set([
  "id",
  "key",
  "href",
  "src",
  "path",
  "pathname",
  "route",
  "startRoute",
  "className",
  "icon",
  "tone",
  "variant",
  "kind",
  "type",
  "role",
  "slug",
  "locale",
  "timeZone",
  "currency",
  "email",
  "url",
  "testId",
  "sku",
  "method",
  "rel",
  "target",
  "dateStyle",
  "timeStyle",
  "sameSite",
  "contentType",
  "mimeType",
  "pattern",
]);
const NON_COPY_KEY_SUFFIX = /(?:Id|Key|Href|Url|Path|ClassName|Email|Route)$/u;

// Calls whose string arguments (and anything nested in them) are never copy.
const NON_COPY_CALLEES = new Set([
  "t",
  // Demo-authored text carries all eight languages; message modules are the
  // catalogs themselves.
  "demoText",
  "defineMessages",
  "sameAsEnglish",
  "sameInAllLanguages",
  "richText",
  "translatorFor",
  "useTranslations",
  "getTranslations",
  "require",
  "clsx",
  "cn",
  "classNames",
  "fetch",
  "URL",
  "URLSearchParams",
  "Request",
  "Response",
  "Headers",
  "redirect",
  "permanentRedirect",
  "notFound",
  "Symbol",
  "RegExp",
  "querySelector",
  "querySelectorAll",
  "getElementById",
  "addEventListener",
  "removeEventListener",
  "matchMedia",
  "createElement",
  "getAttribute",
  "setAttribute",
  "get",
  "has",
  "delete",
  "getAll",
  "startsWith",
  "endsWith",
  "includes",
  "split",
  "replace",
  "replaceAll",
  "join",
  "padStart",
  "padEnd",
]);
const COPY_CALLEE = /^(?:set[A-Z]\w*|toast|notify|announce|alert|confirm)$/u;
const ERROR_CALLEE = /(?:Error|Problem)$/u;

const SKIPPED_ELEMENTS = new Set([
  "code",
  "kbd",
  "pre",
  "samp",
  "script",
  "style",
]);

export function isScannableFile(filePath) {
  const normalized = filePath.split(sep).join("/");
  if (!/\.(?:tsx?|mts|cts)$/u.test(normalized)) return false;
  if (/\.d\.[cm]?ts$/u.test(normalized)) return false;
  if (/\.(?:test|spec|stories)\.[cm]?tsx?$/u.test(normalized)) return false;
  if (/\.test-fixture\.[cm]?tsx?$/u.test(normalized)) return false;
  if (/(?:^|\/)apps\/web\/src\/i18n\//u.test(normalized)) return false;
  if (/(?:^|\/)(?:node_modules|e2e)\//u.test(normalized)) return false;
  if (/(?:^|\/)\.[^/]+\//u.test(normalized)) return false;
  return true;
}

function collapse(text) {
  return text.replace(/\s+/gu, " ").trim();
}

function stripNeverTranslated(text) {
  let remainder = text;
  for (const name of NEVER_TRANSLATED)
    remainder = remainder.split(name).join(" ");
  return remainder;
}

function words(text) {
  return text
    .split(/\s+/u)
    .map((token) => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((token) => /\p{L}/u.test(token));
}

function looksLikeCssClasses(text) {
  const tokens = text.trim().split(/\s+/u);
  if (!tokens.every((token) => /^[a-z0-9:_\-[\]/.!#%()]+$/u.test(token)))
    return false;
  const marked = tokens.filter((token) => /[-:_[/\d]/u.test(token)).length;
  return marked * 2 >= tokens.length;
}

function looksLikeProperNoun(candidateWords) {
  // Acronyms and single letters carry no signal either way.
  const meaningful = candidateWords.filter(
    (word) => word.length > 1 && !/^[\p{Lu}\p{N}]+$/u.test(word),
  );
  if (meaningful.length < 2) return false;
  if (!meaningful.every((word) => /^\p{Lu}/u.test(word))) return false;
  return meaningful.some(
    (word) => !COMMON_WORDS.has(word.toLowerCase().replace(/'s$/u, "")),
  );
}

/**
 * Whether a string is interface prose rather than an identifier, name, or
 * setting. `loose` is used where the position already says the value is shown
 * (JSX text, aria-label, title...), so a lowercase single word still counts.
 */
export function looksLikeCopy(raw, { loose = false, messageIds } = {}) {
  const text = collapse(raw);
  if (!/[A-Za-z]{2,}/u.test(text)) return false;
  if (messageIds?.has(text)) return false;
  if (/^(?:https?:|mailto:|tel:|data:|\/\/|\.{0,2}\/|@\/|#)/u.test(text))
    return false;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(text)) return false;
  const remainder = stripNeverTranslated(text);
  const remainderWords = words(remainder);
  if (remainderWords.length === 0) return false;
  // Only acronyms, units, and numbers remain: "280 TB", "UTC", "ISO 8601".
  if (remainderWords.every((word) => /^[\p{Lu}\p{N}]+$/u.test(word)))
    return false;
  if (loose) return true;
  const hasSpace = /\s/u.test(text);
  if (!hasSpace) {
    if (/^[A-Z0-9_]+$/u.test(text)) return false;
    if (/^[a-z]+\/[a-z0-9.+-]+$/iu.test(text)) return false;
    if (/^\d{4}-\d{2}-\d{2}/u.test(text)) return false;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-/iu.test(text)) return false;
    const singleWord = /^\p{Lu}\p{Ll}+[.…:!?]*$/u.test(text);
    if (/^[\w.:/#@-]+$/u.test(text) && !singleWord) return false;
    if (!/^[\p{L}][\p{L}'’.…:!?-]*$/u.test(text) && !singleWord) return false;
    return true;
  }
  if (looksLikeCssClasses(text)) return false;
  // Content-Security-Policy and similar header grammar.
  if (
    /'(?:self|none|unsafe-[a-z-]+|nonce-|strict-dynamic)/u.test(text) ||
    /^[a-z]+(?:-[a-z]+)*-src(?:-[a-z]+)?\s/u.test(text)
  )
    return false;
  if (/^[\w-]+(?:\s*,\s*[\w-]+(?:=[\w-]+)?)+$/u.test(text)) return false;
  const textWords = words(remainder);
  const hasLowercaseWord = textWords.some(
    (word) => /^\p{Ll}/u.test(word) && word.length > 1,
  );
  if (!hasLowercaseWord && looksLikeProperNoun(textWords)) return false;
  return true;
}

function calleeName(expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return undefined;
}

function isConsoleCall(expression) {
  return (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "console"
  );
}

function attributeName(attribute) {
  return attribute.name.getText();
}

function isCopyAttribute(name) {
  return COPY_ATTRIBUTES.has(name) || COPY_ATTRIBUTE_SUFFIX.test(name);
}

function isNonCopyAttribute(name) {
  if (name.startsWith("data-")) return true;
  if (name.startsWith("aria-")) return !COPY_ATTRIBUTES.has(name);
  return NON_COPY_ATTRIBUTES.has(name);
}

function isComponentElement(attribute) {
  const element = attribute.parent?.parent;
  if (!element || !("tagName" in element)) return false;
  return /^[A-Z]/u.test(element.tagName.getText());
}

function propertyKeyName(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  if (ts.isNumericLiteral(name)) return name.text;
  return undefined;
}

/**
 * A node sits somewhere copy can never be: a type, an import, the argument of
 * a call such as `t(...)` or `className={cn(...)}`. A callback body is a new
 * position, so crossing a function boundary stops call and attribute
 * exclusions from applying: `onClick={() => setMessage("Saved")}` is copy.
 */
function inNonCopyPosition(node) {
  let crossedFunction = false;
  let previous = node;
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isTypeNode(current)) return true;
    if (
      ts.isImportDeclaration(current) ||
      ts.isExportDeclaration(current) ||
      ts.isImportEqualsDeclaration(current) ||
      ts.isExternalModuleReference(current)
    )
      return true;
    if (ts.isTaggedTemplateExpression(current)) return true;
    if (ts.isEnumMember(current)) return true;
    if (ts.isCaseClause(current) && current.expression === previous)
      return true;
    if (
      ts.isJsxElement(current) &&
      SKIPPED_ELEMENTS.has(current.openingElement.tagName.getText())
    )
      return true;
    if (ts.isCallExpression(current) || ts.isNewExpression(current)) {
      if (isConsoleCall(current.expression)) return true;
      const isArgument = current.arguments?.includes(previous) ?? false;
      if (
        isArgument &&
        !crossedFunction &&
        (current.expression.kind === ts.SyntaxKind.ImportKeyword ||
          NON_COPY_CALLEES.has(calleeName(current.expression) ?? ""))
      )
        return true;
    }
    if (
      !crossedFunction &&
      ts.isElementAccessExpression(current) &&
      current.argumentExpression === previous
    )
      return true;
    if (
      !crossedFunction &&
      ts.isJsxAttribute(current) &&
      isNonCopyAttribute(attributeName(current))
    )
      return true;
    if (ts.isFunctionLike(current)) crossedFunction = true;
    if (ts.isSourceFile(current)) return false;
    previous = current;
  }
  return false;
}

function isInsideJsx(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isJsxExpression(current) || ts.isJsxAttribute(current)) return true;
    if (
      ts.isStatement(current) ||
      ts.isFunctionLike(current) ||
      ts.isSourceFile(current)
    )
      return false;
  }
  return false;
}

/** The report kind for a literal in this position, or undefined. */
function literalKind(node) {
  let child = node;
  let parent = node.parent;
  // Wrappers do not change what the value is used for.
  while (
    parent &&
    (ts.isAsExpression(parent) ||
      ts.isSatisfiesExpression(parent) ||
      ts.isParenthesizedExpression(parent) ||
      ts.isTypeAssertionExpression(parent) ||
      ts.isNonNullExpression(parent))
  ) {
    child = parent;
    parent = parent.parent;
  }
  if (!parent) return undefined;
  if (ts.isJsxExpression(parent)) {
    if (parent.parent && ts.isJsxAttribute(parent.parent)) {
      const name = attributeName(parent.parent);
      if (isCopyAttribute(name)) return { kind: "jsx-attr", loose: true };
      if (isNonCopyAttribute(name)) return undefined;
      return isComponentElement(parent.parent)
        ? { kind: "jsx-attr", loose: false, prose: true }
        : undefined;
    }
    return { kind: "jsx-text", loose: true };
  }
  if (ts.isPropertyAssignment(parent)) {
    if (parent.initializer !== child) return undefined;
    const key = propertyKeyName(parent.name);
    if (key && (NON_COPY_KEYS.has(key) || NON_COPY_KEY_SUFFIX.test(key)))
      return undefined;
    return { kind: "literal" };
  }
  if (ts.isArrayLiteralExpression(parent)) return { kind: "literal" };
  if (ts.isReturnStatement(parent)) return { kind: "literal" };
  if (ts.isArrowFunction(parent) && parent.body === child)
    return { kind: "literal" };
  if (ts.isConditionalExpression(parent)) {
    if (parent.condition === child) return undefined;
    return { kind: isInsideJsx(parent) ? "jsx-text" : "literal" };
  }
  if (ts.isBinaryExpression(parent)) {
    const operator = parent.operatorToken.kind;
    if (
      operator === ts.SyntaxKind.QuestionQuestionToken ||
      operator === ts.SyntaxKind.BarBarToken
    )
      return parent.right === child ? { kind: "literal" } : undefined;
    if (operator === ts.SyntaxKind.PlusToken) return { kind: "literal" };
    if (operator === ts.SyntaxKind.EqualsToken && parent.right === child)
      return { kind: "literal" };
    return undefined;
  }
  if (
    (ts.isParameter(parent) ||
      ts.isBindingElement(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isVariableDeclaration(parent)) &&
    parent.initializer === child
  ) {
    if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
      const name = parent.name.text;
      if (NON_COPY_KEYS.has(name) || NON_COPY_KEY_SUFFIX.test(name))
        return undefined;
    }
    return { kind: "literal" };
  }
  if (ts.isCallExpression(parent) || ts.isNewExpression(parent)) {
    if (!parent.arguments?.includes(child)) return undefined;
    const name = calleeName(parent.expression);
    if (!name) return undefined;
    if (ERROR_CALLEE.test(name)) return { kind: "error" };
    if (COPY_CALLEE.test(name)) return { kind: "literal" };
    return undefined;
  }
  return undefined;
}

function templateStaticText(node) {
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return [
    node.head.text,
    ...node.templateSpans.map((span) => span.literal.text),
  ]
    .join(" ")
    .trim();
}

function position(sourceFile, offset) {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(offset);
  return { line: line + 1, col: character + 1 };
}

function parseMarkers(text) {
  const lineMarkers = new Map();
  const problems = [];
  let fileReason;
  const lines = text.split(/\r?\n/u);
  lines.forEach((lineText, index) => {
    const markerAt = lineText.search(/i18n-exempt/u);
    if (markerAt < 0) return;
    const before = lineText.slice(0, markerAt);
    if (!/(?:\/\/|\/\*)/u.test(before)) return;
    const rest = lineText.slice(markerAt + "i18n-exempt".length);
    const isFile = rest.startsWith("-file");
    const afterName = isFile ? rest.slice("-file".length) : rest;
    const reason = afterName.startsWith(":")
      ? afterName
          .slice(1)
          .replace(/\*\/\s*\}?\s*$/u, "")
          .trim()
      : "";
    const line = index + 1;
    const col = markerAt + 1;
    if (!reason) {
      problems.push({
        line,
        col,
        kind: "exempt-without-reason",
        text: collapse(lineText),
      });
      return;
    }
    if (isFile) {
      if (line <= FILE_MARKER_LINES) fileReason ??= reason;
      else
        problems.push({
          line,
          col,
          kind: "exempt-misplaced",
          text: `i18n-exempt-file must be in the first ${FILE_MARKER_LINES} lines`,
        });
      return;
    }
    // A marker alone on its line covers the next line; a trailing marker
    // covers only the code it trails.
    const standalone = /^\s*(?:\/\/|\{?\s*\/\*)\s*$/u.test(before);
    lineMarkers.set(line, { reason, standalone });
  });
  return { lineMarkers, fileReason, problems };
}

function truncate(text) {
  const collapsed = collapse(text);
  return collapsed.length > 120 ? `${collapsed.slice(0, 117)}...` : collapsed;
}

/**
 * Scans one source text. Pure: no file system access. `messageIds` is an
 * optional set of catalog IDs to ignore when they appear as literals.
 */
export function scanSource(filePath, text, { messageIds } = {}) {
  const kind =
    filePath.endsWith(".tsx") || filePath.endsWith(".jsx")
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
  const candidates = [];
  const report = (
    node,
    findingKind,
    value,
    start = node.getStart(sourceFile),
  ) => {
    candidates.push({
      ...position(sourceFile, start),
      kind: findingKind,
      text: truncate(value),
    });
  };

  const visit = (node) => {
    if (ts.isJsxText(node)) {
      const raw = sourceFile.text.slice(node.pos, node.end);
      if (
        raw.trim() &&
        looksLikeCopy(raw, { loose: true, messageIds }) &&
        !inNonCopyPosition(node)
      ) {
        const offset = node.pos + (raw.length - raw.trimStart().length);
        report(node, "jsx-text", raw, offset);
      }
    } else if (
      ts.isJsxAttribute(node) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer)
    ) {
      const name = attributeName(node);
      const value = node.initializer.text;
      if (isCopyAttribute(name)) {
        if (looksLikeCopy(value, { loose: true, messageIds }))
          report(node.initializer, "jsx-attr", value);
      } else if (
        !isNonCopyAttribute(name) &&
        isComponentElement(node) &&
        /\s/u.test(value.trim()) &&
        looksLikeCopy(value, { messageIds })
      ) {
        report(node.initializer, "jsx-attr", value);
      }
      return;
    } else if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node)
    ) {
      if (!(node.parent && ts.isJsxAttribute(node.parent))) {
        const context = literalKind(node);
        if (
          context &&
          (!context.prose || /\s/u.test(node.text.trim())) &&
          looksLikeCopy(node.text, { loose: context.loose, messageIds }) &&
          !inNonCopyPosition(node)
        )
          report(node, context.kind, node.text);
      }
    } else if (ts.isTemplateExpression(node)) {
      const context = literalKind(node);
      const staticText = templateStaticText(node);
      if (
        context &&
        looksLikeCopy(staticText, { messageIds }) &&
        !inNonCopyPosition(node)
      ) {
        const findingKind =
          context.kind === "error"
            ? "error"
            : isInsideJsx(node)
              ? "jsx-template"
              : "literal";
        report(node, findingKind, node.getText(sourceFile));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  const { lineMarkers, fileReason, problems } = parseMarkers(text);
  const findings = [];
  const exempted = [];
  for (const candidate of candidates) {
    const above = lineMarkers.get(candidate.line - 1);
    const reason =
      fileReason ??
      lineMarkers.get(candidate.line)?.reason ??
      (above?.standalone ? above.reason : undefined);
    if (reason) exempted.push({ ...candidate, reason });
    else findings.push(candidate);
  }
  findings.push(...problems);
  const order = (left, right) => left.line - right.line || left.col - right.col;
  return {
    findings: findings.sort(order),
    exempted: exempted.sort(order),
    fileExemption: fileReason ?? null,
  };
}

/** Catalog IDs, so `const id = "partner.detail.reference"` is not reported. */
export function loadMessageIds(root = repositoryRoot) {
  const ids = new Set();
  const sources = [];
  const messagesDirectory = join(root, "apps/web/src/i18n/messages");
  if (existsSync(messagesDirectory))
    for (const entry of readdirSync(messagesDirectory))
      if (entry.endsWith(".ts")) sources.push(join(messagesDirectory, entry));
  const legacy = join(root, "apps/web/src/i18n/en.ts");
  if (existsSync(legacy)) sources.push(legacy);
  for (const source of sources) {
    const text = readFileSync(source, "utf8");
    for (const match of text.matchAll(
      /^\s*"([A-Za-z][\w-]*(?:\.[\w-]+)+)"\s*:/gmu,
    ))
      ids.add(match[1]);
  }
  return ids;
}

function walk(directory, files) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = join(directory, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.isFile() && isScannableFile(full)) files.push(full);
  }
}

export function collectFiles(paths, { cwd = process.cwd() } = {}) {
  const files = [];
  for (const path of paths) {
    const absolute = isAbsolute(path) ? path : resolve(cwd, path);
    if (!existsSync(absolute))
      throw new Error(`i18n-scan: no such path ${path}`);
    if (statSync(absolute).isDirectory()) walk(absolute, files);
    else if (isScannableFile(absolute)) files.push(absolute);
  }
  return [...new Set(files)].sort();
}

function displayPath(absolute, cwd) {
  const relativePath = relative(cwd, absolute);
  return relativePath.startsWith("..") || isAbsolute(relativePath)
    ? absolute
    : relativePath.split(sep).join("/");
}

export function scanPaths(
  paths,
  { cwd = process.cwd(), messageIds = loadMessageIds() } = {},
) {
  const files = [];
  let total = 0;
  let exempted = 0;
  for (const file of collectFiles(paths, { cwd })) {
    const result = scanSource(file, readFileSync(file, "utf8"), { messageIds });
    total += result.findings.length;
    exempted += result.exempted.length;
    if (result.findings.length || result.exempted.length)
      files.push({
        path: displayPath(file, cwd),
        count: result.findings.length,
        findings: result.findings,
        exempted: result.exempted,
      });
  }
  files.sort(
    (left, right) =>
      right.count - left.count || left.path.localeCompare(right.path),
  );
  return { files, total, exempted };
}

function render(result, { summary }) {
  const lines = [];
  const reported = result.files.filter((file) => file.count > 0);
  for (const file of reported)
    lines.push(`${String(file.count).padStart(5)}  ${file.path}`);
  if (!summary)
    for (const file of reported) {
      lines.push("", file.path);
      for (const finding of file.findings)
        lines.push(
          `  ${file.path}:${finding.line}:${finding.col}  ${finding.kind}  ${JSON.stringify(finding.text)}`,
        );
    }
  lines.push(
    "",
    `i18n-scan: ${result.total} findings in ${reported.length} files (${result.exempted} exempted)`,
  );
  return lines.join("\n");
}

const USAGE = `Usage: node scripts/i18n-scan.mjs [paths...] [--json] [--summary] [--fail]

Reports interface text that is not routed through the message catalogs.
With no paths, scans: ${DEFAULT_ROOTS.join(" ")}

  --summary  per-file counts only
  --json     machine-readable output (includes exempted findings)
  --fail     exit 1 when anything is reported

Exempt a line with a reason, at its end or alone on the line above it:
  // i18n-exempt: <reason>          {/* i18n-exempt: <reason> */}
Exempt a whole file (first ${FILE_MARKER_LINES} lines):
  // i18n-exempt-file: <reason>`;

export function main(argv, { cwd = process.cwd() } = {}) {
  const flags = new Set();
  const paths = [];
  for (const argument of argv) {
    if (argument === "--help" || argument === "-h") {
      console.log(USAGE);
      return 0;
    }
    if (argument.startsWith("--")) {
      if (!["--json", "--summary", "--fail"].includes(argument)) {
        console.error(`i18n-scan: unknown option ${argument}\n\n${USAGE}`);
        return 2;
      }
      flags.add(argument);
    } else paths.push(argument);
  }
  const roots = paths.length
    ? paths
    : DEFAULT_ROOTS.map((root) => join(repositoryRoot, root));
  const result = scanPaths(roots, { cwd });
  if (flags.has("--json")) console.log(JSON.stringify(result, null, 2));
  else console.log(render(result, { summary: flags.has("--summary") }));
  return flags.has("--fail") && result.total > 0 ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 2;
  }
}
