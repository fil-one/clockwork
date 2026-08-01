import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const ledgerPath = resolve(root, "docs/traceability/launch-requirements.json");
const schemaPath = resolve(
  root,
  "docs/traceability/launch-requirements.schema.json",
);
const contractPath = resolve(root, "commerce_platform_spec.md");
const backlogPath = resolve(root, "docs/backlog.md");
const externalGatesPath = resolve(root, "docs/external-gates.md");
const launchChecklistPath = resolve(root, "docs/launch-checklist.md");
const gateRegistryPath = resolve(
  root,
  "packages/domain/src/system/external-gates.ts",
);
const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const contract = readFileSync(contractPath);
const contractText = contract.toString("utf8");
const backlog = readFileSync(backlogPath, "utf8");
const externalGates = readFileSync(externalGatesPath, "utf8");
const launchChecklist = readFileSync(launchChecklistPath, "utf8");
const gateRegistry = readFileSync(gateRegistryPath, "utf8");
const statuses = new Set([
  "implemented",
  "partial",
  "unimplemented",
  "external-gated",
  "historical",
]);
const arrayFields = [
  "domain",
  "api",
  "database",
  "workflowProvider",
  "portalDocument",
  "tests",
  "externalGates",
  "backlog",
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertSchemaShape() {
  for (const field of schema.required)
    if (!(field in ledger))
      throw new Error(`TRACEABILITY_SCHEMA_REQUIRED:${field}`);
  if (schema.additionalProperties === false) {
    const allowedRootFields = new Set(Object.keys(schema.properties));
    for (const field of Object.keys(ledger))
      if (!allowedRootFields.has(field))
        throw new Error(`TRACEABILITY_SCHEMA_ADDITIONAL:${field}`);
  }
  for (const [field, definition] of Object.entries(schema.properties)) {
    if (definition.const !== undefined && ledger[field] !== definition.const)
      throw new Error(`TRACEABILITY_SCHEMA_CONST:${field}`);
    if (
      definition.pattern &&
      typeof ledger[field] === "string" &&
      !new RegExp(definition.pattern).test(ledger[field])
    )
      throw new Error(`TRACEABILITY_SCHEMA_PATTERN:${field}`);
  }

  const statusPolicySchema = schema.$defs.statusPolicy;
  const statusPolicy = ledger.statusPolicy ?? {};
  for (const field of statusPolicySchema.required)
    if (!(field in statusPolicy))
      throw new Error(`TRACEABILITY_SCHEMA_REQUIRED:statusPolicy:${field}`);
  if (statusPolicySchema.additionalProperties === false) {
    const allowedStatusPolicyFields = new Set(
      Object.keys(statusPolicySchema.properties),
    );
    for (const field of Object.keys(statusPolicy))
      if (!allowedStatusPolicyFields.has(field))
        throw new Error(`TRACEABILITY_SCHEMA_ADDITIONAL:statusPolicy:${field}`);
  }
  if (statusPolicy.generatedFrom !== "commerce_platform_spec.md")
    throw new Error("TRACEABILITY_STATUS_POLICY_SOURCE");
  if (statusPolicy.activeBranch !== "main")
    throw new Error("TRACEABILITY_ACTIVE_BRANCH");
  if (
    ![
      "pre-merge",
      "post-merge-pre-qualification",
      "repository-qualified",
      "launch-qualified",
    ].includes(statusPolicy.reviewState)
  )
    throw new Error("TRACEABILITY_REVIEW_STATE");
  for (const field of ["reviewedAgainst", "evidenceManifests", "notes"]) {
    if (!Array.isArray(statusPolicy[field]) || statusPolicy[field].length === 0)
      throw new Error(`TRACEABILITY_STATUS_POLICY_ARRAY:${field}`);
    if (new Set(statusPolicy[field]).size !== statusPolicy[field].length)
      throw new Error(`TRACEABILITY_STATUS_POLICY_DUPLICATE:${field}`);
  }
  for (const status of statuses)
    if (
      typeof statusPolicy.statuses?.[status] !== "string" ||
      statusPolicy.statuses[status].length === 0
    )
      throw new Error(`TRACEABILITY_STATUS_POLICY_STATUS:${status}`);

  const requirementSchema = schema.$defs.requirement;
  const allowedFields = new Set(Object.keys(requirementSchema.properties));
  for (const requirement of ledger.requirements ?? []) {
    for (const field of requirementSchema.required)
      if (!(field in requirement))
        throw new Error(
          `TRACEABILITY_SCHEMA_REQUIRED:${requirement.id}:${field}`,
        );
    if (requirementSchema.additionalProperties === false)
      for (const field of Object.keys(requirement))
        if (!allowedFields.has(field))
          throw new Error(
            `TRACEABILITY_SCHEMA_ADDITIONAL:${requirement.id}:${field}`,
          );
  }
}

assertSchemaShape();
if (ledger.schemaVersion !== 1)
  throw new Error("TRACEABILITY_SCHEMA_VERSION_INVALID");
if (ledger.contract !== "commerce_platform_spec.md")
  throw new Error("TRACEABILITY_CONTRACT_INVALID");
if (ledger.contractSha256 !== sha256(contract))
  throw new Error(
    `TRACEABILITY_CONTRACT_HASH:${ledger.contractSha256}:${sha256(contract)}`,
  );
if (!Array.isArray(ledger.requirements) || ledger.requirements.length === 0)
  throw new Error("TRACEABILITY_REQUIREMENTS_EMPTY");

const backlogEntries = [
  ...backlog.matchAll(
    /^- \*\*(P0-\d{2}) —[\s\S]*?`\[(OPEN|INTEGRATED-PENDING|COMPLETE|EXTERNAL-ONLY)\]`:\*\*/gm,
  ),
];
const backlogIds = new Set(backlogEntries.map((match) => match[1]));
const backlogStatuses = new Map(
  backlogEntries.map((match) => [match[1], match[2]]),
);
const backlogHeadings = [...backlog.matchAll(/^- \*\*(P0-\d{2}) —/gm)].map(
  (match) => match[1],
);
if (backlogIds.size !== backlogHeadings.length)
  throw new Error(
    `TRACEABILITY_BACKLOG_STATUS:${backlogIds.size}:${backlogHeadings.length}`,
  );
if (new Set(backlogHeadings).size !== backlogHeadings.length)
  throw new Error("TRACEABILITY_BACKLOG_DUPLICATE");
const aliases = ledger.statusPolicy?.backlogReferenceAliases ?? {};
for (const [alias, target] of Object.entries(aliases)) {
  if (!backlogIds.has(target))
    throw new Error(`TRACEABILITY_BACKLOG_ALIAS_TARGET:${alias}:${target}`);
}

const gateMatch = gateRegistry.match(
  /externalGateKeys\s*=\s*\[([\s\S]*?)\]\s*as const/,
);
if (!gateMatch) throw new Error("TRACEABILITY_GATE_REGISTRY_UNREADABLE");
const gateIds = new Set(
  [...gateMatch[1].matchAll(/"(EXT-[A-Z]+-\d{2})"/g)].map((match) => match[1]),
);
const externalGateRows = [
  ...externalGates.matchAll(/^\| `(EXT-[A-Z]+-\d{2})`\s+\| ([^\n]+)$/gm),
];
const documentedGateIds = new Set(externalGateRows.map((match) => match[1]));
if (externalGateRows.length !== documentedGateIds.size)
  throw new Error("TRACEABILITY_EXTERNAL_GATE_DUPLICATE");
for (const gateId of gateIds)
  if (!documentedGateIds.has(gateId))
    throw new Error(`TRACEABILITY_EXTERNAL_GATE_UNDOCUMENTED:${gateId}`);
for (const gateId of documentedGateIds)
  if (!gateIds.has(gateId))
    throw new Error(`TRACEABILITY_EXTERNAL_GATE_UNREGISTERED:${gateId}`);
for (const [gateId, row] of externalGateRows.map((match) => [
  match[1],
  match[0],
])) {
  const cells = row.split("|").slice(1, -1);
  if (
    cells.length !== 5 ||
    cells.slice(1).some((cell) => cell.trim().length < 20)
  )
    throw new Error(`TRACEABILITY_EXTERNAL_GATE_INCOMPLETE:${gateId}`);
  for (const requiredMarker of ["packages/", "Required by", "**`"]) {
    if (!row.includes(requiredMarker))
      throw new Error(
        `TRACEABILITY_EXTERNAL_GATE_EVIDENCE:${gateId}:${requiredMarker}`,
      );
  }
}
const gateAliases = ledger.statusPolicy?.gateReferenceAliases ?? {};
for (const [alias, target] of Object.entries(gateAliases))
  if (target !== "ALL_REGISTERED_EXTERNAL_GATES" && !gateIds.has(target))
    throw new Error(`TRACEABILITY_GATE_ALIAS_TARGET:${alias}:${target}`);

const ids = new Set();
const referencedBacklogIds = new Map(
  [...backlogIds].map((backlogId) => [backlogId, new Set()]),
);
for (const requirement of ledger.requirements) {
  if (!/^SPEC-[0-9A-Z-]+$/.test(requirement.id))
    throw new Error(`TRACEABILITY_ID_INVALID:${requirement.id}`);
  if (ids.has(requirement.id))
    throw new Error(`TRACEABILITY_ID_DUPLICATE:${requirement.id}`);
  ids.add(requirement.id);
  if (!statuses.has(requirement.status))
    throw new Error(`TRACEABILITY_STATUS_INVALID:${requirement.id}`);
  for (const field of ["source", "requirement", "rationale"])
    if (
      typeof requirement[field] !== "string" ||
      requirement[field].length === 0
    )
      throw new Error(`TRACEABILITY_FIELD_INVALID:${requirement.id}:${field}`);
  for (const field of arrayFields) {
    if (!Array.isArray(requirement[field]))
      throw new Error(`TRACEABILITY_ARRAY_INVALID:${requirement.id}:${field}`);
    if (
      requirement[field].some(
        (value) => typeof value !== "string" || value.length === 0,
      )
    )
      throw new Error(`TRACEABILITY_ARRAY_VALUE:${requirement.id}:${field}`);
    if (new Set(requirement[field]).size !== requirement[field].length)
      throw new Error(
        `TRACEABILITY_ARRAY_DUPLICATE:${requirement.id}:${field}`,
      );
  }
  for (const reference of requirement.backlog) {
    const target = aliases[reference] ?? reference;
    if (!backlogIds.has(target))
      throw new Error(
        `TRACEABILITY_BACKLOG_REFERENCE:${requirement.id}:${reference}`,
      );
    referencedBacklogIds.get(target).add(requirement.id);
    if (backlogStatuses.get(target) === "COMPLETE")
      throw new Error(
        `TRACEABILITY_COMPLETED_BACKLOG_REFERENCE:${requirement.id}:${target}`,
      );
    if (
      backlogStatuses.get(target) === "EXTERNAL-ONLY" &&
      (requirement.status !== "external-gated" ||
        requirement.externalGates.length === 0)
    )
      throw new Error(
        `TRACEABILITY_EXTERNAL_BACKLOG_WITHOUT_GATE:${requirement.id}:${target}`,
      );
  }
  for (const reference of requirement.externalGates) {
    const target = gateAliases[reference] ?? reference;
    if (target !== "ALL_REGISTERED_EXTERNAL_GATES" && !gateIds.has(target))
      throw new Error(
        `TRACEABILITY_GATE_REFERENCE:${requirement.id}:${reference}`,
      );
  }
  if (
    requirement.status === "external-gated" &&
    requirement.externalGates.length === 0
  )
    throw new Error(`TRACEABILITY_GATE_MISSING:${requirement.id}`);
  if (
    ["partial", "unimplemented"].includes(requirement.status) &&
    requirement.backlog.length === 0 &&
    requirement.externalGates.length === 0
  )
    throw new Error(`TRACEABILITY_GAP_UNMAPPED:${requirement.id}`);
  if (
    ["implemented", "external-gated"].includes(requirement.status) &&
    requirement.tests.length === 0
  )
    throw new Error(`TRACEABILITY_COMPLETION_WITHOUT_TEST:${requirement.id}`);
  if (
    ["implemented", "external-gated"].includes(requirement.status) &&
    [
      ...requirement.domain,
      ...requirement.api,
      ...requirement.database,
      ...requirement.workflowProvider,
      ...requirement.portalDocument,
    ].length === 0
  )
    throw new Error(
      `TRACEABILITY_COMPLETION_WITHOUT_IMPLEMENTATION:${requirement.id}`,
    );
  if (
    ["implemented", "historical"].includes(requirement.status) &&
    requirement.backlog.length > 0
  )
    throw new Error(`TRACEABILITY_FALSE_COMPLETE:${requirement.id}`);
  if (
    requirement.status === "external-gated" &&
    requirement.backlog.some(
      (reference) =>
        backlogStatuses.get(aliases[reference] ?? reference) !==
        "EXTERNAL-ONLY",
    )
  )
    throw new Error(
      `TRACEABILITY_EXTERNAL_GATE_INTERNAL_BACKLOG:${requirement.id}`,
    );
}

for (const [backlogId, backlogStatus] of backlogStatuses) {
  const references = referencedBacklogIds.get(backlogId);
  if (backlogStatus !== "COMPLETE" && references.size === 0)
    throw new Error(`TRACEABILITY_BACKLOG_UNMAPPED:${backlogId}`);
  if (backlogStatus === "COMPLETE" && references.size > 0)
    throw new Error(`TRACEABILITY_BACKLOG_COMPLETE_STILL_MAPPED:${backlogId}`);
}

const sortedIds = [...ids].sort();
const idSetSha256 = sha256(`${sortedIds.join("\n")}\n`);
if (ledger.statusPolicy.requirementCount !== ids.size)
  throw new Error(
    `TRACEABILITY_REQUIREMENT_COUNT:${ledger.statusPolicy.requirementCount}:${ids.size}`,
  );
if (ledger.statusPolicy.requirementIdSetSha256 !== idSetSha256)
  throw new Error(
    `TRACEABILITY_REQUIREMENT_ID_SET:${ledger.statusPolicy.requirementIdSetSha256}:${idSetSha256}`,
  );

for (const reviewedArtifact of ledger.statusPolicy.reviewedAgainst)
  if (!existsSync(resolve(root, reviewedArtifact)))
    throw new Error(
      `TRACEABILITY_REVIEWED_ARTIFACT_MISSING:${reviewedArtifact}`,
    );
for (const artifact of ledger.statusPolicy.evidenceManifests ?? [])
  if (!existsSync(resolve(root, artifact)))
    throw new Error(`TRACEABILITY_EVIDENCE_MISSING:${artifact}`);

const normativeSpecSections = new Set(
  [...contractText.matchAll(/^## (\d+)\. /gm)]
    .map((match) => Number(match[1]))
    .filter((section) => section <= 22),
);
const coveredSpecSections = new Set();
for (const requirement of ledger.requirements) {
  const sourceSection = requirement.source.match(/§(\d+)/)?.[1];
  if (!sourceSection)
    throw new Error(`TRACEABILITY_SOURCE_SECTION_MISSING:${requirement.id}`);
  const section = Number(sourceSection);
  if (!normativeSpecSections.has(section))
    throw new Error(
      `TRACEABILITY_SOURCE_SECTION_INVALID:${requirement.id}:${section}`,
    );
  coveredSpecSections.add(section);
}
for (const section of normativeSpecSections)
  if (!coveredSpecSections.has(section))
    throw new Error(`TRACEABILITY_SPEC_SECTION_UNMAPPED:${section}`);

for (const rcId of [
  "SPEC-22-RC-01",
  "SPEC-22-RC-02",
  "SPEC-22-RC-03",
  "SPEC-22-RC-04",
  "SPEC-22-RC-05",
]) {
  const rcRequirement = ledger.requirements.find(
    (requirement) => requirement.id === rcId,
  );
  if (rcRequirement?.status !== "historical")
    throw new Error(`TRACEABILITY_RETIRED_LANE_NOT_HISTORICAL:${rcId}`);
}

if (
  ["repository-qualified", "launch-qualified"].includes(
    ledger.statusPolicy.reviewState,
  )
) {
  const unresolvedRequirements = ledger.requirements.filter((requirement) =>
    ["partial", "unimplemented"].includes(requirement.status),
  );
  if (unresolvedRequirements.length > 0)
    throw new Error(
      `TRACEABILITY_QUALIFIED_WITH_INTERNAL_GAPS:${unresolvedRequirements
        .map((requirement) => requirement.id)
        .join(",")}`,
    );
  const unresolvedBacklog = [...backlogStatuses].filter(([, status]) =>
    ["OPEN", "INTEGRATED-PENDING"].includes(status),
  );
  if (unresolvedBacklog.length > 0)
    throw new Error(
      `TRACEABILITY_QUALIFIED_WITH_BACKLOG:${unresolvedBacklog
        .map(([backlogId]) => backlogId)
        .join(",")}`,
    );
}

if (ledger.statusPolicy.reviewState === "launch-qualified") {
  const designApprovalSection = launchChecklist.match(
    /### Human design approval required for any future RC\/launch designation([\s\S]*?)Blank names are a failed gate\./,
  )?.[1];
  if (!designApprovalSection)
    throw new Error("TRACEABILITY_DESIGN_APPROVAL_SECTION_MISSING");
  const approvalFields = new Map(
    designApprovalSection
      .split("\n")
      .filter((line) => /^\|[^-].*\|$/.test(line))
      .map((line) =>
        line
          .split("|")
          .slice(1, -1)
          .map((cell) => cell.trim().replaceAll("**", "")),
      )
      .filter((cells) => cells.length === 2)
      .map(([field, value]) => [field.replace(/\s+/g, " "), value]),
  );
  const approvalName = approvalFields.get("Approver name") ?? "";
  const approvalDecision =
    approvalFields.get("Decision (`APPROVE` or `REJECT`)") ?? "";
  const approvalTimestamp = approvalFields.get("UTC timestamp") ?? "";
  const reviewedSha = approvalFields.get("Reviewed SHA") ?? "";
  const approvalEvidence = approvalFields.get("Evidence/reference") ?? "";
  const approvalConditions =
    approvalFields.get("Conditions and resolution") ?? "";
  if (
    approvalName.length < 2 ||
    /pending|assistant|unknown|tbd/i.test(approvalName)
  )
    throw new Error("TRACEABILITY_DESIGN_APPROVER_INVALID");
  if (approvalDecision.replaceAll("`", "") !== "APPROVE")
    throw new Error("TRACEABILITY_DESIGN_DECISION_INVALID");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(approvalTimestamp))
    throw new Error("TRACEABILITY_DESIGN_TIMESTAMP_INVALID");
  if (!/^[0-9a-f]{40}$/.test(reviewedSha.replaceAll("`", "")))
    throw new Error("TRACEABILITY_DESIGN_SHA_INVALID");
  if (
    approvalEvidence.length < 5 ||
    /pending|unknown|tbd/i.test(approvalEvidence)
  )
    throw new Error("TRACEABILITY_DESIGN_EVIDENCE_INVALID");
  if (
    approvalConditions.length < 2 ||
    /pending|unresolved|conditional|tbd/i.test(approvalConditions)
  )
    throw new Error("TRACEABILITY_DESIGN_CONDITIONS_INVALID");
}

const acceptanceIds = sortedIds.filter((id) => /^SPEC-22-AC-\d{2}$/.test(id));
if (acceptanceIds.length !== 10)
  throw new Error(`TRACEABILITY_ACCEPTANCE_COUNT:${acceptanceIds.length}`);

const counts = Object.fromEntries(
  [...statuses].map((status) => [
    status,
    ledger.requirements.filter((requirement) => requirement.status === status)
      .length,
  ]),
);
console.log(
  JSON.stringify(
    {
      ledgerPath,
      schemaPath,
      contractSha256: ledger.contractSha256,
      requirementIdSetSha256: idSetSha256,
      requirements: ids.size,
      acceptanceRows: acceptanceIds.length,
      backlogIds: backlogIds.size,
      externalGateIds: gateIds.size,
      counts,
    },
    null,
    2,
  ),
);
