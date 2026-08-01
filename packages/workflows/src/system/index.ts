export * from "./outbox-dispatcher";
export * from "./lifecycle-task-dispatch";
export * from "./workos-organization";
export * from "./gate-activation-tasks";

export const systemWorkflowRegistry = [
  "system.outbox.dispatch.v1",
  "system.external-gates.activation.v1",
  "system.external-gates.activation-recovery.v1",
] as const;
