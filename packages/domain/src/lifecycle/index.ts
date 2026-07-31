export * from "../agreements";
export * from "../compliance";
export * from "../exceptions";
export * from "../identity";
export * from "../migrations";
export * from "../pocs";
export * from "../provisioning";
export * from "../renewals";
export * from "../terminations";

/** Stable domain families owned by the lifecycle-platform lane. */
export const lifecycleDomainRegistry = [
  "agreements",
  "compliance",
  "exceptions",
  "identity",
  "migrations",
  "pocs",
  "provisioning",
  "renewals",
  "terminations",
] as const;
