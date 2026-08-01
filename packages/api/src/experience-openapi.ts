export const experienceArtifactKinds = [
  "direct_quote",
  "partner_transfer_quote",
  "partner_resale_quote",
  "order_form",
  "amendment",
  "poc_summary",
  "poc_final_report",
  "invoice_companion",
  "receipt",
  "commission_statement",
  "renewal_confirmation",
  "decline_confirmation",
  "deletion_certificate",
  "reconciliation_report",
  "report_export",
] as const;

export const experienceProjectionChannels = [
  "dashboard",
  "agreements",
  "quotes",
  "orders",
  "services",
  "pocs",
  "billing",
  "amendments",
  "procurement",
  "users",
  "marketplace",
  "support",
  "portfolio",
  "registrations",
  "disputes",
  "commissions",
  "renewals",
  "sandboxes",
  "brand",
  "queues",
  "approvals",
  "collections",
  "provisioning",
  "reports",
] as const;

const uuidSchema = { type: "string", format: "uuid" } as const;
const nullableUuidSchema = {
  oneOf: [uuidSchema, { type: "null" }],
} as const;
const nullableStringSchema = {
  oneOf: [{ type: "string" }, { type: "null" }],
} as const;
const nullableDateTimeSchema = {
  oneOf: [{ type: "string", format: "date-time" }, { type: "null" }],
} as const;
const positiveIntegerSchema = {
  type: "integer",
  minimum: 1,
} as const;
const artifactKindSchema = {
  type: "string",
  enum: experienceArtifactKinds,
} as const;
const audienceSchema = {
  type: "string",
  enum: ["customer", "partner", "internal"],
} as const;
const projectionChannelSchema = {
  type: "string",
  enum: experienceProjectionChannels,
} as const;
const problemResponse = {
  description: "Problem details response",
  content: {
    "application/problem+json": {
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["status", "code", "requestId"],
        properties: {
          type: { type: "string", format: "uri" },
          title: { type: "string" },
          status: { type: "integer" },
          code: { type: "string" },
          detail: { type: "string" },
          requestId: { type: "string" },
          retryable: { type: "boolean" },
        },
      },
    },
  },
} as const;
const mutationHeaders = [
  {
    in: "header",
    name: "x-csrf-token",
    required: true,
    schema: { type: "string", minLength: 32 },
  },
  {
    in: "header",
    name: "idempotency-key",
    required: true,
    schema: { type: "string", minLength: 16, maxLength: 255 },
  },
] as const;
const audiencePathParameter = {
  in: "path",
  name: "audience",
  required: true,
  schema: audienceSchema,
} as const;
const channelPathParameter = {
  in: "path",
  name: "channel",
  required: true,
  schema: projectionChannelSchema,
} as const;
const recordKeyPathParameter = {
  in: "path",
  name: "recordKey",
  required: true,
  schema: { type: "string", minLength: 1 },
} as const;
const accountIdQueryParameter = {
  in: "query",
  name: "accountId",
  required: false,
  schema: uuidSchema,
} as const;

const renderRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "accountId",
    "audience",
    "audienceAccountId",
    "subjectType",
    "subjectId",
    "kind",
    "sourceHash",
    "sourceVersion",
    "retainUntil",
    "status",
    "version",
  ],
  properties: {
    id: uuidSchema,
    accountId: nullableUuidSchema,
    audience: audienceSchema,
    audienceAccountId: nullableUuidSchema,
    subjectType: { type: "string", minLength: 1, maxLength: 80 },
    subjectId: uuidSchema,
    kind: artifactKindSchema,
    sourceHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
    sourceVersion: { type: "string", minLength: 1, maxLength: 80 },
    retainUntil: { type: "string", format: "date-time" },
    status: {
      type: "string",
      enum: ["pending", "rendering", "stored", "failed"],
    },
    version: positiveIntegerSchema,
  },
} as const;

const artifactRepresentationSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "kind",
    "subjectType",
    "subjectId",
    "accountId",
    "audience",
    "audienceAccountId",
    "documentId",
    "version",
    "sourceHash",
    "contentHash",
    "mimeType",
    "byteLength",
    "filename",
    "retainUntil",
    "createdAt",
    "downloadHref",
  ],
  properties: {
    id: uuidSchema,
    kind: artifactKindSchema,
    subjectType: { type: "string", minLength: 1, maxLength: 80 },
    subjectId: uuidSchema,
    accountId: nullableUuidSchema,
    audience: audienceSchema,
    audienceAccountId: nullableUuidSchema,
    documentId: uuidSchema,
    version: { type: "string", minLength: 1, maxLength: 80 },
    sourceHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
    contentHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
    mimeType: { type: "string", const: "application/pdf" },
    byteLength: { type: "string", pattern: "^[1-9][0-9]*$" },
    filename: {
      type: "string",
      pattern: "^[a-z0-9][a-z0-9._-]{0,159}\\.pdf$",
    },
    retainUntil: { type: "string", format: "date-time" },
    createdAt: { type: "string", format: "date-time" },
    downloadHref: { type: "string", pattern: "^/api/experience/artifacts/" },
  },
} as const;

const projectionRecordSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "recordKey",
    "aggregateType",
    "aggregateId",
    "accountId",
    "audience",
    "channel",
    "version",
    "sourceUpdatedAt",
    "projectedAt",
    "stale",
    "data",
  ],
  properties: {
    id: uuidSchema,
    recordKey: { type: "string", minLength: 1 },
    aggregateType: { type: "string", minLength: 1 },
    aggregateId: uuidSchema,
    accountId: nullableUuidSchema,
    audience: audienceSchema,
    channel: projectionChannelSchema,
    version: positiveIntegerSchema,
    sourceUpdatedAt: { type: "string", format: "date-time" },
    projectedAt: { type: "string", format: "date-time" },
    stale: { type: "boolean" },
    data: { type: "object", additionalProperties: true },
  },
} as const;

const projectionPageSchema = {
  type: "object",
  additionalProperties: false,
  required: ["items", "nextCursor", "generatedAt", "freshnessSeconds"],
  properties: {
    items: { type: "array", items: projectionRecordSchema },
    nextCursor: nullableStringSchema,
    generatedAt: { type: "string", format: "date-time" },
    freshnessSeconds: { type: "integer", minimum: 0 },
  },
} as const;

const projectionActionReceiptSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "projectionId",
    "aggregateType",
    "aggregateId",
    "action",
    "expectedVersion",
    "status",
    "resultReference",
    "resultCode",
    "authoritativeVersion",
    "commandReplayed",
    "createdAt",
    "completedAt",
    "auditEventId",
    "outboxMessageId",
  ],
  properties: {
    id: uuidSchema,
    projectionId: uuidSchema,
    aggregateType: { type: "string", minLength: 1 },
    aggregateId: uuidSchema,
    action: {
      type: "string",
      pattern: "^[a-z][a-z0-9_]{1,79}$",
    },
    expectedVersion: positiveIntegerSchema,
    status: {
      type: "string",
      enum: ["queued", "applied", "rejected", "failed"],
    },
    resultReference: nullableStringSchema,
    resultCode: nullableStringSchema,
    authoritativeVersion: {
      oneOf: [positiveIntegerSchema, { type: "null" }],
    },
    commandReplayed: {
      oneOf: [{ type: "boolean" }, { type: "null" }],
      description:
        "Null while queued and for migrated LEGACY_ terminal outcomes whose original command replay truth is unknowable.",
    },
    createdAt: { type: "string", format: "date-time" },
    completedAt: nullableDateTimeSchema,
    auditEventId: uuidSchema,
    outboxMessageId: uuidSchema,
  },
} as const;

