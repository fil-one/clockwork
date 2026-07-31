export * from "../crm";
export * from "../esign";
export * from "../evidence-storage";
export * from "../marketplaces-platform";
export * from "../notifications";
export * from "../provisioning";
export * from "../screening";
export * from "../support";
export * from "../workos";

/** Stable provider families owned by the lifecycle-platform lane. */
export const lifecycleIntegrationRegistry = [
  "crm",
  "esign",
  "evidence-storage",
  "marketplaces-platform",
  "notifications",
  "provisioning",
  "screening",
  "support",
  "workos",
] as const;
