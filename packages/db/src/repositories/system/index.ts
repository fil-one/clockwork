export * from "./external-gates";
export * from "./exception-routing";
export * from "./gate-activation-tasks";
export * from "./outbox";
export * from "./providers";

import { DatabaseExternalGateService } from "./external-gates";
import { DatabaseExceptionRosterAdminService } from "./exception-routing";
import { DatabaseExternalGateActivationTaskStore } from "./gate-activation-tasks";

export const systemRepositoryRegistry = [
  DatabaseExternalGateService,
  DatabaseExceptionRosterAdminService,
  DatabaseExternalGateActivationTaskStore,
] as const;
