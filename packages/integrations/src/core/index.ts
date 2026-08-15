export * from "./accounting/adapter";
export * from "./marketplaces/adapters";
export * from "./marketplaces/credential-gates";
export * from "./marketplaces/normalization";
export * from "./marketplaces/types";
export * from "./provider-result";
export * from "./stripe/gateway";
export * from "./stripe/adjustments";
export * from "./stripe/payment-sessions";
export * from "./stripe/types";
export * from "./stripe/webhooks";
export * from "./tax/http-tax-adapter";

export const coreIntegrationRegistry = [
  "stripe-finance-v1",
  "accounting-export-v1",
  "aws-marketplace-finance-v1",
  "azure-marketplace-finance-v1",
  "google-marketplace-finance-v1",
] as const;
