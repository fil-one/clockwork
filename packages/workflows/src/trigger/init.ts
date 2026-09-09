import { activateTriggerWorkerRuntime } from "../runtime/trigger-worker-bootstrap";

// Trigger loads init.ts in every execution process. Discovery runs separately,
// so activating only in index.ts leaves deployed tasks without repositories.
await activateTriggerWorkerRuntime();
