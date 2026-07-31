export * from "./external-gates";

import * as externalGates from "./external-gates";

export const systemDomainRegistry = [externalGates] as const;
