import assert from "node:assert/strict";
import test from "node:test";

import {
  demoDeployEnvironmentIssues,
  deploymentEnvironmentIssues,
} from "./check-demo-deploy-environment.mjs";

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

function productionEnvironment(overrides = {}) {
  const origin = "https://clockwork-fil-one.netlify.app";
  return {
    CLOCKWORK_ENV: "production",
    CLOCKWORK_EXPERIENCE_ADAPTER: "database",
    NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV: "production",
    DATABASE_URL: "postgresql://runtime.invalid/database",
    CLOCKWORK_SERVICE_DATABASE_URL: "postgresql://service.invalid/database",
    WORKOS_API_KEY: "test-only-provider-key",
    WORKOS_CLIENT_ID: "client_test",
    WORKOS_COOKIE_PASSWORD: "test-only-cookie-secret",
    AUTHORIZATION_CONTEXT_SECRET: "test-only-context-secret",
    CLOCKWORK_CANONICAL_ORIGIN: origin,
    APP_ORIGIN: origin,
    NEXT_PUBLIC_APP_URL: origin,
    WORKOS_REDIRECT_URI: `${origin}/auth/callback`,
    ...overrides,
  };
}

test("shared build accepts real production and preserves strict demo checks", () => {
  assert.deepEqual(deploymentEnvironmentIssues(productionEnvironment()), []);
  assert.deepEqual(deploymentEnvironmentIssues(validEnvironment()), []);
  assert.ok(deploymentEnvironmentIssues({}).length > 0);
});

test("production refuses demo state, proof identities, and simulators", () => {
  for (const [key, value] of Object.entries({
    CLOCKWORK_DEMO_DEPLOY: "1",
    NEXT_PUBLIC_CLOCKWORK_DEMO_DEPLOY: "1",
    CLOCKWORK_DEMO_STATE_STORE: "netlify-blobs",
    CLOCKWORK_DEMO_ACCESS_PASSWORD: "fixture",
    CLOCKWORK_DEMO_STATE_PATH: "/tmp/demo.json",
    CLOCKWORK_EXPERIENCE_ADAPTER: "demo",
    CLOCKWORK_EVIDENCE_ADAPTER: "demo",
    NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV: "demo",
    CLOCKWORK_ENABLE_SIMULATORS: "true",
    CLOCKWORK_RELEASE_PROOF: "1",
  }))
    assert.ok(
      deploymentEnvironmentIssues(productionEnvironment({ [key]: value })).some(
        (issue) => issue.includes(key),
      ),
      key,
    );
});

test("production requires credentials and one distinct HTTPS callback origin", () => {
  for (const key of [
    "DATABASE_URL",
    "CLOCKWORK_SERVICE_DATABASE_URL",
    "WORKOS_API_KEY",
    "WORKOS_CLIENT_ID",
    "WORKOS_COOKIE_PASSWORD",
    "AUTHORIZATION_CONTEXT_SECRET",
    "APP_ORIGIN",
    "NEXT_PUBLIC_APP_URL",
    "WORKOS_REDIRECT_URI",
  ])
    assert.ok(
      deploymentEnvironmentIssues(productionEnvironment({ [key]: "" })).some(
        (issue) => issue.includes(key),
      ),
      key,
    );
  for (const origin of [
    "http://localhost:3000",
    "https://clockwork-commerce-demo.netlify.app",
    "invalid",
  ])
    assert.ok(
      deploymentEnvironmentIssues(
        productionEnvironment({ CLOCKWORK_CANONICAL_ORIGIN: origin }),
      ).length > 0,
    );
});
