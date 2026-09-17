export type TaskModuleImporter = () => Promise<unknown>;

/**
 * The production task modules. Importing one registers its tasks, so this list
 * lives apart from the registry itself: the task modules import the registry,
 * and a registry that imported them back would close a cycle.
 *
 * Exported so a test can drive the same list discovery uses rather than a
 * second copy of it.
 */
export const productionTaskImporters: readonly TaskModuleImporter[] = [
  () => import("../core/tasks"),
  () => import("../core/scheduled-tasks"),
  () => import("../core/payg-scheduled-tasks"),
  () => import("../core/price-book-scheduled-tasks"),
  () => import("../agreements/tasks"),
  () => import("../exceptions/tasks"),
  () => import("../migrations/tasks"),
  () => import("../offboarding/tasks"),
  () => import("../onboarding/tasks"),
  () => import("../pocs/tasks"),
  () => import("../provisioning/tasks"),
  () => import("../quotes/tasks"),
  () => import("../renewals/tasks"),
  () => import("../system/tasks"),
  () => import("../system/gate-activation-tasks"),
  () => import("../webhook-replay/tasks"),
];

/**
 * Imports every production task module, which registers every task. The module
 * cache makes a second call a no-op, so a host may call it freely. Carries no
 * database bootstrap: a host activates the workflow runtime first and then
 * calls this.
 */
export function loadAllTaskModules(
  importers: readonly TaskModuleImporter[] = productionTaskImporters,
): Promise<void> {
  return importers.reduce<Promise<void>>(
    (chain, importModule) => chain.then(() => importModule()).then(() => {}),
    Promise.resolve(),
  );
}
