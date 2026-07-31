export * from "./authorization-scopes";
export * from "./partner-domains";
export * from "./accepted-order-provisioning";
export * from "./command-repository";
export * from "./deletion-certificates";
export * from "./schemas";

import { DatabaseLifecycleAuthorizationScopeResolver } from "./authorization-scopes";

/** Database adapters owned by the lifecycle-platform composition. */
export const lifecycleRepositoryRegistry = [
  DatabaseLifecycleAuthorizationScopeResolver,
] as const;
