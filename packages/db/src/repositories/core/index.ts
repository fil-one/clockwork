export * from "./finance";

import { CoreFinanceRepository } from "./finance";

export const coreRepositoryRegistry = [CoreFinanceRepository] as const;
