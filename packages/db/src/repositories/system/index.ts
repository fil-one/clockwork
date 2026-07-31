export * from "./external-gates";
export * from "./outbox";
export * from "./providers";

import { DatabaseExternalGateService } from "./external-gates";

export const systemRepositoryRegistry = [DatabaseExternalGateService] as const;
