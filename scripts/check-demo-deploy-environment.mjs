import { pathToFileURL } from "node:url";

const DEMO_ORIGIN = "https://clockwork-commerce-demo.netlify.app";
const PRODUCTION_MARKERS = [
  "CLOCKWORK_ENV",
  "DEPLOYMENT_ENVIRONMENT",
  "ENVIRONMENT",
  "VERCEL_ENV",
];

export function demoDeployEnvironmentIssues(environment) {
  const issues = [];
  const requireExact = (key, expected) => {
    if (environment[key] !== expected)
      issues.push(`${key} must be exactly ${JSON.stringify(expected)}`);
  };

  requireExact("CLOCKWORK_DEMO_DEPLOY", "1");
  requireExact("NEXT_PUBLIC_CLOCKWORK_DEMO_DEPLOY", "1");
  requireExact("CLOCKWORK_EXPERIENCE_ADAPTER", "demo");
  requireExact("CLOCKWORK_EVIDENCE_ADAPTER", "demo");
  requireExact("NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV", "demo");
  requireExact("CLOCKWORK_DEMO_STATE_STORE", "netlify-blobs");
  requireExact("CLOCKWORK_CANONICAL_ORIGIN", DEMO_ORIGIN);

  if (!environment.CLOCKWORK_DEMO_ACCESS_PASSWORD?.trim())
    issues.push("CLOCKWORK_DEMO_ACCESS_PASSWORD must be present and non-blank");

  const signingOrigins = (environment.NEXT_PUBLIC_ESIGN_SIGNING_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!signingOrigins.includes(DEMO_ORIGIN))
    issues.push(
      `NEXT_PUBLIC_ESIGN_SIGNING_ORIGINS must include ${DEMO_ORIGIN}`,
    );

  for (const key of PRODUCTION_MARKERS)
    if (environment[key]?.trim().toLowerCase() === "production")
      issues.push(`${key} must not mark the fixture-only demo as production`);

  return issues;
}

/** The shared Netlify build supports the separate demo and real application. */
export function deploymentEnvironmentIssues(environment) {
  if (environment.CLOCKWORK_ENV !== "production")
    return demoDeployEnvironmentIssues(environment);
  const issues = [];
  for (const [key, value] of Object.entries({
    CLOCKWORK_EXPERIENCE_ADAPTER: "database",
    NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV: "production",
  }))
    if (environment[key] !== value) issues.push(`${key} must be ${value}`);
  for (const key of [
    "CLOCKWORK_DEMO_DEPLOY",
    "NEXT_PUBLIC_CLOCKWORK_DEMO_DEPLOY",
    "CLOCKWORK_DEMO_STATE_STORE",
    "CLOCKWORK_DEMO_ACCESS_PASSWORD",
    "CLOCKWORK_DEMO_STATE_PATH",
  ])
    if (environment[key]) issues.push(`${key} must be absent in production`);
  if (environment.CLOCKWORK_EVIDENCE_ADAPTER === "demo")
    issues.push("CLOCKWORK_EVIDENCE_ADAPTER must not be demo in production");
  for (const key of ["CLOCKWORK_ENABLE_SIMULATORS", "CLOCKWORK_RELEASE_PROOF"])
    if (environment[key] && !["0", "false"].includes(environment[key]))
      issues.push(`${key} must be disabled in production`);
  for (const key of [
    "DATABASE_URL",
    "CLOCKWORK_SERVICE_DATABASE_URL",
    "WORKOS_API_KEY",
    "WORKOS_CLIENT_ID",
    "WORKOS_COOKIE_PASSWORD",
    "AUTHORIZATION_CONTEXT_SECRET",
  ])
    if (!environment[key]?.trim())
      issues.push(`${key} is required in production`);
  const origin = environment.CLOCKWORK_CANONICAL_ORIGIN;
  try {
    const url = new URL(origin);
    if (
      url.protocol !== "https:" ||
      url.origin !== origin ||
      origin === DEMO_ORIGIN
    )
      issues.push("CLOCKWORK_CANONICAL_ORIGIN must be a distinct HTTPS origin");
  } catch {
    issues.push("CLOCKWORK_CANONICAL_ORIGIN must be a distinct HTTPS origin");
  }
  for (const key of ["APP_ORIGIN", "NEXT_PUBLIC_APP_URL"])
    if (environment[key] !== origin)
      issues.push(`${key} must match the canonical origin`);
  if (environment.WORKOS_REDIRECT_URI !== `${origin}/auth/callback`)
    issues.push("WORKOS_REDIRECT_URI must use the production callback");
  return issues;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const issues = deploymentEnvironmentIssues(process.env);
  if (issues.length > 0) {
    console.error("Deployment environment preflight failed:");
    for (const issue of issues) console.error(`- ${issue}`);
    process.exitCode = 1;
  } else {
    console.log("Deployment environment preflight passed.");
  }
}
