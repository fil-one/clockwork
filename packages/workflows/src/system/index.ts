export * from "./outbox-dispatcher";
export * from "./lifecycle-task-dispatch";
export * from "./workos-organization";

export const systemWorkflowRegistry = ["system.outbox.dispatch.v1"] as const;
