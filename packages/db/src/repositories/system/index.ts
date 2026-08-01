export * from "./capabilities";
export * from "./external-gates";
export * from "./exception-routing";
export * from "./gate-activation-tasks";
export * from "./outbox";
export * from "./providers";

import { DatabaseExternalGateService } from "./external-gates";
import { DatabaseSystemCapabilityGuard } from "./capabilities";
import { DatabaseExceptionRosterAdminService } from "./exception-routing";
import { DatabaseExternalGateActivationTaskStore } from "./gate-activation-tasks";

export const systemRepositoryRegistry = [
  DatabaseExternalGateService,
  DatabaseSystemCapabilityGuard,
  DatabaseExceptionRosterAdminService,
  DatabaseExternalGateActivationTaskStore,
] as const;
