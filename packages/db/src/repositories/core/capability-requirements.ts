/**
 * The capability switches a core command needs before it may run, and whether
 * it runs as recovery work. Recovery reads `recovery_enabled` instead of
 * `enabled` (`public.system_capability_is_enabled(key, recovery)`), so finishing
 * work already in flight can stay on while new work is switched off.
 *
 * `DatabaseCoreFinanceRepository` enforces this inside the command
 * transaction; screens read the same function so they never offer a command
 * the server would refuse. Pure and free of database imports.
 */
export type CoreCapabilityKey =
  "new_business" | "legal" | "billing" | "partner" | "marketplace" | "teardown";

export interface CoreCapabilityRequirement {
  readonly capabilities: readonly CoreCapabilityKey[];
  readonly recovery: boolean;
}

export function coreCommandCapabilities(input: {
  resource: string;
  action: string;
  /** The order route, known only when an order is being accepted. */
  route?: string;
}): CoreCapabilityRequirement {
  switch (input.resource) {
    case "accounts":
    case "quotes":
      return { capabilities: ["new_business", "legal"], recovery: false };
    case "procurement_profiles":
      return { capabilities: ["legal"], recovery: false };
    // Price-book administration is list-price configuration, not selling.
    // Permissions, the two-person (or reasoned self-) approval, audit and
    // published immutability govern it; quotes and orders keep their own
    // switches, so an active book opens no sales path by itself.
    case "price_books":
      return { capabilities: [], recovery: false };
    case "orders": {
      const capabilities: CoreCapabilityKey[] = [
        "new_business",
        "legal",
        "billing",
      ];
      if (["referral", "resale", "distributor"].includes(input.route ?? ""))
        capabilities.push("partner");
      if (input.route === "marketplace") capabilities.push("marketplace");
      return { capabilities, recovery: false };
    }
    case "amendments":
    case "commitments":
      return {
        capabilities: ["new_business", "legal", "billing"],
        recovery: false,
      };
    case "invoices":
      return {
        capabilities: ["billing"],
        recovery: input.action === "evaluate_dunning",
      };
    case "credit_notes":
    case "refunds":
    case "disputes":
    case "accounting_exports":
    case "reports":
      return { capabilities: ["billing"], recovery: true };
    case "deal_registrations":
      return { capabilities: ["new_business", "partner"], recovery: false };
    case "commissions":
      return { capabilities: ["billing", "partner"], recovery: true };
    case "marketplace_reconciliations":
      return { capabilities: ["marketplace"], recovery: true };
    default:
      return { capabilities: [], recovery: false };
  }
}
