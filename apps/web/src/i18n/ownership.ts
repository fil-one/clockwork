import type { MessageModuleName } from "./catalogs";

/**
 * Which translation lane owns a source file, by path.
 *
 * The rules are prefixes and patterns, not a file list, so a lane adding a file
 * never edits this module. `catalogs.test.ts` uses it to keep every lane on its
 * own message module plus `common` and `enums`: a lane that referenced another
 * lane's IDs could be broken by that lane renaming them, and the two branches
 * would only find out at merge time.
 *
 * Paths are repository-relative with forward slashes.
 */
export type Lane =
  | "partner"
  | "customer"
  | "experience"
  | "adminPricing"
  | "adminGovernance"
  | "operations"
  | "platform"
  | "demo"
  | "foundation";

export const laneModules: Readonly<
  Record<Exclude<Lane, "foundation">, MessageModuleName>
> = {
  partner: "partner",
  customer: "customer",
  experience: "experience",
  adminPricing: "adminPricing",
  adminGovernance: "adminGovernance",
  operations: "operations",
  platform: "platform",
  demo: "demo",
};

const web = "apps/web/";
const safety = "apps/web/src/features/internal-ops/administration-safety/";
const internalPages = "apps/web/app/(experience)/(internal)/internal/";

/** Files the lanes treat as read-only: the i18n core and shared helpers. */
const foundationFiles = new Set([
  "apps/web/src/features/customer-partner/projection-freshness.tsx",
  "apps/web/src/features/customer-partner/sortable-column.ts",
  "apps/web/src/features/customer-partner/formatting.ts",
  // The one module that words API failures for every surface (platform and
  // experience wording together); it replaced a second, experience-only one.
  "apps/web/src/features/contracts/error-text.ts",
  "packages/testing/src/demo/localized-text.ts",
]);

const messageModuleFiles: Readonly<Record<string, Lane>> = {
  "partner.ts": "partner",
  "customer.ts": "customer",
  "customer-commercial.ts": "customer",
  "experience.ts": "experience",
  "experience-data.ts": "experience",
  "admin-pricing.ts": "adminPricing",
  "admin-governance.ts": "adminGovernance",
  "operations.ts": "operations",
  "operations-finance.ts": "operations",
  "platform.ts": "platform",
  "demo.ts": "demo",
};

export function laneOf(path: string): Lane | null {
  const messages = "apps/web/src/i18n/messages/";
  if (path.startsWith(messages))
    return messageModuleFiles[path.slice(messages.length)] ?? "foundation";
  if (path.startsWith("apps/web/src/i18n/") || foundationFiles.has(path))
    return "foundation";

  if (
    path.startsWith(`${web}app/demo/`) ||
    path === `${web}app/layout.tsx` ||
    path === `${web}src/auth/demo-persona.ts` ||
    path.startsWith(`${web}src/features/shell/demo-persona-switcher`) ||
    path === "packages/testing/src/personas/catalog.ts" ||
    path === "packages/testing/src/demo/journeys.ts"
  )
    return "demo";

  if (
    path.startsWith(`${web}src/features/customer-partner/partner/`) ||
    path.startsWith(`${web}app/(experience)/(partner)/`)
  )
    return "partner";
  if (
    path.startsWith(`${web}src/features/customer-partner/`) ||
    path.startsWith(`${web}app/(experience)/(customer)/`)
  )
    return "customer";

  if (path.startsWith(`${web}src/features/experience-server/`))
    return "experience";
  // Projection presentation is written by the workflows package and rendered
  // by experience-server surfaces.
  if (path.startsWith("packages/workflows/src/experience/"))
    return "experience";

  if (path.startsWith(safety))
    return /^(price-books|price-book-|payg-offers|catalog)/u.test(
      path.slice(safety.length),
    )
      ? "adminPricing"
      : "adminGovernance";
  if (
    path.startsWith(`${web}src/features/internal-ops/price-books/`) ||
    path.startsWith(`${web}src/features/internal-ops/commercial-policies/`)
  )
    return "adminPricing";
  if (path.startsWith(internalPages)) {
    const page = path.slice(internalPages.length);
    if (/^(price-books|payg-offers|payg-requests|catalog)\//u.test(page))
      return "adminPricing";
    if (
      /^(agreements|approvals|assisted|gates|capabilities|providers|channel-policy)\//u.test(
        page,
      )
    )
      return "adminGovernance";
    return "operations";
  }
  if (
    path.startsWith(`${web}src/features/internal-ops/`) ||
    path.startsWith(`${web}app/(experience)/(internal)/`)
  )
    return "operations";

  if (path.startsWith("packages/ui/src/")) return "platform";
  if (path.startsWith(web)) return "platform";
  return null;
}
