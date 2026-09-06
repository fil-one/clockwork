export * from "./accounts";
export * from "./amendments";
export * from "./billing";
export * from "./commissions";
export * from "./commitments";
export * from "./decimal";
export * from "./derivation";
export * from "./orders";
export * from "./partners";
export * from "./payg";
export * from "./pricing";
export * from "./procurement";
export * from "./quotes";
export * from "./reports";
export * from "./tax";
export * from "./trials";

// `coreDomainRegistry` names the lanes the composition test counts, and tax is
// not one of them: the determination engine is domain code the finance lane
// calls, not a lane of its own. Adding it here would change a count that means
// something else.
export const coreDomainRegistry = [
  "accounts",
  "pricing",
  "quotes",
  "orders",
  "amendments",
  "commitments",
  "billing",
  "partners",
  "commissions",
  "reports",
  "derivation",
  "procurement",
] as const;
export * from "./channel-policy";
