import { describe, expect, it } from "vitest";

import {
  experienceArtifactKinds,
  experienceOpenApiPaths,
  experienceProjectionChannels,
  withExperienceOpenApiContract,
} from "./experience-openapi";

describe("experience OpenAPI contract", () => {
  it("publishes every supported artifact kind without accepting document facts", () => {
    expect(experienceArtifactKinds).toHaveLength(15);
    const create =
      experienceOpenApiPaths["/api/experience/artifacts/render-requests"].post;
    const schema = create.requestBody.content["application/json"].schema;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.kind.enum).toEqual(experienceArtifactKinds);
    expect(schema.properties.expectedVersion).toMatchObject({
      minLength: 1,
      maxLength: 80,
    });
    expect(schema.properties.accountId.oneOf).toContainEqual({ type: "null" });
    expect(Object.keys(schema.properties).sort()).toEqual([
      "accountId",
      "audience",
      "expectedVersion",
      "kind",
      "subjectId",
    ]);
  });

  it("uses the direct public representation for execute and read responses", () => {
    const execute =
      experienceOpenApiPaths[
        "/api/experience/artifacts/render-requests/{requestId}"
      ].post.responses["201"].content["application/json"].schema;
    expect(execute.required).toContain("downloadHref");
    expect(execute.properties).not.toHaveProperty("artifact");
    expect(execute.properties).not.toHaveProperty("storageVersionId");

    const read =
      experienceOpenApiPaths["/api/experience/artifacts/{kind}/{artifactId}"]
        .get;
    expect(read.parameters).toContainEqual(
      expect.objectContaining({
        in: "query",
        name: "representation",
        schema: { type: "string", enum: ["json"] },
      }),
    );
    expect(Object.keys(read.responses["200"].content).sort()).toEqual([
      "application/json",
      "application/pdf",
    ]);
    expect(Object.keys(read.responses["200"].headers).sort()).toEqual([
      "Cache-Control",
      "Content-Disposition",
      "Content-Length",
      "X-Content-Type-Options",
      "x-content-sha256",
    ]);
    expect(read.responses).toHaveProperty("422");
    expect(read.responses["200"].headers).not.toHaveProperty(
      "x-storage-version-id",
    );
  });

  it("publishes exact public render-request and artifact response shapes", () => {
    const renderRequest =
      experienceOpenApiPaths["/api/experience/artifacts/render-requests"].post
        .responses["201"].content["application/json"].schema;
    const renderRequestFields = [
      "accountId",
      "audience",
      "audienceAccountId",
      "id",
      "kind",
      "retainUntil",
      "sourceHash",
      "sourceVersion",
      "status",
      "subjectId",
      "subjectType",
      "version",
    ];
    expect([...renderRequest.required].sort()).toEqual(renderRequestFields);
    expect(Object.keys(renderRequest.properties).sort()).toEqual(
      renderRequestFields,
    );
    expect(renderRequest.additionalProperties).toBe(false);
    expect(renderRequest.properties).not.toHaveProperty("input");

    const execute =
      experienceOpenApiPaths[
        "/api/experience/artifacts/render-requests/{requestId}"
      ].post.responses["201"].content["application/json"].schema;
    const publicArtifactFields = [
      "accountId",
      "audience",
      "audienceAccountId",
      "byteLength",
      "contentHash",
      "createdAt",
      "documentId",
      "downloadHref",
      "filename",
      "id",
      "kind",
      "mimeType",
      "retainUntil",
      "sourceHash",
      "subjectId",
      "subjectType",
      "version",
    ];
    expect([...execute.required].sort()).toEqual(publicArtifactFields);
    expect(Object.keys(execute.properties).sort()).toEqual(
      publicArtifactFields,
    );
    expect(execute.additionalProperties).toBe(false);
    expect(execute.properties).not.toHaveProperty("storageKey");
    expect(execute.properties).not.toHaveProperty("storageVersionId");
    expect(
      experienceOpenApiPaths["/api/experience/artifacts/{kind}/{artifactId}"]
        .get.responses["200"].content["application/json"].schema,
    ).toBe(execute);
  });

  it("keeps list, detail, action, and receipt operations distinct", () => {
    expect(experienceProjectionChannels).toHaveLength(24);
    const list =
      experienceOpenApiPaths["/api/experience/projections/{audience}/{channel}"]
        .get;
    const detail =
      experienceOpenApiPaths[
        "/api/experience/projections/{audience}/{channel}/{recordKey}"
      ].get;
    const action =
      experienceOpenApiPaths[
        "/api/experience/projections/{audience}/{channel}/{recordKey}/actions"
      ].post;
    const receipt =
      experienceOpenApiPaths[
        "/api/experience/projections/{audience}/{channel}/{recordKey}/actions/{actionRequestId}"
      ].get;
    expect(
      new Set([
        list.operationId,
        detail.operationId,
        action.operationId,
        receipt.operationId,
      ]).size,
    ).toBe(4);
    expect(
      action.requestBody.content["application/json"].schema.properties
        .expectedVersion,
    ).toEqual({ type: "integer", minimum: 1 });
    const receiptSchema =
      receipt.responses["200"].content["application/json"].schema;
    const receiptFields = [
      "action",
      "aggregateId",
      "aggregateType",
      "auditEventId",
      "authoritativeVersion",
      "commandReplayed",
      "completedAt",
      "createdAt",
      "expectedVersion",
      "id",
      "outboxMessageId",
      "projectionId",
      "resultCode",
      "resultReference",
      "status",
    ];
    expect([...receiptSchema.required].sort()).toEqual(receiptFields);
    expect(Object.keys(receiptSchema.properties).sort()).toEqual(receiptFields);
    expect(receiptSchema.additionalProperties).toBe(false);
    expect(receiptSchema.required).toContain("commandReplayed");
    expect(receiptSchema.properties.commandReplayed.oneOf).toEqual([
      { type: "boolean" },
      { type: "null" },
    ]);
    expect(action.responses["202"].content["application/json"].schema).toBe(
      receiptSchema,
    );

    const listSchema = list.responses["200"].content["application/json"].schema;
    expect([...listSchema.required].sort()).toEqual([
      "freshnessSeconds",
      "generatedAt",
      "items",
      "nextCursor",
    ]);
    const projectionSchema =
      detail.responses["200"].content["application/json"].schema;
    expect(listSchema.properties.items.items).toBe(projectionSchema);
    expect([...projectionSchema.required].sort()).toEqual([
      "accountId",
      "aggregateId",
      "aggregateType",
      "audience",
      "channel",
      "data",
      "id",
      "projectedAt",
      "recordKey",
      "sourceUpdatedAt",
      "stale",
      "version",
    ]);
  });

  it("adds all experience paths and session security to generated output", () => {
    const document = withExperienceOpenApiContract({
      openapi: "3.1.0",
      paths: { "/v1/core/status": { get: {} } },
    });
    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining([
        "/v1/core/status",
        "/api/experience/projections/{audience}/{channel}",
        "/api/experience/projections/{audience}/{channel}/{recordKey}",
        "/api/experience/projections/{audience}/{channel}/{recordKey}/actions",
        "/api/experience/projections/{audience}/{channel}/{recordKey}/actions/{actionRequestId}",
        "/api/experience/artifacts/render-requests",
        "/api/experience/artifacts/render-requests/{requestId}",
        "/api/experience/artifacts/{kind}/{artifactId}",
      ]),
    );
    expect(document.components.securitySchemes).toHaveProperty(
      "experienceSession",
    );
  });
});
