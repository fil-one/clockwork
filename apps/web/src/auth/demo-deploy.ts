import {
  demoDeployOptIn,
  findDemoProductionMarker,
} from "@clockwork/testing/demo-state";

/**
 * The one predicate every demo-only surface reads: the persona landing page,
 * the persona cookie route, the floating switcher, the password gate, and the
 * demo signing ceremony. It repeats the identity condition the request proxy
 * applies, so no surface can appear while the proxy still treats the
 * environment as an ordinary deployment.
 */
export function demoDeployIdentityEnabled(
  environment: Readonly<Record<string, string | undefined>>,
): boolean {
  return (
    demoDeployOptIn(environment) &&
    environment.CLOCKWORK_EXPERIENCE_ADAPTER === "demo" &&
    !findDemoProductionMarker(environment) &&
    environment.NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV?.trim().toLowerCase() !==
      "production"
  );
}

/**
 * Whether the browser reached this request over TLS. The deploy platform
 * terminates TLS ahead of the runtime, so the forwarded protocol is the first
 * answer and the request URL is the local fallback.
 */
export function secureDemoRequest(request: Request): boolean {
  const forwarded = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  if (forwarded) return forwarded === "https";
  return new URL(request.url).protocol === "https:";
}
