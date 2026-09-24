import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { detailLabels, detailValueLabels } from "./copy";

function workspaceRoot(): string {
  let directory = resolve(process.cwd());
  for (;;) {
    if (existsSync(join(directory, "pnpm-workspace.yaml"))) return directory;
    const parent = dirname(directory);
    if (parent === directory)
      throw new Error("Workspace root was not found above the test directory");
    directory = parent;
  }
}

type Schema = {
  properties?: Record<string, Schema>;
  enum?: unknown[];
};

const contract = JSON.parse(
  readFileSync(
    join(workspaceRoot(), "packages/api/src/generated/openapi.json"),
    "utf8",
  ),
) as {
  paths: Record<
    string,
    {
      get: {
        responses: Record<
          string,
          { content?: { "application/json"?: { schema?: Schema } } }
        >;
      };
    }
  >;
};

function statusDetails(path: string): Record<string, Schema> {
  const schema =
    contract.paths[path]?.get.responses["200"]?.content?.["application/json"]
      ?.schema;
  const details = schema?.properties?.details?.properties;
  if (!details) throw new Error(`${path} declares no status details`);
  return details;
}

const lanes = ["/v1/core/status", "/v1/lifecycle/status", "/v1/system/status"];

/**
 * The status page prints a detail it has no label for as the raw contract key.
 * That is how "partnerDomainOwnership" and "supportWebhook" reached operators
 * in every language: the lifecycle lane grew them and this map did not.
 */
describe("integration status labels cover the generated contract", () => {
  it.each(lanes)("labels every detail %s reports", (path) => {
    const unlabelled = Object.keys(statusDetails(path)).filter(
      (key) => !Object.hasOwn(detailLabels, key),
    );
    expect(unlabelled).toEqual([]);
  });

  it.each(lanes)("labels every detail value %s can report", (path) => {
    const values = Object.values(statusDetails(path)).flatMap(
      (detail) => detail.enum ?? [],
    );
    expect(values.length).toBeGreaterThan(0);
    const unlabelled = values.filter(
      (value) =>
        typeof value !== "string" || !Object.hasOwn(detailValueLabels, value),
    );
    expect(unlabelled).toEqual([]);
  });
});
