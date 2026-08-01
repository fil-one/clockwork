export * from "./capabilities";
export * from "./external-gates";
export * from "./outbox";
export * from "./providers";

import { DatabaseExternalGateService } from "./external-gates";
import { DatabaseSystemCapabilityGuard } from "./capabilities";

export const systemRepositoryRegistry = [
  DatabaseExternalGateService,
  DatabaseSystemCapabilityGuard,
] as const;
