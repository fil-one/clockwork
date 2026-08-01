import assert from "node:assert/strict";
import { test } from "node:test";

import {
  normalizeArtifactText,
  normalizeReportValue,
  semanticArtifactInventoryFingerprint,
} from "./release-artifacts.mjs";

const roots = [
  ["/tmp/clockwork-parallel/workspace", "<workspace>"],
  ["/tmp/clockwork-parallel/artifacts", "<artifact-root>"],
];

test("normalizes disposable roots and isolated localhost origins", () => {
  assert.equal(
    normalizeArtifactText(
      "open http://127.0.0.1:32404 from /tmp/clockwork-parallel/workspace",
      roots,
    ),
    "open <isolated-runtime-origin> from <workspace>",
  );
});

test("normalizes report timing without hiding assertion content", () => {
  assert.deepEqual(
    normalizeReportValue(
      {
        duration: 921,
        command: "pnpm dev --port 32404 at http://localhost:32404",
        timestamp: "2026-08-01T06:29:50.561Z",
        assertion: "cross-account access is denied",
      },
      roots,
    ),
    {
      duration: "<runtime-value>",
      command: "pnpm dev --port 32404 at <isolated-runtime-origin>",
      timestamp: "<runtime-timestamp>",
      assertion: "cross-account access is denied",
    },
  );
});

test("semantic inventory ignores raw byte variance but detects content variance", () => {
  const entry = {
    path: "runtime/playwright.json",
    bytes: 80000,
    semanticSha256: "same-semantic-content",
    normalization: "runtime normalization",
  };
  assert.equal(
    semanticArtifactInventoryFingerprint([entry]),
    semanticArtifactInventoryFingerprint([{ ...entry, bytes: 80123 }]),
  );
  assert.notEqual(
    semanticArtifactInventoryFingerprint([entry]),
    semanticArtifactInventoryFingerprint([
      { ...entry, semanticSha256: "different-semantic-content" },
    ]),
  );
});