export const experienceOpenApiPaths = {
  "/api/experience/projections/{audience}/{channel}": {
    get: {
      operationId: "listExperienceProjections",
      summary: "List authoritative portal projections",
      tags: ["Experience projections"],
      security: [{ experienceSession: [] }],
      parameters: [
        audiencePathParameter,
        channelPathParameter,
        accountIdQueryParameter,
        {
          in: "query",
          name: "cursor",
          required: false,
          schema: { type: "string", minLength: 1 },
        },
        {
          in: "query",
          name: "limit",
          required: false,
          schema: { type: "integer", minimum: 1, maximum: 100, default: 25 },
        },
      ],
      responses: {
        "200": {
          description: "Authorized projection page",
          content: {
            "application/json": { schema: projectionPageSchema },
          },
        },
        "403": problemResponse,
        "422": problemResponse,
        "503": problemResponse,
      },
    },
  },
  "/api/experience/projections/{audience}/{channel}/{recordKey}": {
    get: {
      operationId: "readExperienceProjection",
      summary: "Read one authoritative portal projection",
      tags: ["Experience projections"],
      security: [{ experienceSession: [] }],
      parameters: [
        audiencePathParameter,
        channelPathParameter,
        recordKeyPathParameter,
        accountIdQueryParameter,
      ],
      responses: {
        "200": {
          description: "Authorized projection record",
          content: {
            "application/json": { schema: projectionRecordSchema },
          },
        },
        "403": problemResponse,
        "404": problemResponse,
        "503": problemResponse,
      },
    },
  },
  "/api/experience/projections/{audience}/{channel}/{recordKey}/actions": {
    post: {
      operationId: "createExperienceProjectionAction",
      summary: "Queue a version-bound authoritative portal command",
      tags: ["Experience projections"],
      security: [{ experienceSession: [] }],
      parameters: [
        ...mutationHeaders,
        audiencePathParameter,
        channelPathParameter,
        recordKeyPathParameter,
        accountIdQueryParameter,
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              additionalProperties: false,
              required: [
                "projectionId",
                "action",
                "expectedVersion",
                "payload",
              ],
              properties: {
                projectionId: uuidSchema,
                action: {
                  type: "string",
                  pattern: "^[a-z][a-z0-9_]{1,79}$",
                },
                expectedVersion: positiveIntegerSchema,
                payload: { type: "object", additionalProperties: true },
              },
            },
          },
        },
      },
      responses: {
        "202": {
          description: "Durable projection action receipt",
          content: {
            "application/json": { schema: projectionActionReceiptSchema },
          },
        },
        "403": problemResponse,
        "404": problemResponse,
        "409": problemResponse,
        "422": problemResponse,
        "503": problemResponse,
      },
    },
  },
  "/api/experience/projections/{audience}/{channel}/{recordKey}/actions/{actionRequestId}":
    {
      get: {
        operationId: "readExperienceProjectionActionReceipt",
        summary: "Read an actor-scoped portal action receipt",
        tags: ["Experience projections"],
        security: [{ experienceSession: [] }],
        parameters: [
          audiencePathParameter,
          channelPathParameter,
          recordKeyPathParameter,
          {
            in: "path",
            name: "actionRequestId",
            required: true,
            schema: uuidSchema,
          },
          accountIdQueryParameter,
        ],
        responses: {
          "200": {
            description: "Queued or terminal projection action receipt",
            content: {
              "application/json": { schema: projectionActionReceiptSchema },
            },
          },
          "403": problemResponse,
          "404": problemResponse,
          "503": problemResponse,
        },
      },
    },
  "/api/experience/artifacts/render-requests": {
    post: {
      operationId: "createArtifactRenderRequest",
      summary: "Resolve authoritative persisted truth for an artifact render",
      description:
        "Accepts only artifact identity, optimistic source version, and audience scope. Document facts are resolved server-side from persisted records.",
      tags: ["Experience artifacts"],
      security: [{ experienceSession: [] }],
      parameters: mutationHeaders,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["kind", "subjectId", "expectedVersion", "audience"],
              properties: {
                kind: artifactKindSchema,
                subjectId: uuidSchema,
                expectedVersion: {
                  type: "string",
                  minLength: 1,
                  maxLength: 80,
                },
                audience: audienceSchema,
                accountId: nullableUuidSchema,
              },
            },
          },
        },
      },
      responses: {
        "201": {
          description: "Authoritative render request created",
          content: {
            "application/json": { schema: renderRequestSchema },
          },
        },
        "403": problemResponse,
        "409": problemResponse,
        "422": problemResponse,
        "503": problemResponse,
      },
    },
  },
  "/api/experience/artifacts/render-requests/{requestId}": {
    post: {
      operationId: "renderArtifactRequest",
      summary:
        "Render, redrive when failed, and immutably store an authoritative artifact request",
      tags: ["Experience artifacts"],
      security: [{ experienceSession: [] }],
      parameters: [
        ...mutationHeaders,
        {
          in: "path",
          name: "requestId",
          required: true,
          schema: uuidSchema,
        },
      ],
      responses: {
        "201": {
          description: "Immutable PDF representation",
          content: {
            "application/json": { schema: artifactRepresentationSchema },
          },
        },
        "403": problemResponse,
        "404": problemResponse,
        "409": problemResponse,
        "422": problemResponse,
        "502": problemResponse,
        "503": problemResponse,
      },
    },
  },
  "/api/experience/artifacts/{kind}/{artifactId}": {
    get: {
      operationId: "readExperienceArtifact",
      summary: "Read metadata or download verified immutable PDF bytes",
      tags: ["Experience artifacts"],
      security: [{ experienceSession: [] }],
      parameters: [
        {
          in: "path",
          name: "kind",
          required: true,
          schema: artifactKindSchema,
        },
        {
          in: "path",
          name: "artifactId",
          required: true,
          schema: uuidSchema,
        },
        {
          in: "query",
          name: "representation",
          required: false,
          description:
            "Return public metadata as JSON; omit to download verified PDF bytes.",
          schema: { type: "string", enum: ["json"] },
        },
      ],
      responses: {
        "200": {
          description: "Public artifact metadata or verified immutable PDF",
          headers: {
            "Content-Length": {
              description: "Present for a binary PDF response.",
              schema: { type: "string", pattern: "^[1-9][0-9]*$" },
            },
            "Content-Disposition": {
              description:
                "Safe attachment filename for a binary PDF response.",
              schema: { type: "string" },
            },
            "Cache-Control": {
              description: "Prevents storage of private artifact bytes.",
              schema: { type: "string", enum: ["private, no-store"] },
            },
            "X-Content-Type-Options": {
              schema: { type: "string", enum: ["nosniff"] },
            },
            "x-content-sha256": {
              description: "Present for a binary PDF response.",
              schema: { type: "string", pattern: "^[a-f0-9]{64}$" },
            },
          },
          content: {
            "application/json": { schema: artifactRepresentationSchema },
            "application/pdf": {
              schema: { type: "string", format: "binary" },
            },
          },
        },
        "403": problemResponse,
        "404": problemResponse,
        "409": problemResponse,
        "422": problemResponse,
        "502": problemResponse,
        "503": problemResponse,
      },
    },
  },
} as const;

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Adds Next-hosted experience routes to the canonical generated API contract. */
export function withExperienceOpenApiContract<
  T extends { paths?: unknown; components?: unknown },
>(
  document: T,
): T & {
  paths: Record<string, unknown>;
  components: Record<string, unknown> & {
    securitySchemes: Record<string, unknown>;
  };
} {
  const components = objectValue(document.components);
  const securitySchemes = objectValue(components.securitySchemes);
  return {
    ...document,
    paths: {
      ...objectValue(document.paths),
      ...experienceOpenApiPaths,
    },
    components: {
      ...components,
      securitySchemes: {
        ...securitySchemes,
        experienceSession: {
          type: "apiKey",
          in: "cookie",
          name: "workos-session",
        },
      },
    },
  };
}
