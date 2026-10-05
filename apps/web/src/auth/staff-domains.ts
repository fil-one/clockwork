import { staffEmailDomains } from "@clockwork/contracts";

/**
 * The staff email domains, from `INTERNAL_EMAIL_DOMAINS` (comma separated).
 * There is no built-in default: an environment that has not said which domains
 * are Fil One's has no staff domains, and nobody signs in or is invited as
 * staff there.
 */
export function configuredStaffEmailDomains(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string[] {
  return staffEmailDomains(environment.INTERNAL_EMAIL_DOMAINS);
}

/** The staff email domains, or a refusal when none are configured. */
export function requireStaffEmailDomains(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string[] {
  const domains = configuredStaffEmailDomains(environment);
  if (domains.length === 0)
    throw new Error(
      // i18n-exempt: server-side configuration error for logs; in production readers get the translated error page and a digest
      "Staff sign-in is unavailable until INTERNAL_EMAIL_DOMAINS is configured",
    );
  return domains;
}
