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

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const issues = demoDeployEnvironmentIssues(process.env);
  if (issues.length > 0) {
    console.error("Demo deployment environment preflight failed:");
    for (const issue of issues) console.error(`- ${issue}`);
    process.exitCode = 1;
  } else {
    console.log("Demo deployment environment preflight passed.");
  }
}
