import assert from "node:assert/strict";
import test from "node:test";

import { demoDeployEnvironmentIssues } from "./check-demo-deploy-environment.mjs";

function validEnvironment(overrides = {}) {
  return {
    CLOCKWORK_DEMO_DEPLOY: "1",
    NEXT_PUBLIC_CLOCKWORK_DEMO_DEPLOY: "1",
    CLOCKWORK_EXPERIENCE_ADAPTER: "demo",
    CLOCKWORK_EVIDENCE_ADAPTER: "demo",
    NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV: "demo",
    CLOCKWORK_DEMO_STATE_STORE: "netlify-blobs",
    CLOCKWORK_CANONICAL_ORIGIN: "https://clockwork-commerce-demo.netlify.app",
    CLOCKWORK_DEMO_ACCESS_PASSWORD: "not-a-real-secret",
    NEXT_PUBLIC_ESIGN_SIGNING_ORIGINS:
      "https://clockwork-commerce-demo.netlify.app",
    CLOCKWORK_ENV: "demo",
    ...overrides,
  };
}

test("accepts the complete fixture-only Netlify environment", () => {
  assert.deepEqual(demoDeployEnvironmentIssues(validEnvironment()), []);
});

test("refuses every missing identity and state signal", () => {
  const required = [
    "CLOCKWORK_DEMO_DEPLOY",
    "NEXT_PUBLIC_CLOCKWORK_DEMO_DEPLOY",
    "CLOCKWORK_EXPERIENCE_ADAPTER",
    "CLOCKWORK_EVIDENCE_ADAPTER",
    "NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV",
    "CLOCKWORK_DEMO_STATE_STORE",
    "CLOCKWORK_CANONICAL_ORIGIN",
    "CLOCKWORK_DEMO_ACCESS_PASSWORD",
    "NEXT_PUBLIC_ESIGN_SIGNING_ORIGINS",
  ];
  for (const key of required) {
    const environment = validEnvironment();
    delete environment[key];
    assert.ok(
      demoDeployEnvironmentIssues(environment).some((issue) =>
        issue.includes(key),
      ),
      `${key} was not enforced`,
    );
  }
});

test("refuses every production marker even with all demo flags", () => {
  for (const key of [
    "CLOCKWORK_ENV",
    "DEPLOYMENT_ENVIRONMENT",
    "ENVIRONMENT",
    "VERCEL_ENV",
  ])
    assert.ok(
      demoDeployEnvironmentIssues(
        validEnvironment({ [key]: " Production " }),
      ).some((issue) => issue.includes(key)),
      `${key} did not veto the demo deployment`,
    );
});
