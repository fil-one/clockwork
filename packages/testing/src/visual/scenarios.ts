export type ExperienceState =
  | "empty"
  | "loading"
  | "offline"
  | "optimistic"
  | "partial"
  | "permission"
  | "recoverable-error"
  | "stale"
  | "success"
  | "fatal-error"
  | "validation";

export const experienceStateCatalog = [
  "loading",
  "empty",
  "partial",
  "optimistic",
  "success",
  "validation",
  "permission",
  "stale",
  "offline",
  "recoverable-error",
  "fatal-error",
] as const satisfies readonly ExperienceState[];

/**
 * Normative state contract only. Executed browser qualification lives in
 * apps/web/e2e/visual.spec.ts against the reachable /states route; this module
 * intentionally contains no synthetic route or screenshot-pass assertions.
 */
export const stateGalleryContract = Object.freeze({
  route: "/states",
  states: experienceStateCatalog,
  requiredViewportWidths: [1440, 320],
});
